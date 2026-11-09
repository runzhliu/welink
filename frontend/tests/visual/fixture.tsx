// 仅由本地测试服务器加载；所有接口均由 Playwright 拦截，不能读取真实数据。
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ToastProvider } from '../../src/components/common/Toast';
import { FlirtProbe } from '../../src/components/labs/FlirtProbe';
import { SocialFlow } from '../../src/components/labs/SocialFlow';
import { WeChatView } from '../../src/components/contact/WeChatView';
import '../../src/index.css';

const params = new URLSearchParams(location.search);
if (params.get('theme') === 'dark') document.documentElement.classList.add('dark');
const view = params.get('view');
const component = view === 'flirt' ? <FlirtProbe />
  : view === 'social' ? <SocialFlow />
  : view === 'wechat' ? <WeChatView username="synthetic@chatroom" displayName="虚构测试群" isGroup lastMessageTime="2024-01-01" />
  : <div>未知测试场景</div>;
createRoot(document.getElementById('root')!).render(<ToastProvider><main>{component}</main></ToastProvider>);
