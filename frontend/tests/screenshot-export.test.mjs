import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { Window } from 'happy-dom';

const window = new Window({ url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Blob']) globalThis[key] = window[key];
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
const require = createRequire(import.meta.url);
require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename });
  module._compile(outputText, filename);
};
let snapshot;
let clonedTheme;
let outputBlob = new Blob(['png'], { type: 'image/png' });
const htmlPath = require.resolve('html2canvas');
require.cache[htmlPath] = { id: htmlPath, filename: htmlPath, loaded: true, exports: async (wrapper, opts) => {
  snapshot = wrapper.cloneNode(true);
  const clonedDoc = document.implementation.createHTMLDocument('capture');
  clonedDoc.documentElement.classList.add('dark');
  clonedDoc.body.append(wrapper.cloneNode(true));
  opts.onclone?.(clonedDoc);
  clonedTheme = clonedDoc.documentElement.className;
  return { toBlob: callback => callback(outputBlob) };
} };
const { captureCardToPng } = require('../src/utils/exportPng.ts');
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
URL.createObjectURL = () => 'blob:test';
URL.revokeObjectURL = () => {};
window.HTMLAnchorElement.prototype.click = function () {};
after(async () => { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; await window.happyDOM.close(); });

test('截图只修改副本，保留完整文本并去掉导出时无用的操作按钮', async () => {
  document.documentElement.classList.add('dark');
  const card = document.createElement('div');
  card.innerHTML = '<div class="truncate"><span data-capture-lift-text>一条很长的虚构文字</span><span data-capture-lift-text="6">标签</span></div><button data-capture-ignore>展开</button>';
  document.body.append(card);
  const result = await captureCardToPng(card, { filename: 'sample', theme: 'light' });
  assert.equal(result.ok, true);
  assert.equal(snapshot.querySelector('.truncate'), null);
  assert.equal(snapshot.querySelector('button'), null);
  assert.match(snapshot.textContent, /一条很长的虚构文字/);
  assert.equal(snapshot.querySelector('[data-capture-lift-text]').style.top, '-3px');
  assert.equal(snapshot.querySelector('[data-capture-lift-text="6"]').style.top, '-6px');
  assert.match(snapshot.firstElementChild.style.fontFamily, /PingFang SC/);
  assert.ok(card.querySelector('.truncate'));
  assert.equal(card.querySelector('[data-capture-lift-text]').style.top, '');
  assert.ok(card.querySelector('button'));
  assert.ok(document.documentElement.classList.contains('dark'));
  assert.equal(clonedTheme, '');
  assert.equal(document.querySelector('[data-capture-id]'), null);
  card.remove();
  document.documentElement.classList.remove('dark');
});

test('截图尺寸超过限制时返回明确错误并清理临时节点', async () => {
  const card = document.createElement('div');
  document.body.append(card);
  const result = await captureCardToPng(card, { filename: 'large', height: 9000, scale: 2 });
  assert.equal(result.ok, false);
  assert.match(result.error, /过长/);
  assert.equal(document.querySelector('[data-capture-id]'), null);
  card.remove();
});

test('截图副本保留 canvas 图表的像素', async () => {
  const originalGetContext = window.HTMLCanvasElement.prototype.getContext;
  const copied = [];
  window.HTMLCanvasElement.prototype.getContext = function () {
    return { drawImage: source => copied.push(source) };
  };
  const card = document.createElement('div');
  const chart = document.createElement('canvas');
  card.append(chart);
  document.body.append(card);
  try {
    const result = await captureCardToPng(card, { filename: 'chart' });
    assert.equal(result.ok, true);
    assert.deepEqual(copied, [chart]);
  } finally {
    window.HTMLCanvasElement.prototype.getContext = originalGetContext;
    card.remove();
  }
});

test('空图片不会被误报为导出成功', async () => {
  const card = document.createElement('div');
  document.body.append(card);
  outputBlob = new Blob([], { type: 'image/png' });
  try {
    const result = await captureCardToPng(card, { filename: 'empty' });
    assert.equal(result.ok, false);
    assert.match(result.error, /图片为空/);
  } finally {
    outputBlob = new Blob(['png'], { type: 'image/png' });
    card.remove();
  }
});
