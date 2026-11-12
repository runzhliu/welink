import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { Window } from 'happy-dom';

const window = new Window({ url: 'http://localhost/#/dashboard', width: 390, height: 844 });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'ResizeObserver', 'localStorage']) globalThis[key] = key === 'window' ? window : window[key];
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.HTMLElement.prototype.scrollTo = function () {};
window.HTMLElement.prototype.scrollIntoView = function () {};
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { Simulate } = await import('react-dom/test-utils');
const { act } = React;
const require = createRequire(import.meta.url);
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename }).outputText, filename);
require.extensions['.css'] = () => {};
const Module = require('node:module'), load = Module._load;
Module._load = function (request, parent, ...args) {
  if (request === 'react-markdown') return { __esModule: true, default: ({ children }) => React.createElement('div', null, children) };
  if (request === 'remark-gfm') return { __esModule: true, default: () => {} };
  if (request.endsWith('/ModelAvatar')) return { ModelAvatar: () => null };
  if (request.endsWith('/SearchContextModal')) return { SearchContextModal: props => React.createElement('div', { 'data-source': props.username }, `${props.date} ${props.targetContent}`) };
  if (request === './ConversationHistory') return { ConversationHistory: () => null };
  return load.call(this, request, parent, ...args);
};
const { ReplyAssistant } = require('../src/components/dashboard/ReplyAssistant.tsx');
const { CrossContactQA } = require('../src/components/dashboard/CrossContactQA.tsx');
const { AIHomePage } = require('../src/components/dashboard/AIHomePage.tsx');
Module._load = load;
const { searchApi, groupsApi, contactsApi } = require('../src/services/api.ts');
const oldFetch = globalThis.fetch, oldSearch = searchApi.global, oldGroups = groupsApi.getList, oldExport = contactsApi.exportMessages;
let root, host, requests;
const json = data => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
function stream(parts) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({ start(controller) { for (const part of parts) controller.enqueue(encoder.encode(part)); controller.close(); } }), { status: 200 });
}
const buttons = text => [...host.querySelectorAll('button')].filter(b => b.textContent.trim() === text);
async function click(button) { assert.ok(button); await act(async () => button.click()); }
beforeEach(() => { requests = []; host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); globalThis.fetch = oldFetch; searchApi.global = oldSearch; groupsApi.getList = oldGroups; contactsApi.exportMessages = oldExport; });
after(async () => window.happyDOM.close());

test('回复助手只发送输入内容和所选模型，支持编辑结果', async () => {
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (String(url).endsWith('/preferences')) return json({ llm_profiles: [{ id: 'sft-1', name: '我的模型', provider: 'custom', model: 'mine', sft_deployment_id: 'd1' }] });
    return stream(['data: {"delta":"好呀",', '"done":false}\n\ndata: {"done":true}\n\n']);
  };
  await act(async () => root.render(React.createElement(ReplyAssistant)));
  assert.match(host.textContent, /普通模型不会自动学习你的口吻/);
  await act(async () => Simulate.change(host.querySelector('textarea'), { target: { value: '周末吃饭吗？' } }));
  await click(buttons('生成草稿')[0]);
  const request = JSON.parse(requests.find(r => r.url.endsWith('/ai/analyze')).options.body);
  assert.equal(request.profile_id, 'sft-1');
  assert.match(request.messages[1].content, /周末吃饭吗/);
  assert.equal(host.querySelector('[aria-label="回复草稿"]').value, '好呀');
  assert.equal(requests.filter(r => r.options.method === 'POST').length, 1);
});

test('跨联系人问答仅记录发送给模型的出处并支持打开上下文', async () => {
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === '/api/preferences') return json({ llm_profiles: [{ id: 'p1', provider: 'test' }] });
    if (url === '/api/ai/complete') return json({ content: JSON.stringify({ type: 'search', keywords: ['旅行'], date_from: null, date_to: null, search_type: 'contact' }) });
    if (url === '/api/ai/analyze') return stream(['data: {"delta":"我们聊过旅行 [1]"}\n\ndata: {"done":true}\n\n']);
    return json({ ok: true });
  };
  searchApi.global = async () => [{ username: 'friend', display_name: '朋友', is_group: false, small_head_url: '', messages: [{ date: '2024-01-02', time: '10:30', content: '一起旅行吧', is_mine: false }] }];
  await act(async () => root.render(React.createElement(CrossContactQA)));
  await click(buttons('谁跟我聊过旅行？')[0]);
  const intent = JSON.parse(requests.find(r => r.url === '/api/ai/complete').options.body);
  assert.equal(intent.profile_id, 'p1');
  const answer = JSON.parse(requests.find(r => r.url === '/api/ai/analyze').options.body);
  assert.match(answer.messages[1].content, /\[1\].*一起旅行吧/);
  assert.match(host.textContent, /提供给模型的聊天片段 · 1 条/);
  const saved = JSON.parse(requests.find(r => r.url === '/api/ai/conversations' && r.options.method === 'PUT').options.body);
  assert.equal(saved.messages[1].sources[0].content, '一起旅行吧');
  await click([...host.querySelectorAll('button')].find(b => b.textContent.includes('[1]') && b.textContent.includes('一起旅行吧')));
  assert.match(host.querySelector('[data-source="friend"]').textContent, /2024-01-02 一起旅行吧/);
});

