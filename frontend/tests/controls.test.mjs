import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { Window } from 'happy-dom';

const window = new Window({ url: 'http://localhost/', width: 390, height: 844 });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'ResizeObserver']) {
  globalThis[key] = key === 'window' ? window : window[key];
}
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// This DOM environment does not calculate layout; expose visible control bounds.
window.HTMLElement.prototype.getClientRects = function () { return this.hidden ? [] : [this.getBoundingClientRect()]; };
window.HTMLElement.prototype.getBoundingClientRect = function () { return { x: 200, y: 500, left: 200, right: 360, top: 500, bottom: 540, width: 160, height: 40 }; };
window.HTMLElement.prototype.scrollIntoView = function () {};

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { Simulate } = await import('react-dom/test-utils');
const { act } = React;
const h = React.createElement;
// Compile the isolated controls in-process; no dev server or browser socket is needed.
const require = createRequire(import.meta.url);
for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => {
    const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      fileName: filename,
    });
    module._compile(outputText, filename);
  };
}
const load = name => require(`../src/components/common/${name}.tsx`);
const { Select } = load('Select');
const { ComboBox } = load('ComboBox');
const { DatePicker } = load('DatePicker');
const { TimePicker } = load('TimePicker');
const { Dialog } = load('Dialog');
const { Avatar } = load('Avatar');
let root;
async function render(node) {
  const host = document.createElement('div'); document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(node));
}
async function click(element) {
  assert.ok(element, 'control exists');
  await act(async () => element.click());
}
async function key(element, key) { await act(async () => Simulate.keyDown(element, { key, nativeEvent: { isComposing: false } })); }
async function escape() { await act(async () => document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); }
async function change(element, value) { await act(async () => Simulate.change(element, { target: { value } })); }
const options = Array.from({ length: 12 }, (_, index) => ({ value: `model-${index}`, label: `模型 ${index}`, disabled: index === 1 }));

afterEach(async () => { if (root) await act(async () => root.unmount()); root = undefined; document.body.replaceChildren(); });
after(async () => { await window.happyDOM.close(); });

test('Select searches, skips disabled values, selects by keyboard, and clamps its popup to mobile width', async () => {
  let selected;
  await render(h(Select, { value: 'model-0', options, 'aria-label': '模型', onValueChange: value => selected = value }));
  const trigger = document.querySelector('button[role="combobox"]');
  await click(trigger);
  const search = document.querySelector('.ui-select-search input');
  assert.equal(document.activeElement, search);
  assert.equal(document.querySelectorAll('select, option').length, 0);
  const popup = document.querySelector('[data-welink-popover]');
  assert.ok(parseFloat(popup.style.left) + parseFloat(popup.style.width) <= 390);
  await key(search, 'ArrowDown');
  await key(search, 'Enter');
  assert.equal(selected, 'model-2');
  assert.equal(document.activeElement, trigger);
  await click(trigger);
  await change(document.querySelector('.ui-select-search input'), '不存在');
  assert.match(document.querySelector('[role="status"]').textContent, /没有匹配/);
  await escape();
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
});

test('Selecting the current provider does not reset its existing configuration', async () => {
  let changes = 0;
  await render(h(Select, { value: 'provider', options: [{ value: 'provider', label: '现有提供商' }], onValueChange: () => changes++ }));
  await click(document.querySelector('button'));
  await click(document.querySelector('[role="option"]'));
  assert.equal(changes, 0);
});

test('Select closes outside, on Tab, and stays closed when disabled', async () => {
  await render(h(Select, { options }));
  const trigger = document.querySelector('button');
  await click(trigger);
  await act(async () => document.body.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true })));
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  await click(trigger);
  await key(document.querySelector('.ui-select-search input'), 'Tab');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  await act(async () => root.render(h(Select, { options, disabled: true })));
  await click(document.querySelector('button'));
  assert.equal(document.querySelector('[role="listbox"]'), null);
});

