/**
 * AI 分身 — 三层记忆 + 行为特征统计
 * 学习阶段通过 SSE 推送多步进度
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Loader2, Sparkles, RotateCcw, Users, Brain, BarChart3, MessageSquare, CheckCircle2, Share2, Check, Play, Square } from 'lucide-react';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';
import { avatarSrc } from '../../utils/avatar';
import { contactsApi } from '../../services/api';
import { generateCloneChatImage } from '../../utils/shareImage';
import { RevealLink } from '../common/RevealLink';
import type { GroupInfo } from '../../types';

interface Props {
  username: string;
  displayName: string;
  avatarUrl?: string;
  onOpenSettings?: () => void;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface LearnResult {
  session_id: string;
  sample_count: number;
  private_count: number;
  group_count: number;
  has_profile: boolean;
  has_recent: boolean;
  avg_msg_len: number;
  emoji_pct: number;
}

const COUNT_OPTIONS = [
  { value: 100, label: '100 条' },
  { value: 300, label: '300 条' },
  { value: 1000, label: '1000 条' },
  { value: 2000, label: '2000 条' },
  { value: 0, label: '全部记录' },
];

const LEARN_STEPS = [
  { key: 'loading', icon: MessageSquare, label: '加载聊天记录' },
  { key: 'analyzing', icon: BarChart3, label: '分析聊天特征' },
  { key: 'profile', icon: Brain, label: '提炼人物特征' },
  { key: 'building', icon: CheckCircle2, label: '构建 AI 分身' },
];

export const AICloneTab: React.FC<Props> = ({ username, displayName, avatarUrl, onOpenSettings }) => {
  const { privacyMode } = usePrivacyMode();
  const [count, setCount] = useState(300);
  const [learning, setLearning] = useState(false);
  const [learnStep, setLearnStep] = useState('');
  const [learned, setLearned] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [learnResult, setLearnResult] = useState<LearnResult | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [bio, setBio] = useState('');
  const [extractProfile, setExtractProfile] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [llmInfo, setLlmInfo] = useState<{ provider: string; model: string }>({ provider: '', model: '' });
  const [profiles, setProfiles] = useState<{ id: string; provider: string; model?: string }[]>([]);
  const [profileId, setProfileId] = useState('');
  const [sharing, setSharing] = useState(false);
  const [shareMsg, setShareMsg] = useState<{ ok: boolean; text: string; path?: string } | null>(null);
  // 对话续写
  const [continueMode, setContinueMode] = useState(false);
  const [continueLoading, setContinueLoading] = useState(false);
  const [continueTopic, setContinueTopic] = useState('');
  const [continueRounds, setContinueRounds] = useState(10);
  const [continueMessages, setContinueMessages] = useState<{ speaker: string; content: string }[]>([]);
  const continueAbortRef = useRef<AbortController | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 共同群聊
  const [commonGroups, setCommonGroups] = useState<GroupInfo[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [restoring, setRestoring] = useState(true);

  // 检查是否有缓存的分身档案
  useEffect(() => {
    setRestoring(true);
    fetch(`/api/ai/clone/session/${encodeURIComponent(username)}`)
      .then(r => r.json())
      .then((data: { exists: boolean; session_id?: string; private_count?: number; group_count?: number; has_profile?: boolean; has_recent?: boolean; avg_msg_len?: number; emoji_pct?: number; updated_at?: number }) => {
        if (data.exists && data.session_id) {
          setSessionId(data.session_id);
          setLearnResult({
            session_id: data.session_id,
            sample_count: (data.private_count ?? 0) + (data.group_count ?? 0),
            private_count: data.private_count ?? 0,
            group_count: data.group_count ?? 0,
            has_profile: data.has_profile ?? false,
            has_recent: data.has_recent ?? false,
            avg_msg_len: data.avg_msg_len ?? 0,
            emoji_pct: data.emoji_pct ?? 0,
          });
          setLearned(true);
        }
      })
      .catch(() => {})
      .finally(() => setRestoring(false));
  }, [username]);

  useEffect(() => {
    setGroupsLoading(true);
    contactsApi.getCommonGroups(username)
      .then(groups => setCommonGroups(groups || []))
      .catch(() => {})
      .finally(() => setGroupsLoading(false));
  }, [username]);

  // 获取当前 LLM 配置信息（没填模型名时用 provider 默认模型）
  useEffect(() => {
    const defaultModels: Record<string, string> = {
      deepseek: 'deepseek-chat', kimi: 'kimi-k2.5', gemini: 'gemini-2.0-flash',
      glm: 'glm-4-flash', grok: 'grok-3-mini', minimax: 'MiniMax-Text-01',
      'minimax-cn': 'MiniMax-Text-01', openai: 'gpt-4o-mini', claude: 'claude-haiku-4-5-20251001',
      ollama: 'llama3',
    };
    fetch('/api/preferences').then(r => r.json()).then((d: { llm_profiles?: { id: string; provider: string; model?: string }[]; llm_provider?: string; llm_model?: string }) => {
      const ps = d.llm_profiles ?? [];
      setProfiles(ps);
      if (ps.length > 0 && !profileId) setProfileId(ps[0].id);
      let provider = '', model = '';
      if (ps.length) {
        provider = ps[0].provider;
        model = ps[0].model || '';
      } else if (d.llm_provider) {
        provider = d.llm_provider;
        model = d.llm_model || '';
      }
      if (!model && provider) model = defaultModels[provider] ?? '';
      setLlmInfo({ provider, model });
    }).catch(() => {});
  }, []);

  // 切换 profile 时更新 llmInfo
  useEffect(() => {
    if (!profileId || profiles.length === 0) return;
    const defaultModels: Record<string, string> = {
      deepseek: 'deepseek-chat', kimi: 'kimi-k2.5', gemini: 'gemini-2.0-flash',
      glm: 'glm-4-flash', grok: 'grok-3-mini', minimax: 'MiniMax-Text-01',
      'minimax-cn': 'MiniMax-Text-01', openai: 'gpt-4o-mini', claude: 'claude-haiku-4-5-20251001',
      ollama: 'llama3',
    };
    const p = profiles.find(pp => pp.id === profileId);
    if (p) {
      const model = p.model || defaultModels[p.provider] || '';
      setLlmInfo({ provider: p.provider, model });
    }
  }, [profileId, profiles]);

  const toggleGroup = (groupUsername: string) => {
    setSelectedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupUsername)) next.delete(groupUsername);
      else next.add(groupUsername);
      return next;
    });
  };

  const selectAllGroups = () => {
    if (selectedGroups.size === commonGroups.length) setSelectedGroups(new Set());
    else setSelectedGroups(new Set(commonGroups.map(g => g.username)));
  };

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  // 学习（SSE 多步进度）
  const handleLearn = async () => {
    setLearning(true);
    setLearnStep('');
    setError(null);
    try {
      const resp = await fetch('/api/ai/clone/learn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username, count,
          groups: Array.from(selectedGroups),
          bio: bio.trim(),
          extract_profile: extractProfile,
          profile_id: profileId,
        }),
      });
      if (!resp.ok) {
        const text = await resp.text();
        try { throw new Error(JSON.parse(text).error); } catch { throw new Error(text || resp.statusText); }
      }

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.step) {
              setLearnStep(data.step);
            }
            if (data.done) {
              const result = data as LearnResult & { done: boolean };
              setSessionId(result.session_id);
              setLearnResult(result);
              setLearned(true);
              setMessages([]);
              setTimeout(() => inputRef.current?.focus(), 100);
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (e: unknown) {
      setError((e as Error).message || '学习失败');
    } finally {
      setLearning(false);
      setLearnStep('');
    }
  };

  const handleReset = () => {
    abortRef.current?.abort();
    setLearned(false);
    setSessionId('');
    setLearnResult(null);
    setMessages([]);
    setError(null);
    setInput('');
  };

  // 对话
  // 对话续写
  const handleContinue = useCallback(async () => {
    if (continueLoading || !sessionId) return;
    setContinueLoading(true);
    setContinueMessages([]);
    continueAbortRef.current = new AbortController();

    try {
      const resp = await fetch('/api/ai/clone/continue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          profile_id: profileId,
          rounds: continueRounds,
          topic: continueTopic.trim(),
          my_name: '我',
        }),
        signal: continueAbortRef.current.signal,
      });

      const reader = resp.body?.getReader();
      if (!reader) throw new Error('无法读取');
      const decoder = new TextDecoder();
      let buf = '';
      let full = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const chunk = JSON.parse(line.slice(6)) as { delta?: string; thinking?: string; done?: boolean };
            if (chunk.delta) {
              full += chunk.delta;
              // 实时解析已有的完整行
              const parsed: { speaker: string; content: string }[] = [];
              for (const l of full.split('\n')) {
                const m = l.match(/^(我|TA)：(.+)$/);
                if (m) parsed.push({ speaker: m[1], content: m[2] });
              }
              if (parsed.length > 0) setContinueMessages(parsed);
              scrollToBottom();
            }
          } catch {}
        }
      }
      // 最终解析
      const finalParsed: { speaker: string; content: string }[] = [];
      for (const l of full.split('\n')) {
        const m = l.match(/^(我|TA)：(.+)$/);
        if (m) finalParsed.push({ speaker: m[1], content: m[2] });
      }
      if (finalParsed.length > 0) setContinueMessages(finalParsed);
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') {
        console.error('Continue failed', e);
      }
    } finally {
      setContinueLoading(false);
      continueAbortRef.current = null;
    }
  }, [continueLoading, sessionId, profileId, continueRounds, continueTopic, scrollToBottom]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = { role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);
    setError(null);

    setMessages([...newMessages, { role: 'assistant', content: '' }]);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const resp = await fetch('/api/ai/clone/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          profile_id: profileId,
        }),
        signal: abort.signal,
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? resp.statusText);
      }

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const chunk = JSON.parse(line.slice(6)) as { delta?: string; done?: boolean; error?: string };
            if (chunk.error) throw new Error(chunk.error);
            if (chunk.done) break;
            if (chunk.delta) {
              accumulated += chunk.delta;
              const content = accumulated;
              setMessages(prev => {
                const next = [...prev];
                next[next.length - 1] = { role: 'assistant', content };
                return next;
              });
            }
          } catch (e) {
            if (!(e instanceof SyntaxError)) throw e;
          }
        }
      }
    } catch (e: unknown) {
      if ((e as Error).name === 'AbortError') return;
      setError((e as Error).message || '请求失败');
      setMessages(prev => prev.filter(m => m.content !== '' || m.role !== 'assistant'));
    } finally {
      setLoading(false);
    }
  };

  // ── 恢复中 ──
  if (restoring) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <Loader2 size={24} className="animate-spin text-purple-400" />
        <span className="text-xs text-gray-400">正在加载...</span>
      </div>
    );
  }

  // ── 学习中：多步进度展示 ──
  if (learning) {
    const currentIdx = LEARN_STEPS.findIndex(s => s.key === learnStep);
    return (
      <div className="flex flex-col items-center py-10 gap-6">
        <div className="relative">
          {avatarUrl ? (
            <img loading="lazy" src={avatarSrc(avatarUrl)} alt="" className="w-20 h-20 rounded-full object-cover opacity-60" />
          ) : (
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#07c160] to-[#10aeff] flex items-center justify-center text-white text-2xl font-bold opacity-60">
              {displayName[0]}
            </div>
          )}
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 size={32} className="animate-spin text-purple-500" />
          </div>
        </div>

        <div className="w-full max-w-xs space-y-2">
          {LEARN_STEPS.map((step, i) => {
            const Icon = step.icon;
            const isActive = step.key === learnStep;
            const isDone = currentIdx > i;
            const isPending = currentIdx < i;
            return (
              <div key={step.key} className={`flex items-center gap-3 px-3 py-2 rounded-xl transition-all ${
                isActive ? 'bg-purple-50 dark:bg-purple-500/10' : ''
              }`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                  isDone ? 'bg-[#07c160] text-white' :
                  isActive ? 'bg-purple-500 text-white' :
                  'bg-gray-100 dark:bg-white/10 text-gray-300'
                }`}>
                  {isDone ? <CheckCircle2 size={14} /> :
                   isActive ? <Loader2 size={14} className="animate-spin" /> :
                   <Icon size={14} />}
                </div>
                <span className={`text-xs font-medium ${
                  isDone ? 'text-[#07c160]' :
                  isActive ? 'text-purple-600 dark:text-purple-400 font-bold' :
                  isPending ? 'text-gray-300' : 'text-gray-500'
                }`}>
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── 未学习：选择界面 ──
  if (!learned) {
    return (
      <div className="flex flex-col items-center py-6 gap-5">
        <div className="relative">
          {avatarUrl ? (
            <img loading="lazy" src={avatarSrc(avatarUrl)} alt="" className="w-20 h-20 rounded-full object-cover" />
          ) : (
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#07c160] to-[#10aeff] flex items-center justify-center text-white text-2xl font-bold">
              {displayName[0]}
            </div>
          )}
          <div className="absolute -bottom-1 -right-1 w-7 h-7 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center shadow-lg">
            <Sparkles size={14} className="text-white" />
          </div>
        </div>

        <div className="text-center">
          <h3 className={`text-lg font-bold text-[#1d1d1f] dk-text${privacyMode ? ' privacy-blur' : ''}`}>
            {displayName} 的 AI 分身
          </h3>
          <p className="text-xs text-gray-400 mt-1">AI 将深度学习 TA 的性格、风格和近况，模拟与你对话</p>
        </div>

        {/* 消息数量 */}
        <div className="w-full max-w-md">
          <label className="text-xs font-bold text-gray-500 mb-2 block">学习消息数量（私聊 / 群聊各取最近 N 条）</label>
          <div className="grid grid-cols-5 gap-2">
            {COUNT_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setCount(opt.value)}
                className={`px-2 py-2 rounded-xl text-xs font-bold transition-all ${
                  count === opt.value
                    ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-md'
                    : 'bg-gray-50 dark:bg-white/5 text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* 共同群聊 */}
        <div className="w-full max-w-md">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-bold text-gray-500 flex items-center gap-1">
              <Users size={12} />
              共同群聊中 TA 的发言
            </label>
            {commonGroups.length > 0 && (
              <button onClick={selectAllGroups} className="text-[10px] text-[#07c160] font-bold hover:underline">
                {selectedGroups.size === commonGroups.length ? '取消全选' : '全选'}
              </button>
            )}
          </div>
          {groupsLoading ? (
            <div className="text-xs text-gray-400 flex items-center gap-1.5 py-2">
              <Loader2 size={12} className="animate-spin" /> 加载共同群聊...
            </div>
          ) : commonGroups.length === 0 ? (
            <div className="text-xs text-gray-300 py-2">暂无共同群聊</div>
          ) : (
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
              {commonGroups.map(g => (
                <button
                  key={g.username}
                  onClick={() => toggleGroup(g.username)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-all ${
                    selectedGroups.has(g.username)
                      ? 'bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 ring-1 ring-purple-200 dark:ring-purple-500/30'
                      : 'bg-gray-50 dark:bg-white/5 text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10'
                  }`}
                >
                  {g.small_head_url ? (
                    <img loading="lazy" src={avatarSrc(g.small_head_url)} alt="" className="w-4 h-4 rounded-sm object-cover" />
                  ) : <Users size={12} />}
                  <span className={privacyMode ? 'privacy-blur' : ''}>{g.name}</span>
                </button>
              ))}
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-1.5">选中的群聊中只会提取 TA 的发言，不包含其他人</p>
        </div>

        {/* 背景信息 */}
        <div className="w-full max-w-md">
          <label className="text-xs font-bold text-gray-500 mb-2 block">背景信息（选填）</label>
          <textarea
            value={bio}
            onChange={e => setBio(e.target.value)}
            placeholder="例如：湖南人，在上海工作，我的大学同学，喜欢打篮球和摄影..."
            rows={2}
            className="w-full px-3 py-2 bg-gray-50 dark:bg-white/5 rounded-xl text-xs outline-none focus:ring-2 focus:ring-purple-300/50 dk-text placeholder:text-gray-300 resize-none"
          />
          <p className="text-[10px] text-gray-400 mt-1">补充 TA 的籍贯、工作地、与你的关系等，帮助 AI 更准确地还原 TA</p>
        </div>

        {/* AI 提炼开关 */}
        <div className="w-full max-w-md">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <span className="text-xs font-bold text-gray-500 flex items-center gap-1">
                <Brain size={12} />
                AI 提炼风格特征
              </span>
              <p className="text-[10px] text-gray-400 mt-0.5">额外调用一次 AI 分析说话风格，关闭则直接用原始消息模仿（更快）</p>
            </div>
            <div
              onClick={() => setExtractProfile(!extractProfile)}
              className={`relative w-10 h-5 rounded-full transition-colors ${extractProfile ? 'bg-purple-500' : 'bg-gray-200 dark:bg-white/10'}`}
            >
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${extractProfile ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </div>
          </label>
        </div>

        {error && <div className="text-xs text-red-500">{error}</div>}

        <button
          onClick={handleLearn}
          className="px-8 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-2xl font-bold text-sm shadow-lg hover:shadow-xl transition-all hover:scale-[1.02] active:scale-[0.98]"
        >
          <span className="flex items-center gap-2">
            <Sparkles size={16} />
            开始学习
          </span>
        </button>

        {onOpenSettings && (
          <p className="text-[10px] text-gray-400">
            需要先在 <button onClick={onOpenSettings} className="text-[#07c160] underline">设置</button> 中配置 AI 接口
          </p>
        )}
      </div>
    );
  }

  // ── 已学习：聊天界面 ──
  const r = learnResult;
  return (
    <div className="flex flex-col" style={{ height: 'min(480px, 50vh)' }}>
      {/* Header */}
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-gray-100 dk-border">
        <div className="flex items-center gap-2 min-w-0">
          {avatarUrl ? (
            <img loading="lazy" src={avatarSrc(avatarUrl)} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
          ) : (
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
              {displayName[0]}
            </div>
          )}
          <span className={`text-sm font-bold text-[#1d1d1f] dk-text truncate${privacyMode ? ' privacy-blur' : ''}`}>
            {displayName} 的 AI 分身
          </span>
          <div className="flex items-center gap-1 flex-shrink-0 flex-wrap">
            {r && (
              <span className="text-[10px] text-gray-400 bg-gray-50 dark:bg-white/5 px-2 py-0.5 rounded-full">
                {r.private_count} 私聊{r.group_count > 0 ? ` + ${r.group_count} 群聊` : ''}
                {r.has_profile ? ' · 档案' : ''}{r.has_recent ? ' · 近况' : ''}
              </span>
            )}
            {profiles.length > 1 ? (
              <select
                value={profileId}
                onChange={e => setProfileId(e.target.value)}
                className="text-[10px] text-purple-500 bg-purple-50 dark:bg-purple-500/10 px-2 py-0.5 rounded-full font-medium border-0 outline-none cursor-pointer"
              >
                {profiles.map(p => (
                  <option key={p.id} value={p.id}>{p.provider}{p.model ? ` · ${p.model}` : ''}</option>
                ))}
              </select>
            ) : llmInfo.provider ? (
              <span className="text-[10px] text-purple-500 bg-purple-50 dark:bg-purple-500/10 px-2 py-0.5 rounded-full font-medium">
                {llmInfo.provider}{llmInfo.model ? ` · ${llmInfo.model}` : ''}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {messages.length >= 2 && (
            <button
              onClick={async () => {
                if (sharing) return;
                setSharing(true);
                setShareMsg(null);
                try {
                  const savedPath = await generateCloneChatImage({
                    contactName: displayName,
                    avatarUrl,
                    messages: messages.map(m => ({ role: m.role, content: m.content })),
                    provider: llmInfo.provider,
                    model: llmInfo.model,
                  });
                  const isAppMode = savedPath.startsWith('/') || /^[A-Z]:\\/i.test(savedPath);
                  setShareMsg({ ok: true, text: isAppMode ? `已保存至 ${savedPath}` : '图片已下载', path: isAppMode ? savedPath : undefined });
                } catch (e) {
                  setShareMsg({ ok: false, text: `生成失败：${(e as Error).message}` });
                }
                finally {
                  setSharing(false);
                  setTimeout(() => setShareMsg(null), 4000);
                }
              }}
              disabled={sharing}
              className="text-gray-400 hover:text-[#07c160] transition-colors p-1"
              title="保存聊天截图"
            >
              {sharing ? <Loader2 size={16} className="animate-spin" /> : shareMsg?.ok ? <Check size={16} className="text-[#07c160]" /> : <Share2 size={16} />}
            </button>
          )}
          <button
            onClick={handleReset}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors p-1"
            title="重新学习"
          >
            <RotateCcw size={16} />
          </button>
        </div>
      </div>

      {/* 分享提示 */}
      {shareMsg && (
        <div className={`text-xs px-3 py-1.5 rounded-lg ${shareMsg.ok ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-300'}`}>
          {shareMsg.text}
          {shareMsg.path && <RevealLink path={shareMsg.path} className="ml-2" />}
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 pr-1 min-h-0">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-300">
            <span className="text-sm">学习完成，发一条消息开始对话吧</span>
            {r && (
              <div className="flex items-center gap-3 text-[10px]">
                {r.has_profile && <span className="flex items-center gap-1"><Brain size={10} /> 人物档案</span>}
                {r.has_recent && <span className="flex items-center gap-1"><Sparkles size={10} /> 近期状态</span>}
                <span className="flex items-center gap-1"><BarChart3 size={10} /> 均{r.avg_msg_len}字 · {r.emoji_pct}% emoji</span>
              </div>
            )}
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} gap-2`}>
            {msg.role === 'assistant' && (
              avatarUrl ? (
                <img loading="lazy" src={avatarSrc(avatarUrl)} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0 mt-1" />
              ) : (
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-1">
                  {displayName[0]}
                </div>
              )
            )}
            <div
              className={`max-w-[75%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
                msg.role === 'user'
                  ? 'bg-[#07c160] text-white rounded-br-md'
                  : 'bg-gray-100 dark:bg-white/10 text-[#1d1d1f] dk-text rounded-bl-md'
              }${msg.role === 'assistant' && privacyMode ? ' privacy-blur' : ''}`}
            >
              {msg.content || (loading && i === messages.length - 1 ? (
                <span className="flex items-center gap-1.5 text-gray-400">
                  <Loader2 size={14} className="animate-spin" /> 思考中...
                </span>
              ) : null)}
            </div>
            {msg.role === 'user' && (
              <div className="w-7 h-7 rounded-full bg-[#07c160] flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-1">
                我
              </div>
            )}
          </div>
        ))}
      </div>

      {error && <div className="text-xs text-red-500 mt-2 text-center">{error}</div>}

      {/* 对话续写模式 */}
      {continueMode && (
        <div className="mt-3 pt-3 border-t border-gray-100 dk-border space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#576b95]">对话续写 — AI 模拟你们继续聊天</span>
            <button onClick={() => { setContinueMode(false); setContinueMessages([]); }} className="text-xs text-gray-400 hover:text-red-400">关闭</button>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={continueTopic}
              onChange={e => setContinueTopic(e.target.value)}
              placeholder="起始话题（选填，如：聊聊最近的工作）"
              className="flex-1 px-3 py-1.5 text-xs bg-gray-50 dark:bg-white/5 rounded-xl outline-none focus:ring-1 focus:ring-[#576b95]/30 dk-text placeholder:text-gray-300"
            />
            <select value={continueRounds} onChange={e => setContinueRounds(Number(e.target.value))}
              className="text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 dk-input">
              {[5, 10, 15, 20].map(n => <option key={n} value={n}>{n} 轮</option>)}
            </select>
            {continueLoading ? (
              <button onClick={() => continueAbortRef.current?.abort()}
                className="px-3 py-1.5 bg-red-500 text-white rounded-xl text-xs font-bold">
                <Square size={12} />
              </button>
            ) : (
              <button onClick={handleContinue}
                className="px-3 py-1.5 bg-[#576b95] text-white rounded-xl text-xs font-bold hover:bg-[#4a5d82] transition-colors flex items-center gap-1">
                <Play size={12} /> 开始
              </button>
            )}
          </div>
          {/* 续写结果 */}
          {(continueMessages.length > 0 || continueLoading) && (
            <div className="space-y-2 max-h-[40vh] overflow-y-auto bg-[#f0f0f0] dark:bg-gray-900/50 rounded-2xl p-3">
              {continueMessages.map((m, i) => (
                <div key={i} className={`flex gap-2 ${m.speaker === '我' ? 'flex-row-reverse' : ''}`}>
                  <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-white text-[10px] font-bold ${
                    m.speaker === '我' ? 'bg-[#07c160]' : 'bg-gradient-to-br from-purple-500 to-pink-500'
                  }`}>
                    {m.speaker === '我' ? '我' : displayName[0]}
                  </div>
                  <div className={`max-w-[70%] px-3 py-2 rounded-2xl text-sm ${
                    m.speaker === '我'
                      ? 'bg-[#07c160] text-white rounded-br-sm'
                      : 'bg-white dark:bg-gray-800 text-[#1d1d1f] dark:text-gray-100 rounded-bl-sm shadow-sm'
                  }`}>
                    {m.content}
                  </div>
                </div>
              ))}
              {continueLoading && continueMessages.length === 0 && (
                <div className="flex items-center gap-2 text-gray-400 text-xs py-2">
                  <Loader2 size={14} className="animate-spin" /> 正在续写...
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Input */}
      <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100 dk-border">
        <button
          onClick={() => setContinueMode(v => !v)}
          className={`flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-2xl transition-all ${
            continueMode ? 'bg-[#576b95] text-white' : 'bg-gray-100 dark:bg-white/10 text-gray-400 hover:text-[#576b95] hover:bg-gray-200'
          }`}
          title="对话续写 — AI 模拟你们继续聊天"
        >
          <Play size={16} />
        </button>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder="说点什么..."
          disabled={loading}
          className="flex-1 px-4 py-2.5 bg-gray-50 dark:bg-white/5 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-[#07c160]/30 dk-text disabled:opacity-50 placeholder:text-gray-300"
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          className="w-10 h-10 flex items-center justify-center rounded-2xl bg-gradient-to-r from-purple-500 to-pink-500 text-white disabled:opacity-40 transition-all hover:shadow-md active:scale-95"
        >
          {loading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
        </button>
      </div>
    </div>
  );
};
