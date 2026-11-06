import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { Window } from 'happy-dom';

const window = new Window({ url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'ResizeObserver', 'localStorage']) globalThis[key] = key === 'window' ? window : window[key];
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
Object.defineProperty(window.navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 Chrome/120.0.0.0' });
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
const { skillsApi } = require('../src/services/api.ts');
skillsApi.list = async () => [
  { id: 'skill-1', target_name: '模拟联系人', skill_type: 'contact', format: 'claude-skill', filename: 'skill.zip', file_size: 20, status: 'success', model_provider: 'test', model_name: 'test', created_at: 1704067200 },
  { id: 'legacy-1', target_name: '旧数据集', skill_type: 'self', format: 'lora-jsonl', filename: 'legacy.zip', file_size: 30, status: 'success', model_provider: '', model_name: '', created_at: 1704067200 },
];
const { SkillsView } = require('../src/components/skills/SkillsView.tsx');
after(async () => { await window.happyDOM.close(); });

test('Skills 保留已有文件及下载入口，不再显示旧版训练和部署面板', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(SkillsView)));
  assert.ok(host.textContent.includes('模拟联系人') && host.textContent.includes('旧数据集'));
  assert.ok(!host.textContent.includes('本地 SFT 训练') && !host.textContent.includes('Adapter 部署与评估'));
  const originalClick = window.HTMLAnchorElement.prototype.click;
  let downloaded;
  window.HTMLAnchorElement.prototype.click = function () { downloaded = { href: this.getAttribute('href'), filename: this.download }; };
  try {
    const row = [...host.querySelectorAll('.grid')].find(el => el.textContent.includes('旧数据集'));
    const button = [...row.querySelectorAll('button')].find(el => el.title === '重新下载');
    assert.ok(button, '旧数据集仍可下载');
    await act(async () => button.click());
    assert.deepEqual(downloaded, { href: '/api/skills/legacy-1/download', filename: 'legacy.zip' });
  } finally {
    window.HTMLAnchorElement.prototype.click = originalClick;
    await act(async () => root.unmount());
    host.remove();
  }
});
