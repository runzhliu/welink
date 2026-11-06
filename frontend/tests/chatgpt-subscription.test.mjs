import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { Window } from 'happy-dom';

const window = new Window({ url: 'http://localhost:3418/' });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'ResizeObserver']) globalThis[key] = key === 'window' ? window : window[key];
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { act } = React;
const require = createRequire(import.meta.url);
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => {
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename });
  module._compile(outputText, filename);
};
const axios = require('axios');
let connected = false, calls = [];
axios.get = async (url, options) => { calls.push({ url, headers: options?.headers }); return { data: url.endsWith('/models') ? { models: [{ slug: 'test-model', name: '测试模型' }] } : { authorized: connected, email: connected ? 'test@example.test' : '' } }; };
axios.post = async url => { calls.push({url}); return { data: { url: 'https://auth.openai.com/example' } }; };
const { ChatGPTConnection } = require('../src/components/settings/ai/ChatGPTConnection.tsx');
after(async () => { await window.happyDOM.close(); });

test('订阅登录使用本机授权，连接后选择账号模型并测试', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const popup = { opener: window, closed: false, location: { replace(url) { this.url = url; } }, close() { this.closed = true; } };
  window.open = () => popup;
  let tested = '';
  const props = { profile: { id: '1', provider: 'chatgpt', name: '订阅', model: 'test-model' }, onChange() {}, onSaveAndTest(id) { tested = id; }, testing: false, testMsg: null };
  try {
    await act(async () => root.render(React.createElement(ChatGPTConnection, props)));
    assert.ok(host.textContent.includes('无需 API Key'));
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent.includes('Continue with ChatGPT')).click());
    assert.equal(popup.location.url, 'https://auth.openai.com/example');
    assert.equal(popup.opener, null);
    assert.ok(calls.some(c => c.url === '/api/auth/chatgpt/start'));
    await act(async () => root.unmount());
    connected = true; calls = []; const second = createRoot(host);
    try {
      await act(async () => second.render(React.createElement(ChatGPTConnection, props)));
      assert.ok(host.textContent.includes('test@example.test'));
      assert.ok(calls.some(c => c.url === '/api/auth/chatgpt/models'));
      assert.ok(calls.every(c => c.headers?.['X-WeLink-Local-Origin'] === 'http://localhost:3418'));
      await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent.includes('测试连接')).click());
      assert.equal(tested, '1');
    } finally { await act(async () => second.unmount()); }
  } finally { host.remove(); }
});
