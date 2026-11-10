import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { Window } from 'happy-dom';

const window = new Window({ url: 'http://localhost/', width: 390, height: 844 });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'ResizeObserver', 'localStorage']) globalThis[key] = key === 'window' ? window : window[key];
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { act } = React;
const require = createRequire(import.meta.url);
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename }).outputText, filename);
require.extensions['.css'] = () => {};
const { WelcomePage } = require('../src/components/common/WelcomePage.tsx');
const { DataPagination } = require('../src/components/common/DataPagination.tsx');
const { InitializingScreen } = require('../src/components/common/InitializingScreen.tsx');
after(async () => window.happyDOM.close());

test('欢迎页保留全部数据选择并支持键盘切换', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); let result;
  try {
    await act(async () => root.render(React.createElement(WelcomePage, { loading: false, onStart: (...args) => { result = args; } })));
    const options = [...host.querySelectorAll('[role="radio"]')];
    assert.equal(options[2].getAttribute('aria-checked'), 'true');
    await act(async () => options[2].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    assert.equal(options[3].getAttribute('aria-checked'), 'true');
    await act(async () => options[4].click());
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent.includes('开始分析')).click());
    assert.deepEqual(result, [null, null, '全部数据']);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test('分页保留页码和每页数量选择', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); const changes = [];
  try {
    await act(async () => root.render(React.createElement(DataPagination, { total: 1507, page: 1, pageSize: 10, onPageChange: n => changes.push(['page', n]), onPageSizeChange: n => changes.push(['size', n]) })));
    assert.match(host.textContent, /1–10 \/ 1,507/);
    assert.equal(host.querySelector('[aria-current="page"]').textContent, '1');
    await act(async () => host.querySelector('[aria-label="第 2 页"]').click());
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '50').click());
    assert.deepEqual(changes, [['page', 2], ['size', 50]]);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test('欢迎页显示索引启动错误，重试进行中不会重复提交', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  let resolveRetry, attempts = 0;
  try {
    await act(async () => root.render(React.createElement(WelcomePage, { loading: false, onStart() {}, error: '后端暂不可用' })));
    assert.match(host.querySelector('[role="alert"]').textContent, /后端暂不可用/);
    const pending = new Promise(resolve => { resolveRetry = resolve; });
    await act(async () => root.render(React.createElement(InitializingScreen, { error: '索引失败', onRetry: () => { attempts++; return pending; } })));
    const retry = [...host.querySelectorAll('button')].find(b => b.textContent.includes('重试索引'));
    await act(async () => retry.click());
    assert.equal(retry.disabled, true);
    await act(async () => retry.click());
    assert.equal(attempts, 1);
    await act(async () => { resolveRetry(); await pending; });
    assert.equal(retry.disabled, false);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
