import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { Window } from 'happy-dom';

const window = new Window({ url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'ResizeObserver', 'localStorage']) globalThis[key] = key === 'window' ? window : window[key];
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
const { searchApi } = require('../src/services/api.ts');
searchApi.global = async () => [
  { username: 'friend', display_name: '小林', small_head_url: '/old-friend.png', is_group: false, messages: [
    { time: '10:00', date: '2024-01-01', content: '生日快乐', is_mine: false, type: 1 },
    { time: '10:01', date: '2024-01-01', content: '生日快乐', is_mine: true, type: 1 },
  ] },
  { username: 'room@chatroom', display_name: '测试群', small_head_url: '/room.png', is_group: true, messages: [
    { time: '10:02', date: '2024-01-01', content: '生日快乐', is_mine: false, speaker: '小明', avatar_url: '/member.png', type: 1 },
    { time: '10:03', date: '2024-01-01', content: '生日快乐', is_mine: false, type: 1 },
  ] },
];
const { SearchView } = require('../src/components/search/SearchView.tsx');
const { SelfInfoProvider } = require('../src/contexts/SelfInfoContext.tsx');
const { PrivacyModeContext } = require('../src/contexts/PrivacyModeContext.tsx');
after(async () => { await window.happyDOM.close(); });

test('搜索结果按发言者显示头像，缺失时回退且隐私模式遮挡头像', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const contacts = [{ username: 'friend', small_head_url: '/friend.png', big_head_url: '/friend-big.png' }];
  const render = privacyMode => React.createElement(PrivacyModeContext.Provider, { value: { privacyMode, setPrivacyMode() {} } }, React.createElement(SelfInfoProvider, { value: { avatar_url: '/self.png' } }, React.createElement(SearchView, { contacts })));
  await act(async () => root.render(render(false)));
  await act(async () => [...host.querySelectorAll('button')].find(el => el.textContent === '生日快乐').click());
  const avatars = name => [...host.querySelectorAll('[role="img"]')].filter(el => el.getAttribute('aria-label') === name);
  assert.equal(avatars('小林').length, 2);
  assert.ok(avatars('小林').every(el => el.querySelector('img')?.getAttribute('src') === '/friend.png'));
  assert.equal(avatars('我')[0].querySelector('img')?.getAttribute('src'), '/self.png');
  assert.equal(avatars('小明')[0].querySelector('img')?.getAttribute('src'), '/member.png');
  assert.equal(avatars('群成员')[0].querySelector('img'), null);
  await act(async () => avatars('小林')[1].querySelector('img').dispatchEvent(new window.Event('error')));
  assert.equal(avatars('小林')[1].querySelector('img')?.getAttribute('src'), '/friend-big.png');
  await act(async () => root.render(render(true)));
  assert.ok(avatars('小林')[1].classList.contains('privacy-blur'));
  assert.ok(avatars('小明')[0].classList.contains('privacy-blur'));
  await act(async () => root.unmount());
  host.remove();
});
