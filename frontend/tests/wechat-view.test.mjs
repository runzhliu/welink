import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { Window } from 'happy-dom';

const window = new Window({ url: 'http://localhost/' });
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
const calls = [];
axios.get = async url => {
  calls.push(url);
  return { data: url.includes('active-dates') ? { dates: ['2024-01-01'] } : [
    { time: '10:00', speaker: '小明', avatar_url: '/member.png', content: '群成员消息', is_mine: false, type: 1 },
    { time: '10:01', speaker: '我', content: '本人消息', is_mine: true, type: 1 },
  ] };
};
const { WeChatView } = require('../src/components/contact/WeChatView.tsx');
const { ToastProvider } = require('../src/components/common/Toast.tsx');
const { SelfInfoProvider } = require('../src/contexts/SelfInfoContext.tsx');
const { PrivacyModeContext } = require('../src/contexts/PrivacyModeContext.tsx');
const pngExport = require('../src/utils/exportPng.ts');

after(async () => { await window.happyDOM.close(); });
test('群聊微信视图读取群消息并区分成员头像与本人头像', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(ToastProvider, null, React.createElement(SelfInfoProvider, { value: { nickname: '我', avatar_url: '/self.png' } }, React.createElement(WeChatView, { username: 'room@chatroom', displayName: '测试群', isGroup: true }))));
  });
  assert.ok(calls.includes('/api/groups/messages'));
  assert.ok(!calls.includes('/api/contacts/messages'));
  assert.match(host.textContent, /小明/);
  assert.equal(host.querySelector('img[src="/member.png"]')?.getAttribute('src'), '/member.png');
  assert.equal(host.querySelector('img[src="/self.png"]')?.getAttribute('src'), '/self.png');
  assert.ok(host.textContent.includes('群成员消息') && host.textContent.includes('本人消息'));
  await act(async () => {
    root.render(React.createElement(ToastProvider, null, React.createElement(PrivacyModeContext.Provider, { value: { privacyMode: true, setPrivacyMode() {} } }, React.createElement(SelfInfoProvider, { value: { nickname: '我', avatar_url: '/self.png' } }, React.createElement(WeChatView, { username: 'room@chatroom', displayName: '测试群', isGroup: true })))));
  });
  assert.ok(!host.textContent.includes('小明') && !host.textContent.includes('测试群'));
  assert.equal(host.querySelectorAll('img').length, 0);
  await act(async () => root.unmount());
  host.remove();
});

test('导出完整聊天时仅调整副本中的文字，页面内容和气泡尖角保持原位', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  let captured;
  const originalCapture = pngExport.captureCardToPng;
  pngExport.captureCardToPng = async (card, options) => {
    const wrapper = document.createElement('div');
    wrapper.appendChild(card.cloneNode(true));
    await options.beforeCapture(wrapper);
    captured = { wrapper, options };
    return { ok: true, size: 1 };
  };
  try {
    await act(async () => root.render(React.createElement(ToastProvider, null, React.createElement(WeChatView, { username: 'contact', displayName: '测试联系人' }))));
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent.includes('导出图片')).click());
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent.includes('下载 PNG')).click());
    assert.ok(captured);
    const exportedContent = captured.wrapper.querySelector('[data-wechat-content]');
    assert.equal(exportedContent.textContent, '群成员消息');
    assert.equal(exportedContent.style.top, '-5px');
    assert.equal(host.querySelector('[data-wechat-content]').style.top, '');
    assert.equal(captured.wrapper.querySelector('[data-wechat-messages]').style.overflow, 'visible');
    assert.equal(captured.wrapper.querySelector('[data-wechat-bubble] > span:last-child').style.top, '13px');
  } finally {
    pngExport.captureCardToPng = originalCapture;
    await act(async () => root.unmount());
    host.remove();
  }
});
