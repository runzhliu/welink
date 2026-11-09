import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { Window } from 'happy-dom';

const window = new Window({ url: 'http://localhost/#/dashboard' });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'localStorage']) globalThis[key] = key === 'window' ? window : window[key];
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { act } = React;
const require = createRequire(import.meta.url);
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename }).outputText, filename);
require.extensions['.css'] = () => {};
const { ConversationHistory } = require('../src/components/dashboard/ConversationHistory.tsx');
const { saveConversation, deleteConversation } = require('../src/services/conversationStore.ts');
const oldFetch = globalThis.fetch;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
let host, root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); globalThis.fetch = oldFetch; });
after(async () => window.happyDOM.close());
const button = text => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text);
async function click(element) { assert.ok(element); await act(async () => element.click()); }

test('批量删除只移除选中项，部分失败保留并提示，当前对话删除后清空', async () => {
  const removed = [];
  globalThis.fetch = async (url, init = {}) => {
    if (init.method === 'DELETE') {
      const key = new URL(url, 'http://localhost').searchParams.get('key');
      removed.push(key);
      return json({}, key.endsWith('3') ? 500 : 200);
    }
    return json({ conversations: [1, 2, 3].map(n => ({ key: `ai-home:${n}`, preview: `对话${n}`, updated_at: 1, msg_count: 2 })) });
  };
  let reset = 0;
  await act(async () => root.render(React.createElement(ConversationHistory, { prefix: 'ai-home:', currentKey: 'ai-home:2', onSelect() {}, onNew() { reset++; } })));
  await click(button('批量管理'));
  await click(host.querySelector('[aria-label="选择 对话2"]'));
  await click(host.querySelector('[aria-label="选择 对话3"]'));
  await click(button('删除所选'));
  assert.match(document.querySelector('[role="dialog"]').textContent, /2 条 AI 对话/);
  await click(button('确认删除'));
  assert.deepEqual(removed.sort(), ['ai-home:2', 'ai-home:3']);
  assert.equal(reset, 1);
  assert.match(host.textContent, /对话1/);
  assert.doesNotMatch(host.textContent, /对话2/);
  assert.match(host.textContent, /对话3/);
  assert.match(host.textContent, /1 条删除失败/);
  assert.equal(host.querySelector('[aria-label="选择 对话3"]').checked, true);
});

test('删除等待当前未完成的自动保存，避免对话复活', async () => {
  const calls = [];
  let finishSave;
  globalThis.fetch = async (_url, init = {}) => {
    calls.push(init.method);
    if (init.method === 'PUT') return new Promise(resolve => { finishSave = () => resolve(json({ ok: true })); });
    return json({ ok: true });
  };
  const save = saveConversation('ai-home:pending', [{ role: 'user', content: '示例' }]);
  const remove = deleteConversation('ai-home:pending');
  await Promise.resolve();
  assert.deepEqual(calls, ['PUT']);
  finishSave();
  await Promise.all([save, remove]);
  assert.deepEqual(calls, ['PUT', 'DELETE']);
});
