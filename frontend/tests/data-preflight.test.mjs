import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { Window } from 'happy-dom';

const window = new Window({ url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'localStorage']) globalThis[key] = key === 'window' ? window : window[key];
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { Simulate } = await import('react-dom/test-utils');
const { act } = React;
const require = createRequire(import.meta.url);
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename }).outputText, filename);
const apiPath = require.resolve('../src/services/appApi.ts');
let result, setupCalls;
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: { appApi: { preflight: async () => result, setup: async (...args) => { setupCalls.push(args); return { status: 'ok' }; } } } };
const { AppSetupPage } = require('../src/components/common/AppSetupPage.tsx');
const { diagnosticReportMarkdown } = require('../src/utils/diagnosticReport.ts');
after(async () => window.happyDOM.close());

test('首次配置先检查真实目录，失败不应用，演示模式不检查', async () => {
  let completed = 0; setupCalls = [];
  result = { ok: false, checks: [{ name: '消息数据库', status: 'error', message: '文件未解密' }] };
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(React.createElement(AppSetupPage, { onSetupComplete: () => completed++ })));
    const input = host.querySelector('input');
    await act(async () => Simulate.change(input, { target: { value: '/synthetic' } }));
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent.includes('完成配置')).click());
    assert.match(host.textContent, /文件未解密/);
    assert.equal(setupCalls.length, 0);
    result = { ok: true, checks: [{ name: '联系人数据库', status: 'ok', message: '已识别' }] };
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent.includes('完成配置')).click());
    assert.deepEqual(setupCalls[0], ['/synthetic', '']);
    assert.equal(completed, 1);
    await act(async () => Simulate.change(input, { target: { value: '' } }));
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent.includes('使用演示数据')).click());
    assert.deepEqual(setupCalls[1], ['', '']);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test('诊断报告不包含路径、错误原文、服务地址或用户配置名称', () => {
  const secret = 'sensitive-synthetic-value';
  const report = diagnosticReportMarkdown({
    generated_at: '2026-01-01',
    data_dir: { status: 'error', path: secret, message: secret, warnings: [secret] },
    index: { status: 'error', is_initialized: false, is_indexing: false, total_cached: 3, last_error: secret, message: secret },
    llm_profiles: [{ status: 'warn', name: secret, provider: secret, model: secret, base_url: secret, message: secret }],
    disk: { status: 'ok', ai_analysis_db_path: secret, message: secret },
  });
  assert.doesNotMatch(report, new RegExp(secret));
  assert.match(report, /已缓存 3/);
  assert.match(report, /索引错误：存在，详情已省略/);
});