test('最近聊天按时间换批并保留已选择的联系人', async () => {
  globalThis.fetch = async () => json({ llm_profiles: [{ id: 'p1', provider: 'test' }] });
  groupsApi.getList = async () => [];
  const contacts = Array.from({ length: 16 }, (_, i) => ({ username: `u${i}`, remark: `联系人${i}`, nickname: '', total_messages: 2, last_message_time: `2024-01-${String(16 - i).padStart(2, '0')}` }));
  await act(async () => root.render(React.createElement(AIHomePage, { contacts, timeRange: { from: null, to: null, label: '全部' }, onReselect() {} })));
  const byName = name => [...host.querySelector('[aria-label="最近聊天"]').querySelectorAll('span')].find(el => el.textContent === name)?.closest('button');
  const first = byName('联系人0'); assert.ok(first);
  await click(first);
  await click(buttons('换一批')[0]);
  assert.ok(byName('联系人14'));
  assert.ok(!byName('联系人0'));
  assert.match(host.textContent, /已选 1 个对话/);
  await click(buttons('换一批')[0]);
  assert.ok(byName('联系人0'));
});

test('分析前预览真实范围和内容，确认后才发送；读取失败不发送', async () => {
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === '/api/preferences') return json({ llm_profiles: [{ id: 'p1', provider: 'antigravity', model: 'synthetic-model' }] });
    if (url === '/api/ai/analyze') return stream(['data: {"delta":"合成回复"}\n\ndata: {"done":true}\n\n']);
    return json({ ok: true });
  };
  groupsApi.getList = async () => [];
  let range;
  contactsApi.exportMessages = async (...args) => { range = args; return [{ date: '2024-01-01', time: '12:00', is_mine: false, content: '合成测试消息' }]; };
  const contacts = [{ username: 'fake', remark: '测试联系人', nickname: '', total_messages: 1, last_message_time: '2024-01-01' }];
  await act(async () => root.render(React.createElement(AIHomePage, { contacts, timeRange: { from: 100, to: 200, label: '测试范围' }, indexStatus: { is_initialized: true, is_indexing: false, total_cached: 1, last_indexed_at: Math.floor(Date.now() / 1000) }, onReselect() {} })));
  assert.match(host.textContent, /索引已就绪 · 1 位联系人/);
  await click([...host.querySelector('[aria-label="最近聊天"]').querySelectorAll('button')].find(b => b.textContent.includes('测试联系人')));
  await act(async () => Simulate.change(host.querySelector('textarea[aria-label="输入分析问题"]'), { target: { value: '总结一下' } }));
  await click(host.querySelector('[aria-label="发送问题"]'));
  assert.deepEqual(range, ['fake', 100, 200, 200]);
  assert.equal(requests.filter(r => r.url === '/api/ai/analyze').length, 0);
  const dialog = document.querySelector('[role="dialog"]');
  assert.match(dialog.textContent, /测试范围 · 聊天记录 1 条/);
  assert.match(dialog.textContent, /合成测试消息/);
  await click([...dialog.querySelectorAll('button')].find(b => b.textContent === '返回修改'));
  assert.equal(document.querySelector('[role="dialog"]'), null);
  contactsApi.exportMessages = async () => { throw new Error('private path'); };
  await click(host.querySelector('[aria-label="发送问题"]'));
  assert.match(host.textContent, /读取聊天记录失败/);
  assert.equal(requests.filter(r => r.url === '/api/ai/analyze').length, 0);
  contactsApi.exportMessages = async () => [{ date: '2024-01-01', time: '12:00', is_mine: false, content: '合成测试消息' }];
  await click(host.querySelector('[aria-label="发送问题"]'));
  await click([...document.querySelector('[role="dialog"]').querySelectorAll('button')].find(b => b.textContent === '确认发送'));
  const sent = JSON.parse(requests.find(r => r.url === '/api/ai/analyze').options.body);
  assert.equal(sent.profile_id, 'p1');
  assert.deepEqual(sent.expected_profile, { provider: 'antigravity', model: 'synthetic-model', base_url: '' });
  assert.match(sent.messages[0].content, /合成测试消息/);
  const firstKeys = requests.filter(r => r.url === '/api/ai/conversations' && r.options.method === 'PUT').map(r => JSON.parse(r.options.body).key);
  assert.ok(firstKeys.length > 0);
  await click(host.querySelector('[title="返回首页"]'));
  await new Promise(resolve => setTimeout(resolve, 5));
  await act(async () => Simulate.change(host.querySelector('textarea[aria-label="输入分析问题"]'), { target: { value: '新的问题' } }));
  await click(host.querySelector('[aria-label="发送问题"]'));
  await click([...document.querySelector('[role="dialog"]').querySelectorAll('button')].find(b => b.textContent === '确认发送'));
  const allKeys = requests.filter(r => r.url === '/api/ai/conversations' && r.options.method === 'PUT').map(r => JSON.parse(r.options.body).key);
  assert.ok(allKeys.some(key => key !== firstKeys[0]), '返回首页后新对话不能覆盖之前的记录');
});

