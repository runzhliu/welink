import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { Window } from 'happy-dom';

const window = new Window({ url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'localStorage']) globalThis[key] = key === 'window' ? window : window[key];
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { act } = React;
const require = createRequire(import.meta.url);
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename }).outputText, filename);
let calls = [];
const apiPath = require.resolve('../src/services/agentAccessApi.ts');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: { agentAccessApi: {
  status: async () => { calls.push(['status']); return { state: 'none' }; },
  create: async (...args) => { calls.push(['create', ...args]); return { token: 'synthetic-secret', expires_at: '2026-12-01T00:00:00Z' }; },
  revoke: async () => { calls.push(['revoke']); return { state: 'none' }; },
} } };
const sftPath = require.resolve('../src/services/sftApi.ts');
require.cache[sftPath] = { id: sftPath, filename: sftPath, loaded: true, exports: { sftApi: { unlock: async () => {} } } };
const { AgentAccessSection } = require('../src/components/settings/system/AgentAccessSection.tsx');
after(async () => window.happyDOM.close());

const button = text => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text);
test('Agent 授权默认仅开放日期，创建前确认并可撤销', async () => {
  calls = []; const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(React.createElement(AgentAccessSection, { contacts: [{ username: 'synthetic', remark: '虚构联系人' }], groups: [], demo: false, privacyMode: false })));
    const checkboxes = [...host.querySelectorAll('input[type=checkbox]')];
    assert.equal(checkboxes.length, 3);
    assert.equal(checkboxes[1].checked, false); assert.equal(checkboxes[2].checked, false);
    await act(async () => checkboxes[0].click());
    await act(async () => button('检查并创建授权').click());
    assert.equal(calls.filter(c => c[0] === 'create').length, 0);
    assert.match(document.body.textContent, /将授权 1 个会话/);
    await act(async () => button('确认创建').click());
    assert.deepEqual(calls.find(c => c[0] === 'create'), ['create', ['synthetic'], ['dates'], 168]);
    assert.equal(host.querySelector('[aria-label="一次性 Agent 凭据"]').type, 'password');
    assert.equal(localStorage.length, 0);
    await act(async () => button('撤销当前授权').click());
    await act(async () => button('确认撤销').click());
    assert.equal(calls.filter(c => c[0] === 'revoke').length, 1);
    assert.equal(host.querySelector('[aria-label="一次性 Agent 凭据"]'), null);
    assert.match(host.textContent, /授权已撤销/);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test('公开演示不读取或创建 Agent 授权', async () => {
  calls = []; const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(React.createElement(AgentAccessSection, { contacts: [], groups: [], demo: true, privacyMode: false })));
    assert.match(host.textContent, /不支持创建 Agent 授权/);
    assert.deepEqual(calls, []);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
