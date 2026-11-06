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
const { searchApi, groupsApi } = require('../src/services/api.ts');
const oldFetch = globalThis.fetch, oldSearch = searchApi.global, oldGroups = groupsApi.getList;
let root, host, requests;
const json = data => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
function stream(parts) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({ start(controller) { for (const part of parts) controller.enqueue(encoder.encode(part)); controller.close(); } }), { status: 200 });
}
const buttons = text => [...host.querySelectorAll('button')].filter(b => b.textContent.trim() === text);
async function click(button) { assert.ok(button); await act(async () => button.click()); }
beforeEach(() => { requests = []; host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); globalThis.fetch = oldFetch; searchApi.global = oldSearch; groupsApi.getList = oldGroups; });
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