test('响应没有完成事件时显示中断而非正常结束', async () => {
  globalThis.fetch = async url => url === '/api/preferences'
    ? json({ llm_profiles: [{ id: 'p1', provider: 'custom', model: 'synthetic' }] })
    : url === '/api/ai/analyze' ? stream(['data: {"delta":"未完成"}\n\n']) : json({ ok: true });
  groupsApi.getList = async () => [];
  contactsApi.exportMessages = async () => [{ date: '2024-01-01', time: '12:00', is_mine: false, content: '合成消息' }];
  const contacts = [{ username: 'fake', remark: '联系人', nickname: '', total_messages: 1, last_message_time: '2024-01-01' }];
  await act(async () => root.render(React.createElement(AIHomePage, { contacts, timeRange: { from: null, to: null, label: '全部' }, onReselect() {} })));
  await click([...host.querySelector('[aria-label="最近聊天"]').querySelectorAll('button')].find(b => b.textContent.includes('联系人')));
  await act(async () => Simulate.change(host.querySelector('textarea[aria-label="输入分析问题"]'), { target: { value: '总结一下' } }));
  await click(host.querySelector('[aria-label="发送问题"]'));
  await click([...document.querySelector('[role="dialog"]').querySelectorAll('button')].find(b => b.textContent === '确认发送'));
  assert.match(host.textContent, /响应中断，结果可能不完整/);
});

test('演示模式无需配置真实模型，预览明确说明使用模拟回复', async () => {
  globalThis.fetch = async url => url === '/api/preferences' ? json({}) : url === '/api/ai/analyze' ? stream(['data: {"delta":"演示回复"}\n\ndata: {"done":true}\n\n']) : json({ ok: true });
  groupsApi.getList = async () => [];
  contactsApi.exportMessages = async () => [{ date: '2024-01-01', time: '12:00', is_mine: false, content: '演示消息' }];
  const contacts = [{ username: 'fake', remark: '联系人', nickname: '', total_messages: 1, last_message_time: '2024-01-01' }];
  await act(async () => root.render(React.createElement(AIHomePage, { contacts, timeRange: { from: null, to: null, label: '全部' }, demoMockActive: true, onReselect() {} })));
  assert.doesNotMatch(host.textContent, /还未配置 AI 接口/);
  await click([...host.querySelector('[aria-label="最近聊天"]').querySelectorAll('button')].find(b => b.textContent.includes('联系人')));
  await act(async () => Simulate.change(host.querySelector('textarea[aria-label="输入分析问题"]'), { target: { value: '总结一下' } }));
  await click(host.querySelector('[aria-label="发送问题"]'));
  assert.match(document.querySelector('[role="dialog"]').textContent, /演示回复，使用模拟数据，不调用外部模型/);
  await click([...document.querySelector('[role="dialog"]').querySelectorAll('button')].find(b => b.textContent === '确认发送'));
  assert.match(host.textContent, /演示回复/);
});

test('口吻回复只发送用户勾选的历史示例，并在发送前确认', async () => {
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (String(url).endsWith('/preferences')) return json({ llm_profiles: [{ id: 'p1', provider: 'test' }] });
    return stream(['data: {"delta":"好的"}\n\ndata: {"done":true}\n\n']);
  };
  contactsApi.exportMessages = async () => [
    { date: '2024-01-01', time: '10:00', is_mine: true, type: 1, content: '选中的回复' },
    { date: '2024-01-01', time: '10:01', is_mine: true, type: 1, content: '没有勾选的回复' },
    { date: '2024-01-01', time: '10:02', is_mine: false, type: 1, content: '不能作为示例的文本' },
  ];
  await act(async () => root.render(React.createElement(ReplyAssistant, { contacts: [{ username: 'friend', remark: '朋友' }] })));
  await act(async () => Simulate.change(host.querySelector('textarea'), { target: { value: '周末吃饭吗' } }));
  await act(async () => Simulate.change(host.querySelector('[aria-label="选择参考联系人"]'), { target: { value: 'friend' } }));
  assert.doesNotMatch(host.textContent, /不能作为示例的文本/);
  await act(async () => Simulate.change(host.querySelector('input[type="checkbox"]'), { target: { checked: true } }));
  await click(buttons('生成草稿')[0]);
  assert.equal(requests.filter(r => r.options.method === 'POST').length, 0);
  assert.match(document.querySelector('[role="dialog"]').textContent, /选中的回复/);
  await click([...document.querySelector('[role="dialog"]').querySelectorAll('button')].find(b => b.textContent === '确认生成'));
  const payload = JSON.parse(requests.find(r => r.url.endsWith('/ai/analyze')).options.body);
  assert.match(payload.messages[1].content, /选中的回复/);
  assert.doesNotMatch(payload.messages[1].content, /没有勾选的回复/);
});

