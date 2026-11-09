import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { Window } from 'happy-dom';

const window = new Window({ url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'localStorage']) globalThis[key] = key === 'window' ? window : window[key];
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { act } = React;
const require = createRequire(import.meta.url);
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename }).outputText, filename);
require.extensions['.css'] = () => {};
const { LateNightGuard } = require('../src/components/dashboard/LateNightGuard.tsx');
after(async () => window.happyDOM.close());

test('深夜分布保持各时段数值和高度比例，并对每根柱使用自适应宽度', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    const globalStats = { hourly_heatmap: [100, 50, 0, 25, 75, ...Array(19).fill(0)], total_messages: 1000, late_night_ranking: [] };
    await act(async () => root.render(React.createElement(LateNightGuard, { globalStats, contacts: [] })));
    const bars = [...host.querySelectorAll('.chart-bar-width')];
    assert.equal(bars.length, 5);
    assert.deepEqual(bars.map(bar => bar.style.height), ['100%', '50%', '0%', '25%', '75%']);
    assert.ok(bars.every(bar => bar.parentElement.classList.contains('justify-center')));
    assert.match(host.textContent, /凌晨时段分布/);
    for (let hour = 0; hour < 5; hour++) assert.match(host.textContent, new RegExp(`${hour}点`));
  } finally { await act(async () => root.unmount()); host.remove(); }
});
