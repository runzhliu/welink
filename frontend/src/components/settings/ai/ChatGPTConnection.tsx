import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Loader2 } from 'lucide-react';
import { Select } from '../../common/Select';
import type { LLMProfile } from './types';

type Model = { slug: string; name: string };

export const ChatGPTConnection: React.FC<{ profile: LLMProfile; onChange: (p: LLMProfile) => void; onSaveAndTest: (id: string) => void; testing: boolean; testMsg: { ok: boolean; text: string } | null }> = ({ profile, onChange, onSaveAndTest, testing, testMsg }) => {
  const [authorized, setAuthorized] = useState(false);
  const [email, setEmail] = useState('');
  const [models, setModels] = useState<Model[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const headers = { 'X-WeLink-Local-Origin': window.location.origin };
  const local = window.location.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(window.location.hostname);

  const refresh = useCallback(async () => {
    const headers = { 'X-WeLink-Local-Origin': window.location.origin };
    try {
      const status = await axios.get<{ authorized: boolean; email: string; error?: string }>('/api/auth/chatgpt/status', { headers });
      setAuthorized(status.data.authorized); setEmail(status.data.email || '');
      if (status.data.error) setMessage(status.data.error);
      if (status.data.authorized) {
        try { const result = await axios.get<{ models: Model[] }>('/api/auth/chatgpt/models', { headers }); setModels(result.data.models); }
        catch { setModels([]); setMessage('已授权，但获取模型列表失败，请检查网络后重试。'); }
      } else setModels([]);
      return status.data.authorized;
    } catch { return false; }
  }, []);

  useEffect(() => { if (local) void refresh(); return () => { if (poll.current) clearInterval(poll.current); }; }, [local, refresh]);

  const connect = async () => {
    setMessage('');
    const popup = window.open('', '_blank');
    if (!popup) { setMessage('浏览器阻止了授权窗口，请允许弹窗后重试。'); return; }
    try {
      popup.opener = null;
      const result = await axios.post<{ url: string }>('/api/auth/chatgpt/start', {}, { headers });
      popup.location.replace(result.data.url);
      setBusy(true); let attempts = 0;
      if (poll.current) clearInterval(poll.current);
      poll.current = setInterval(async () => {
        attempts++;
        if (await refresh() || attempts >= 150 || popup.closed) {
          if (poll.current) clearInterval(poll.current); poll.current = null; setBusy(false);
          if (attempts >= 150) setMessage('授权等待超时，请重试。');
        }
      }, 2000);
    } catch { popup.close(); setMessage('无法启动授权，请确认使用本机地址访问 WeLink。'); }
  };
  const disconnect = async () => {
    try {
      const result = await axios.delete<{ revoked: boolean }>('/api/auth/chatgpt', { headers });
      setAuthorized(false); setEmail(''); setModels([]);
      setMessage(result.data.revoked ? '已退出 ChatGPT。' : '本地授权已清除，但未能确认远端撤销；请在 ChatGPT 设置中检查应用授权。');
    } catch { setMessage('退出失败，请检查网络或重试。'); }
  };

  return <div className="space-y-4">
    <p className="text-xs leading-relaxed text-[var(--text-secondary)]">使用符合条件的 ChatGPT 订阅额度进行文本分析，无需 API Key。分析时选定的聊天内容会发送给 OpenAI。</p>
    {!local && <p className="text-xs text-amber-600">请通过本机 localhost 或 127.0.0.1 的 HTTP 地址打开 WeLink 后授权；远程网页和公开演示暂不支持此登录方式。</p>}
    <div className="flex flex-wrap items-center gap-3">
      {authorized ? <><span className="text-sm text-[var(--accent-text)]">已连接{email ? ` · ${email}` : ''}</span><button type="button" className="ui-button ui-button-secondary" onClick={disconnect}>退出授权</button><button type="button" className="ui-button ui-button-secondary" onClick={() => void refresh()}>刷新模型</button></> : <button type="button" className="ui-button ui-button-secondary" disabled={!local || busy} onClick={connect}>{busy && <Loader2 size={14} className="animate-spin" />}Continue with ChatGPT</button>}
      {busy && <span className="text-xs text-[var(--text-secondary)]">等待浏览器授权…</span>}
    </div>
    {message && <p role="status" className="text-xs text-[var(--text-secondary)]">{message}</p>}
    <div><label className="block text-xs font-medium mb-1.5" htmlFor={`chatgpt-model-${profile.id}`}>模型</label>
      <Select id={`chatgpt-model-${profile.id}`} value={profile.model || ''} onValueChange={model => onChange({ ...profile, model })} className="w-full ui-select">
        <option value="">{authorized ? '请选择可用模型' : '授权后选择模型'}</option>
        {profile.model && !models.some(m => m.slug === profile.model) && <option value={profile.model}>{profile.model}</option>}
        {models.map(m => <option key={m.slug} value={m.slug}>{m.name || m.slug}</option>)}
      </Select>
    </div>
    <div className="flex flex-wrap items-center gap-2"><button type="button" className="ui-button ui-button-secondary" disabled={!authorized || !profile.model || testing} onClick={() => onSaveAndTest(profile.id)}>{testing && <Loader2 size={12} className="animate-spin" />}测试连接</button>{testMsg && <span role="status" className={`text-xs ${testMsg.ok ? 'text-[var(--accent-text)]' : 'text-red-500'}`}>{testMsg.text}</span>}</div>
    <p className="text-xs text-[var(--text-muted)]">仅文本模型；订阅权限、模型和额度由 OpenAI 决定。授权信息保存在本机 WeLink 配置目录。可在 <a href="https://chatgpt.com/#settings/usage" target="_blank" rel="noreferrer" className="text-[var(--accent-text)] underline">ChatGPT 设置</a>中管理授权和用量。</p>
  </div>;
};
