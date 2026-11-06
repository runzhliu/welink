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
const { act } = React;
const require = createRequire(import.meta.url);
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => {
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename });
  module._compile(outputText, filename);
};
require.extensions['.css'] = () => {};
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, ...args) {
  if (parent?.filename.endsWith('/OrganizedInsights.tsx') && request.startsWith('./') && request !== './insights.css') {
    const stub = ({ onClose }) => React.createElement('div', { 'data-card': request.slice(2) }, request.slice(2), onClose && React.createElement('button', { onClick: onClose }, '关闭'));
    return new Proxy({ __esModule: true, default: stub }, { get: (target, key) => key in target ? target[key] : stub });
  }
  return originalLoad.call(this, request, parent, ...args);
};
const { OrganizedInsights } = require('../src/components/dashboard/OrganizedInsights.tsx');
Module._load = originalLoad;
after(async () => { await window.happyDOM.close(); });

test('洞察分区按需显示卡片，保留自定义布局并使用实际数据范围', async () => {
  localStorage.setItem('welink_stats_layout_v3', 'saved-layout');
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  let customized = 0, reselected = 0;
  const props = { contacts: [], globalStats: null, healthStatus: { hot: 0, warm: 0, cooling: 0, silent: 0, cold: 0 }, blockedUsers: [], blockedDisplayNames: new Set(), onContactClick() {}, timeRangeLabel: '全部时间', onCustomize() { customized++; }, onReselect() { reselected++; } };
  const click = async text => { const button = [...host.querySelectorAll('button')].find(el => el.textContent.includes(text)); assert.ok(button, text); await act(async () => button.click()); };
  try {
    await act(async () => root.render(React.createElement(OrganizedInsights, props)));
    assert.ok(host.textContent.includes('当前分析范围：全部时间'));
    assert.ok(host.querySelector('[data-card="MonthlyTrendChart"]'));
    assert.equal(host.querySelector('[data-card="SelfPortraitCard"]'), null);
    await click('聊天习惯');
    assert.ok(host.querySelector('[data-card="SelfPortraitCard"]'));
    assert.equal(host.querySelector('[data-card="MonthlyTrendChart"]'), null);
    await click('有趣发现');
    assert.ok(host.querySelector('[data-card="MoneyOverviewCard"]'));
    await click('更改范围');
    await click('自定义布局');
    assert.equal(customized, 1);
    assert.equal(reselected, 1);
    assert.equal(localStorage.getItem('welink_stats_layout_v3'), 'saved-layout');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    localStorage.removeItem('welink_stats_layout_v3');
  }
});
