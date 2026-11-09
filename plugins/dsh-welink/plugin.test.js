import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, normalizeConfig } from './client.js';
import { apply } from './index.js';

const conversation = 'synthetic-contact';
const group = 'synthetic@chatroom';
const options = { allowedConversations: [conversation, group], allowMessages: true, maxItems: 1, maxContentChars: 20 };
function fakeFetch(data, status = 200) {
  const calls = [];
  return { calls, fetchImpl: async (url, init) => {
    calls.push({ url: url.toString(), ...init, parsedBody: JSON.parse(init.body) });
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  } };
}

test('默认无会话授权、无原文访问，并在请求前拒绝', async () => {
  const fake = fakeFetch({});
  const client = createClient({}, fake);
  assert.deepEqual(client.listConversations(), { conversations: [], messages_enabled: false });
  await assert.rejects(client.activeDates({ username: conversation }), /未获授权/);
  await assert.rejects(client.dayMessages({ username: conversation, date: '2024-01-01' }), /未获授权/);
  assert.equal(fake.calls.length, 0);
  const scoped = createClient({ allowedConversations: [conversation] }, fake);
  await assert.rejects(scoped.dayMessages({ username: conversation, date: '2024-01-01' }), /未启用/);
  assert.equal(fake.calls.length, 0);
});

test('只对授权会话发送请求，敏感参数放在请求体并携带可选凭据', async () => {
  const fake = fakeFetch({ items: [{ date: '', time: '09:01', content: '虚构内容', type: 1, is_mine: false }], has_more: true });
  const client = createClient(options, { ...fake, token: 'synthetic-token' });
  const result = await client.dayMessages({ username: group, date: '2024-01-01' });
  assert.equal(result.username, group);
  assert.equal(result.items[0].date, '2024-01-01');
  assert.equal(result.has_more, true);
  assert.equal(fake.calls[0].url, 'http://127.0.0.1:8088/api/agent/query');
  assert.equal(fake.calls[0].method, 'POST');
  assert.equal(fake.calls[0].redirect, 'error');
  assert.equal(fake.calls[0].headers.Authorization, 'Bearer synthetic-token');
  assert.deepEqual(fake.calls[0].parsedBody, { action: 'day', username: group, date: '2024-01-01', offset: 0, max_items: 1, max_chars: 20 });
  await assert.rejects(client.dayMessages({ username: 'other', date: '2024-01-01' }), /未获授权/);
  await assert.rejects(client.dayMessages({ username: group, date: '2024-02-30' }), /有效日期/);
  assert.equal(fake.calls.length, 1);
});

test('搜索限制返回条数和正文长度并保留服务端截断标记', async () => {
  const fake = fakeFetch({ items: [
    { date: '2024-01-02', content: '🙂'.repeat(25), content_truncated: true, speaker: '虚构成员', type: 1 },
    { date: '2024-01-03', content: '不会返回' },
  ], has_more: false });
  const client = createClient(options, fake);
  const result = await client.searchMessages({ username: group, query: ' 测试 ' });
  assert.equal(result.has_more, true);
  assert.equal(result.returned, 1);
  assert.equal(Array.from(result.items[0].content).length, 20);
  assert.equal(result.items[0].content_truncated, true);
  assert.equal(result.items[0].speaker, '虚构成员');
  assert.equal(fake.calls[0].parsedBody.query, '测试');
  assert.ok(!fake.calls[0].url.includes('测试'));
});

test('日期列表保持服务端截断状态', async () => {
  const fake = fakeFetch({ dates: ['2024-01-02'], has_more: true });
  const client = createClient(options, fake);
  assert.deepEqual(await client.activeDates({ username: conversation }), { username: conversation, dates: ['2024-01-02'], has_more: true, next_offset: 1 });
});

test('分页从下一偏移继续，非法偏移在发请求前拒绝', async () => {
  const fake = fakeFetch({ items: [{ date: '2024-01-01', content: '虚构记录' }], has_more: true });
  const client = createClient(options, fake);
  const page = await client.dayMessages({ username: conversation, date: '2024-01-01', offset: 2 });
  assert.equal(page.next_offset, 3);
  assert.equal(fake.calls[0].parsedBody.offset, 2);
  await assert.rejects(client.dayMessages({ username: conversation, date: '2024-01-01', offset: -1 }), /offset/);
  assert.equal(fake.calls.length, 1);
});

test('指定可信 HTTP 主机需要显式允许及凭据文件，凭据可轮换', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'welink-dsh-test-'));
  try {
    const path = join(temp, 'token');
    writeFileSync(path, 'first-token\n', { mode: 0o600 });
    const fake = fakeFetch({ dates: [], has_more: false });
    const remote = { ...options, baseUrl: 'http://welink-backend:8080', allowedHttpHosts: ['welink-backend'] };
    assert.throws(() => createClient(remote, { ...fake, tokenFile: '' }), /TOKEN_FILE/);
    const client = createClient(remote, { ...fake, tokenFile: path });
    await client.activeDates({ username: conversation });
    writeFileSync(path, 'second-token\n');
    await client.activeDates({ username: conversation });
    assert.equal(fake.calls[0].headers.Authorization, 'Bearer first-token');
    assert.equal(fake.calls[1].headers.Authorization, 'Bearer second-token');
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('拒绝不安全地址、重定向、超大响应和泄露后端错误', async () => {
  assert.throws(() => normalizeConfig({ baseUrl: 'http://remote.example:8080' }), /loopback/);
  assert.throws(() => normalizeConfig({ baseUrl: 'https://user:password@example.com' }), /credentials/);
  assert.throws(() => normalizeConfig({ baseUrl: 'https://example.com/other' }), /path/);
  assert.throws(() => normalizeConfig({ allowedConversations: [''] }), /allowedConversations/);
  const redirect = fakeFetch({}, 302);
  await assert.rejects(createClient(options, redirect).activeDates({ username: conversation }), /HTTP 302/);
  const tooLarge = fakeFetch({ dates: ['x'.repeat(2000)] });
  await assert.rejects(createClient({ ...options, maxResponseBytes: 1024 }, tooLarge).activeDates({ username: conversation }), /超过大小限制/);
  const failing = createClient(options, { fetchImpl: async () => { throw new Error('synthetic-token'); }, token: 'synthetic-token' });
  await assert.rejects(failing.activeDates({ username: conversation }), error => !error.message.includes('synthetic-token'));
});

test('DSH 插件注册只读工具与不可信聊天数据提示', async () => {
  const tools = [];
  const sections = [];
  apply({ tools: { register: tool => tools.push(tool) }, systemPrompt: { section: section => sections.push(section) } }, {});
  assert.deepEqual(tools.map(t => t.name), ['welink_conversations', 'welink_active_dates', 'welink_day_messages', 'welink_search_messages']);
  assert.match(sections[0].text, /不可信数据/);
  assert.deepEqual(await tools[0].execute({}, {}), { conversations: [], messages_enabled: false });
  await assert.rejects(tools[2].execute({ username: conversation, date: '2024-01-01' }, {}), /未获授权/);
});