test('Escape closes a popup before its parent modal and restores focus', async () => {
  function Fixture() {
    const [open, setOpen] = React.useState(true);
    return h(Dialog, { open, title: '设置', onClose: () => setOpen(false) }, h(Select, { options, 'aria-label': '提供商' }));
  }
  await render(h(Fixture));
  const trigger = document.querySelector('[role="combobox"]');
  await click(trigger);
  assert.ok(document.querySelector('[role="dialog"]').contains(document.activeElement));
  await escape();
  assert.ok(document.querySelector('[role="dialog"]'));
  assert.equal(document.activeElement, trigger);
  await escape();
  assert.equal(document.querySelector('[role="dialog"]'), null);
});

test('DatePicker handles leap days, date boundaries, and keyboard movement', async () => {
  let selected;
  await render(h(DatePicker, { value: '2024-02-28', min: '2024-02-20', max: '2024-03-01', onValueChange: value => selected = value }));
  await click(document.querySelector('button'));
  assert.equal(document.querySelector('[data-date="2024-02-19"]').disabled, true);
  assert.equal(document.querySelector('[data-date="2024-03-02"]').disabled, true);
  assert.equal(document.querySelector('[data-date="2024-02-29"]').disabled, false);
  await key(document.querySelector('[data-date="2024-02-28"]'), 'ArrowRight');
  await act(async () => new Promise(resolve => requestAnimationFrame(resolve)));
  assert.equal(document.activeElement.getAttribute('data-date'), '2024-02-29');
  await click(document.activeElement);
  assert.equal(selected, '2024-02-29');
  assert.equal(document.querySelector('[data-welink-popover]'), null);
});

test('Nested year menu Escape leaves the calendar open and a changed month keeps a tab stop', async () => {
  await render(h(DatePicker, { value: '2024-02-28', onValueChange() {} }));
  await click(document.querySelector('button'));
  await click(document.querySelector('[aria-label="年份"]'));
  await escape();
  assert.ok(document.querySelector('.ui-calendar'));
  assert.equal(document.querySelectorAll('[data-welink-popover]').length, 1);
  await click(document.querySelector('[aria-label="下个月"]'));
  assert.equal(document.querySelectorAll('[data-date][tabindex="0"]').length, 1);
  await escape();
  assert.equal(document.querySelector('.ui-calendar'), null);
});

test('ComboBox accepts custom text and keyboard suggestion selection without datalist', async () => {
  let selected;
  await render(h(ComboBox, { value: '', options: [{ value: 'alloy', label: '中性' }], onValueChange: value => selected = value }));
  const input = document.querySelector('input');
  await act(async () => input.focus());
  await key(input, 'ArrowDown');
  await key(input, 'Enter');
  assert.equal(selected, 'alloy');
  await change(input, 'my-custom-voice');
  assert.equal(selected, 'my-custom-voice');
  assert.equal(document.querySelector('datalist'), null);
});

test('TimePicker preserves minutes when choosing an hour', async () => {
  let selected;
  await render(h(TimePicker, { value: '09:30', onValueChange: value => selected = value }));
  await click(document.querySelector('[aria-label="时间：小时"]'));
  await click([...document.querySelectorAll('[role="option"]')].find(option => option.textContent === '08 时'));
  assert.equal(selected, '08:30');
});

test('Avatar fills missing summary images and tries alternate portraits before initials', async () => {
  await render(h(Avatar, { name: '队长', contact: { small_head_url: 'https://example.com/small', big_head_url: 'https://example.com/big' } }));
  assert.match(document.querySelector('img').src, /\/api\/avatar\?url=/);
  await act(async () => Simulate.error(document.querySelector('img')));
  assert.match(document.querySelector('img').src, /big/);
  await act(async () => Simulate.error(document.querySelector('img')));
  assert.equal(document.querySelector('img'), null);
  assert.equal(document.querySelector('[role="img"]').textContent, '队');
});