test('首页引用只保存模型实际引用的来源并可打开上下文', async () => {
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === '/api/preferences') return json({ llm_profiles: [{ id: 'p1', provider: 'test' }] });
    if (url === '/api/ai/analyze') return stream(['data: {"delta":"依据 [1] 和无效编号 [99]"}\n\ndata: {"done":true}\n\n']);
    return json({ ok: true });
  };
  groupsApi.getList = async () => [];
  contactsApi.exportMessages = async () => [{ date: '2024-01-01', time: '12:00', is_mine: false, content: '测试引用' }, { date: '2024-01-02', time: '12:00', is_mine: true, content: '未引用' }];
  await act(async () => root.render(React.createElement(AIHomePage, { contacts: [{ username: 'fake', remark: '联系人', nickname: '', total_messages: 2, last_message_time: '2024-01-02' }], timeRange: { from: null, to: null, label: '全部' }, onReselect() {} })));
  await click([...host.querySelector('[aria-label="最近聊天"]').querySelectorAll('button')].find(b => b.textContent.includes('联系人')));
  await act(async () => Simulate.change(host.querySelector('textarea[aria-label="输入分析问题"]'), { target: { value: '总结' } }));
  await click(host.querySelector('[aria-label="发送问题"]'));
  await click([...document.querySelector('[role="dialog"]').querySelectorAll('button')].find(b => b.textContent === '确认发送'));
  const payload = JSON.parse(requests.find(r => r.url === '/api/ai/analyze').options.body);
  assert.match(payload.messages[0].content, /\[1\].*测试引用/);
  assert.match(host.textContent, /查看引用的聊天记录（1）/);
  await click([...host.querySelectorAll('button')].find(b => b.textContent.includes('[1]') && b.textContent.includes('测试引用')));
  assert.match(host.querySelector('[data-source="fake"]').textContent, /测试引用/);
  const saved = JSON.parse(requests.filter(r => r.url === '/api/ai/conversations' && r.options.method === 'PUT').at(-1).options.body);
  assert.equal(saved.messages.at(-1).sources.length, 1);
});

test('双模型对比必须确认，两个请求的材料相同', async () => {
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === '/api/preferences') return json({ llm_profiles: [{ id: 'p1', provider: 'one' }, { id: 'p2', provider: 'two' }] });
    if (url === '/api/ai/analyze') return stream(['data: {"delta":"模型回答"}\n\ndata: {"done":true}\n\n']);
    return json({ ok: true });
  };
  groupsApi.getList = async () => [];
  contactsApi.exportMessages = async () => [{ date: '2024-01-01', time: '12:00', is_mine: false, content: '合成材料' }];
  await act(async () => root.render(React.createElement(AIHomePage, { contacts: [{ username: 'fake', remark: '联系人', nickname: '', total_messages: 1, last_message_time: '2024-01-01' }], timeRange: { from: null, to: null, label: '全部' }, onReselect() {} })));
  await click([...host.querySelector('[aria-label="最近聊天"]').querySelectorAll('button')].find(b => b.textContent.includes('联系人')));
  await act(async () => Simulate.change(host.querySelector('textarea[aria-label="输入分析问题"]'), { target: { value: '总结' } }));
  await click(host.querySelector('[aria-label="发送问题"]'));
  const dialog = document.querySelector('[role="dialog"]');
  await act(async () => Simulate.change(dialog.querySelector('[aria-label="选择对比模型"]'), { target: { value: 'p2' } }));
  assert.equal(requests.filter(r => r.url === '/api/ai/analyze').length, 0);
  await click([...dialog.querySelectorAll('button')].find(b => b.textContent === '确认发送给两个模型'));
  const sent = requests.filter(r => r.url === '/api/ai/analyze').map(r => JSON.parse(r.options.body));
  assert.deepEqual(sent.map(p => p.profile_id).sort(), ['p1', 'p2']);
  assert.deepEqual(sent[0].messages, sent[1].messages);
  assert.match(document.querySelector('[role="dialog"]').textContent, /模型回答对比/);
});
