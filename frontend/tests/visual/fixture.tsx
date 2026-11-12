// 仅由本地测试服务器加载；所有接口均由 Playwright 拦截，不能读取真实数据。
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ToastProvider } from '../../src/components/common/Toast';
import { FlirtProbe } from '../../src/components/labs/FlirtProbe';
import { SocialFlow } from '../../src/components/labs/SocialFlow';
import { WeChatView } from '../../src/components/contact/WeChatView';
import { AgentAccessSection } from '../../src/components/settings/system/AgentAccessSection';
import { AIHomePage } from '../../src/components/dashboard/AIHomePage';
import { ReplyAssistant } from '../../src/components/dashboard/ReplyAssistant';
import { SharePreview } from '../../src/components/common/SharePreview';
import { LLMAnalysisTab } from '../../src/components/contact/LLMAnalysisTab';
import type { ContactStats } from '../../src/types';
import '../../src/index.css';

const params = new URLSearchParams(location.search);
if (params.get('theme') === 'dark') document.documentElement.classList.add('dark');
const view = params.get('view');
const component = view === 'flirt' ? <FlirtProbe />
  : view === 'social' ? <SocialFlow />
  : view === 'wechat' ? <WeChatView username="synthetic@chatroom" displayName="虚构测试群" isGroup lastMessageTime="2024-01-01" />
  : view === 'wechat-private' ? <WeChatView username="synthetic-1" displayName="虚构联系人" lastMessageTime="2024-01-01" />
  : view === 'agent' ? <AgentAccessSection contacts={[{ username: 'synthetic-1', remark: '虚构联系人' } as ContactStats]} groups={[]} demo={false} privacyMode={false} />
  : view === 'home' ? <AIHomePage contacts={[{ username: 'synthetic-1', remark: '虚构联系人', nickname: '', total_messages: 3, last_message_time: '2024-01-01' } as ContactStats]} timeRange={{ from: null, to: null, label: '全部' }} onReselect={() => {}} />
  : view === 'reply' ? <ReplyAssistant contacts={[{ username: 'synthetic-1', remark: '虚构联系人' } as ContactStats]} />
  : view === 'share' ? <SharePreview options={{ question: '虚构问题', answer: '虚构回答与私人内容', contactName: '虚构姓名', stats: { timestamp: 1700000000000 } }} onClose={() => {}} />
  : view === 'analysis-contact' ? <LLMAnalysisTab username="synthetic-1" displayName="虚构联系人" isGroup={false} />
  : view === 'analysis-group' ? <LLMAnalysisTab username="synthetic@chatroom" displayName="虚构群聊" isGroup />
  : <div>未知测试场景</div>;
createRoot(document.getElementById('root')!).render(<ToastProvider><main>{component}</main></ToastProvider>);
