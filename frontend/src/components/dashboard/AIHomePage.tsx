/**
 * AI 首页 — 以「直接问我」为核心的纯净首页，对话直接在页面内生成
 */

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Bot, Send, X, Search, RotateCcw, Loader2, Copy, Check, Square, ArrowLeft, Share2, Users, Plus, ChevronDown, ChevronRight, BrainCircuit, Globe } from 'lucide-react';
import { CrossContactQA } from './CrossContactQA';
import { ConversationHistory } from './ConversationHistory';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { generateShareImage } from '../../utils/shareImage';
import { avatarSrc } from '../../utils/avatar';
import type { ContactStats, TimeRange, ChatMessage, GroupInfo, GroupChatMessage } from '../../types';
import { contactsApi, groupsApi } from '../../services/api';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';

const PROVIDER_LABELS: Record<string, string> = {
  deepseek: 'DeepSeek', kimi: 'Kimi', gemini: 'Gemini', glm: 'GLM',
  grok: 'Grok', openai: 'OpenAI', claude: 'Claude', ollama: 'Ollama', custom: '自定义',
};

// ─── 可选对象（联系人 or 群聊）──────────────────────────────────────────────

type SelectableItem =
  | { kind: 'contact'; data: ContactStats }
  | { kind: 'group'; data: GroupInfo };

function itemName(item: SelectableItem): string {
  if (item.kind === 'contact') return item.data.remark || item.data.nickname || item.data.username;
  return item.data.name || item.data.username;
}

function itemAvatar(item: SelectableItem): string | undefined {
  if (item.kind === 'contact') return item.data.small_head_url || item.data.big_head_url || undefined;
  return item.data.small_head_url || undefined;
}

function itemId(item: SelectableItem): string {
  return (item.kind === 'contact' ? 'c:' : 'g:') + item.data.username;
}

// ─── 隐私脱敏 ─────────────────────────────────────────────────────────────────

function maskPrivacy(text: string, displayName?: string): string {
  let r = text;
  r = r.replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, '[手机号]');
  r = r.replace(/[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[012])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]/gi, '[身份证]');
  r = r.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '[邮箱]');
  r = r.replace(/(?<!\[)\b\d{16,19}\b/g, '[卡号]');
  if (displayName && displayName.length >= 2) {
    const escaped = displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    r = r.replace(new RegExp(escaped, 'g'), '[联系人]');
  }
  return r;
}

// ─── 快捷预设 Prompt ───────────────────────────────────────────────────────────

const PRESETS = [
  { label: '关系分析', prompt: '请分析聊天记录中的关系特点，包括互动频率、话题偏好和情感倾向。' },
  { label: '情感变化', prompt: '请分析聊天记录中情感基调的变化，找出情绪高峰和低谷的时期，以及可能的原因。' },
  { label: '高频话题', prompt: '请总结聊天中最常讨论的话题和关键词，并分析各话题的比重与变化趋势。' },
  { label: '沟通风格', prompt: '请分析聊天中各方的沟通风格：用词习惯、句子长短、表达方式，以及风格的异同。' },
  { label: '趣味总结', prompt: '请用轻松有趣的方式总结聊天记录，找出印象最深的对话片段或有趣的互动模式。' },
];

// ─── 多选对象选择器 ────────────────────────────────────────────────────────────
// 以 chips + 小「+」按钮呈现，避免与下方聊天输入框混淆

const SubjectPicker: React.FC<{
  contacts: ContactStats[];
  groups: GroupInfo[];
  selected: SelectableItem[];
  onAdd: (item: SelectableItem) => void;
  onRemove: (id: string) => void;
  disabled?: boolean;
}> = ({ contacts, groups, selected, onAdd, onRemove, disabled }) => {
  const { privacyMode } = usePrivacyMode();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const ref = useRef<HTMLDivElement>(null);

  const selectedIds = useMemo(() => new Set(selected.map(itemId)), [selected]);

  const filteredContacts = useMemo(() => {
    const q = query.toLowerCase();
    return contacts
      .filter(c => !selectedIds.has('c:' + c.username) && (c.remark + c.nickname + c.username).toLowerCase().includes(q))
      .slice(0, 8);
  }, [contacts, query, selectedIds]);

  const filteredGroups = useMemo(() => {
    const q = query.toLowerCase();
    return groups
      .filter(g => !selectedIds.has('g:' + g.username) && (g.name + g.username).toLowerCase().includes(q))
      .slice(0, 6);
  }, [groups, query, selectedIds]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setQuery(''); }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const openSearch = () => {
    setOpen(true);
    setTimeout(() => searchRef.current?.focus(), 30);
  };

  const showDropdown = open && (filteredContacts.length > 0 || filteredGroups.length > 0 || query.length === 0);

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center gap-2 flex-wrap min-h-[28px]">
        {/* 标签 */}
        <span className="text-[11px] font-bold text-gray-300 flex-shrink-0 select-none">分析对象</span>

        {/* 已选 chips */}
        {selected.map(item => {
          const name = itemName(item);
          const avatar = itemAvatar(item);
          const id = itemId(item);
          return (
            <div key={id} className="flex items-center gap-1 pl-1 pr-1 py-0.5 bg-[#f0faf4] dark:bg-[#07c160]/15 border border-[#07c160]/25 rounded-full">
              {avatar
                ? <img src={avatarSrc(avatar)} className="w-5 h-5 rounded-full object-cover flex-shrink-0" alt={name} />
                : item.kind === 'group'
                  ? <div className="w-5 h-5 rounded-full bg-[#576b95]/15 flex items-center justify-center flex-shrink-0"><Users size={10} className="text-[#576b95]" /></div>
                  : <div className="w-5 h-5 rounded-full bg-[#07c160] flex items-center justify-center text-white text-[9px] font-black flex-shrink-0">{name[0]}</div>
              }
              <span className={`text-xs font-semibold text-[#07c160] max-w-[72px] truncate${privacyMode ? ' privacy-blur' : ''}`}>{name}</span>
              {!disabled && (
                <button onClick={() => onRemove(id)} className="text-[#07c160]/40 hover:text-[#07c160] transition-colors p-0.5 ml-0.5">
                  <X size={9} />
                </button>
              )}
            </div>
          );
        })}

        {/* + 添加 按钮 */}
        {!disabled && (
          open ? (
            <div className="flex items-center gap-1 bg-white dark:bg-white/10 border border-[#07c160]/40 rounded-full px-2 py-0.5">
              <Search size={11} className="text-gray-300 flex-shrink-0" />
              <input
                ref={searchRef}
                className="text-xs bg-transparent outline-none placeholder-gray-300 dark:placeholder-gray-500 dark:text-gray-200 w-28"
                placeholder="搜索联系人或群聊…"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
              <button onClick={() => { setOpen(false); setQuery(''); }} className="text-gray-300 hover:text-gray-500 dark:hover:text-gray-300 transition-colors">
                <X size={10} />
              </button>
            </div>
          ) : (
            <button
              onClick={openSearch}
              className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-dashed border-gray-300 dark:border-gray-600 text-[11px] font-semibold text-gray-400 dark:text-gray-500 hover:border-[#07c160] hover:text-[#07c160] hover:bg-[#f0faf4] dark:hover:bg-[#07c160]/10 transition-colors"
            >
              <Plus size={11} />
              {selected.length === 0 ? '选择联系人或群聊' : '添加'}
            </button>
          )
        )}
      </div>

      {/* 下拉列表 */}
      {showDropdown && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1.5 bg-white dark:bg-[#2c2c2e] border border-gray-100 dark:border-white/10 rounded-2xl shadow-xl overflow-hidden max-h-72 overflow-y-auto">
          {filteredContacts.length === 0 && filteredGroups.length === 0 && query && (
            <div className="px-4 py-3 text-sm text-gray-400 text-center">未找到匹配项</div>
          )}
          {filteredContacts.length === 0 && filteredGroups.length === 0 && !query && (
            <div className="px-4 py-3 text-xs text-gray-400 text-center">输入名称搜索…</div>
          )}
          {filteredContacts.length > 0 && (
            <>
              <div className="px-3 pt-2 pb-1 text-[10px] font-black text-gray-300 dark:text-gray-500 uppercase tracking-widest">联系人</div>
              {filteredContacts.map(c => {
                const name = c.remark || c.nickname || c.username;
                const avatar = c.small_head_url || c.big_head_url;
                return (
                  <button
                    key={c.username}
                    className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-[#f0faf4] dark:hover:bg-white/5 transition-colors text-left"
                    onMouseDown={e => { e.preventDefault(); onAdd({ kind: 'contact', data: c }); setQuery(''); setOpen(false); }}
                  >
                    {avatar
                      ? <img src={avatarSrc(avatar)} className="w-7 h-7 rounded-full object-cover flex-shrink-0" alt={name} />
                      : <div className="w-7 h-7 rounded-full bg-[#07c160]/20 flex items-center justify-center text-[#07c160] text-sm font-black flex-shrink-0">{name[0]}</div>
                    }
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-[#1d1d1f] dark:text-gray-100 truncate">{name}</div>
                      <div className="text-[10px] text-gray-400">{c.total_messages.toLocaleString()} 条消息</div>
                    </div>
                  </button>
                );
              })}
            </>
          )}
          {filteredGroups.length > 0 && (
            <>
              <div className={`px-3 pt-2 pb-1 text-[10px] font-black text-gray-300 dark:text-gray-500 uppercase tracking-widest ${filteredContacts.length > 0 ? 'border-t border-gray-50 dark:border-white/5' : ''}`}>群聊</div>
              {filteredGroups.map(g => {
                const name = g.name || g.username;
                const avatar = g.small_head_url;
                return (
                  <button
                    key={g.username}
                    className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-[#f0faf4] dark:hover:bg-white/5 transition-colors text-left"
                    onMouseDown={e => { e.preventDefault(); onAdd({ kind: 'group', data: g }); setQuery(''); setOpen(false); }}
                  >
                    {avatar
                      ? <img src={avatarSrc(avatar)} className="w-7 h-7 rounded-full object-cover flex-shrink-0" alt={name} />
                      : <div className="w-7 h-7 rounded-full bg-[#576b95]/20 flex items-center justify-center flex-shrink-0"><Users size={14} className="text-[#576b95]" /></div>
                    }
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-[#1d1d1f] dark:text-gray-100 truncate">{name}</div>
                      <div className="text-[10px] text-gray-400">{g.total_messages.toLocaleString()} 条消息 · 群聊</div>
                    </div>
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
};

// ─── 消息气泡 ──────────────────────────────────────────────────────────────────

type ChatMsg = {
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  streaming?: boolean;
  stats?: { elapsed: number; tokensPerSec: number; chars: number; provider?: string; model?: string; timestamp?: number };
};

const MessageBubble: React.FC<{
  msg: ChatMsg;
  contactName?: string;
  avatarUrl?: string;
  prevQuestion?: string;
  llmProvider?: string;
  llmModel?: string;
}> = ({ msg, contactName, avatarUrl, prevQuestion, llmProvider, llmModel }) => {
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState(false);

  if (msg.role === 'user') {
    return (
      <div className="flex gap-2 flex-row-reverse">
        <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center bg-[#07c160] text-white text-[10px] font-black">我</div>
        <div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-br-sm text-sm leading-relaxed whitespace-pre-wrap break-words bg-[#07c160] text-white">
          {msg.content}
        </div>
      </div>
    );
  }

  const handleCopy = () => {
    if (!msg.content) return;
    navigator.clipboard.writeText(msg.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  const [shareMsg, setShareMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const handleShare = async () => {
    if (!msg.content || sharing) return;
    setSharing(true);
    setShareMsg(null);
    try {
      const savedPath = await generateShareImage({
        question: prevQuestion,
        answer: msg.content,
        contactName,
        avatarUrl,
        stats: msg.stats ? {
          provider: msg.stats.provider,
          model: msg.stats.model,
          elapsedSecs: msg.stats.elapsed,
          tokensPerSec: msg.stats.tokensPerSec,
          charCount: msg.stats.chars,
          timestamp: msg.stats.timestamp,
        } : undefined,
      });
      const isAppMode = savedPath.startsWith('/') || /^[A-Z]:\\/i.test(savedPath);
      setShareMsg({ ok: true, text: isAppMode ? `已保存至 ${savedPath}` : '图片已下载' });
    } catch (err) {
      setShareMsg({ ok: false, text: `生成失败：${(err as Error).message}` });
    } finally {
      setSharing(false);
      setTimeout(() => setShareMsg(null), 4000);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2 flex-row group">
        <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center bg-[#576b95] text-white mt-0.5">
          <Bot size={13} />
        </div>
        <div className="flex flex-col gap-1 max-w-[80%]">
          <div className="px-4 py-2.5 rounded-2xl rounded-bl-sm text-sm leading-relaxed bg-[#f0f0f0] dark:bg-white/10 text-[#1d1d1f] dark:text-gray-100 prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-hr:my-2">
            {msg.thinking && (
              <div className="not-prose mb-2">
                <button
                  onClick={() => setThinkingOpen(v => !v)}
                  className="flex items-center gap-1.5 text-[11px] text-[#576b95] hover:text-[#576b95]/80 transition-colors"
                >
                  <BrainCircuit size={12} />
                  <span>{msg.streaming && !msg.content ? '正在思考…' : '思考过程'}</span>
                  {thinkingOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                </button>
                {thinkingOpen && (
                  <div className={`mt-1.5 px-3 py-2 rounded-lg bg-[#576b95]/8 dark:bg-[#576b95]/15 border border-[#576b95]/15 text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed whitespace-pre-wrap font-mono ${msg.streaming ? '' : 'max-h-48 overflow-y-auto'}`}>
                    {msg.thinking}
                  </div>
                )}
              </div>
            )}
            {msg.content
              ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
              : msg.streaming
                ? <span className="flex items-center gap-2 text-gray-400 text-xs">
                    <Loader2 size={13} className="animate-spin text-[#576b95] flex-shrink-0" />
                    <span>{msg.thinking ? '正在生成回答…' : '正在分析，请稍候…'}{llmProvider && <span className="ml-1.5 text-[#576b95]/70">{llmProvider}{llmModel ? ` · ${llmModel}` : ''}</span>}</span>
                  </span>
                : ''}
            {msg.stats && !msg.streaming && (
              <div className="flex flex-col items-end gap-0.5 mt-2 text-[10px] text-gray-400 not-prose">
                {msg.stats.provider && (
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium">{msg.stats.provider}{msg.stats.model ? ` · ${msg.stats.model}` : ''}</span>
                    <span className="text-gray-300">·</span>
                    <span>{msg.stats.elapsed.toFixed(1)}s</span>
                    <span className="text-gray-300">·</span>
                    <span>~{msg.stats.tokensPerSec} tok/s</span>
                    <span className="text-gray-300">·</span>
                    <span>{msg.stats.chars} 字符</span>
                  </div>
                )}
                {msg.stats.timestamp && (() => {
                  const d = new Date(msg.stats!.timestamp!);
                  return <span>{d.getFullYear()}年{d.getMonth()+1}月{d.getDate()}日{d.getHours()}点{String(d.getMinutes()).padStart(2,'0')}分</span>;
                })()}
              </div>
            )}
          </div>
          {msg.content && !msg.streaming && (
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold text-gray-400 hover:text-[#07c160] hover:bg-[#f0faf4] dark:hover:bg-[#07c160]/10 transition-colors"
                title="复制内容"
              >
                {copied ? <Check size={11} className="text-[#07c160]" /> : <Copy size={11} />}
                {copied ? '已复制' : '复制'}
              </button>
              <button
                onClick={handleShare}
                disabled={sharing}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold text-gray-400 hover:text-[#576b95] hover:bg-[#f0f4ff] dark:hover:bg-[#576b95]/15 transition-colors disabled:opacity-50"
                title="保存为图片分享"
              >
                {sharing ? <Loader2 size={11} className="animate-spin" /> : <Share2 size={11} />}
                {sharing ? '生成中…' : '分享'}
              </button>
            </div>
          )}
        </div>
      </div>
      {shareMsg && (
        <p className={`text-[10px] font-medium ml-9 break-all leading-relaxed ${shareMsg.ok ? 'text-[#07c160]' : 'text-red-500'}`}>
          {shareMsg.text}
        </p>
      )}
    </div>
  );
};

// ─── 主组件 ───────────────────────────────────────────────────────────────────

export interface AIHomePageProps {
  contacts: ContactStats[];
  timeRange: TimeRange;
  onReselect: () => void;
  onContactClick?: (contact: ContactStats) => void;
  onGroupClick?: (group: GroupInfo) => void;
}

export const AIHomePage: React.FC<AIHomePageProps> = ({
  contacts,
  timeRange,
  onReselect,
  onContactClick,
  onGroupClick,
}) => {
  const { privacyMode } = usePrivacyMode();
  const [mode, setMode] = useState<'contact' | 'cross'>('contact');
  const [selectedItems, setSelectedItems] = useState<SelectableItem[]>([]);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [input, setInput] = useState('');
  const [noSelectionHint, setNoSelectionHint] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loading, setLoading] = useState(false);
  const [homeMsgLimit, setHomeMsgLimit] = useState<number | null>(200); // null = 全部
  const [ctxLoading, setCtxLoading] = useState(false);
  const [conversationKey, setConversationKey] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const hasChatHistory = messages.length > 0;

  // 加载群聊列表
  useEffect(() => {
    groupsApi.getList().then(setGroups).catch(() => {});
  }, []);

  // Provider profiles（支持多配置切换）
  interface ProfileItem { id: string; name: string; provider: string; model?: string; }
  const [profiles, setProfiles] = useState<ProfileItem[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  useEffect(() => {
    fetch('/api/preferences')
      .then(r => r.json())
      .then((d: { llm_profiles?: ProfileItem[]; llm_provider?: string; llm_model?: string }) => {
        if (d.llm_profiles && d.llm_profiles.length > 0) {
          setProfiles(d.llm_profiles);
          setSelectedProfileId(d.llm_profiles[0].id);
        } else if (d.llm_provider) {
          const p = { id: '__default__', name: d.llm_provider, provider: d.llm_provider, model: d.llm_model ?? '' };
          setProfiles([p]);
          setSelectedProfileId('__default__');
        }
      })
      .catch(() => {});
  }, []);
  const selectedProfile = profiles.find(p => p.id === selectedProfileId) ?? profiles[0];
  const llmProvider = selectedProfile?.provider ?? '';
  const llmModel = selectedProfile?.model ?? '';

  // 最近聊天：联系人 + 群聊，按最后消息时间排序取前 14 个
  const recentItems = useMemo(() => {
    const contactItems: SelectableItem[] = contacts
      .filter(c => c.total_messages > 0)
      .map(c => ({ kind: 'contact' as const, data: c }));
    const groupItems: SelectableItem[] = groups
      .map(g => ({ kind: 'group' as const, data: g }));
    const all = [...contactItems, ...groupItems];
    return all.sort((a, b) => {
      const aT = new Date(a.data.last_message_time).getTime();
      const bT = new Date(b.data.last_message_time).getTime();
      return bT - aT;
    }).slice(0, 14);
  }, [contacts, groups]);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, []);

  useEffect(() => {
    if (hasChatHistory) scrollToBottom();
  }, [messages.length, hasChatHistory, scrollToBottom]);

  const handleNewChat = () => {
    abortRef.current?.abort();
    setMessages([]);
    setLoading(false);
    setCtxLoading(false);
    setInput('');
  };

  const handleAddItem = (item: SelectableItem) => {
    const id = itemId(item);
    setSelectedItems(prev => prev.some(s => itemId(s) === id) ? prev : [...prev, item]);
  };

  const handleRemoveItem = (id: string) => {
    setSelectedItems(prev => {
      const next = prev.filter(s => itemId(s) !== id);
      if (next.length === 0) handleNewChat();
      return next;
    });
  };

  const sendMessage = useCallback(async (q: string) => {
    if (!q.trim() || loading) return;
    if (selectedItems.length === 0) {
      setNoSelectionHint(true);
      setTimeout(() => setNoSelectionHint(false), 2000);
      textareaRef.current?.focus();
      return;
    }

    setLoading(true);
    setCtxLoading(true);
    setInput('');

    // 加载所有选中对象的消息
    const totalLimit = homeMsgLimit;
    const perItem = totalLimit != null ? Math.max(50, Math.floor(totalLimit / selectedItems.length)) : undefined;
    const sections: string[] = [];

    try {
      for (const item of selectedItems) {
        const name = itemName(item);
        if (item.kind === 'contact') {
          const msgs: ChatMessage[] = await contactsApi.exportMessages(item.data.username) ?? [];
          const recent = perItem && msgs.length > perItem ? msgs.slice(-perItem) : msgs;
          const lines = recent.map(m => `[${m.date ?? ''} ${m.time}] ${m.is_mine ? '我' : name}：${m.content}`);
          sections.push(`=== 与「${name}」的聊天记录 ===\n${lines.map(l => maskPrivacy(l, name)).join('\n')}`);
        } else {
          const msgs: GroupChatMessage[] = await groupsApi.exportMessages(item.data.username) ?? [];
          const recent = perItem && msgs.length > perItem ? msgs.slice(-perItem) : msgs;
          const lines = recent.map(m => `[${m.date ?? ''} ${m.time}] ${m.speaker || '成员'}：${m.content}`);
          sections.push(`=== 「${name}」群聊记录 ===\n${lines.map(l => maskPrivacy(l)).join('\n')}`);
        }
      }
    } catch { /* ignore */ }
    setCtxLoading(false);

    const ctxText = sections.join('\n\n');
    const contactLabels = selectedItems.map(item =>
      item.kind === 'contact' ? `「${itemName(item)}」` : `「${itemName(item)}」群`
    ).join('、');

    const userMsg: ChatMsg = { role: 'user', content: q.trim() };
    const newMessages = [...messages, userMsg];
    const assistantIdx = newMessages.length;
    setMessages([...newMessages, { role: 'assistant', content: '', streaming: true }]);
    scrollToBottom();

    const sysPrompt = ctxText
      ? `你是一个聊天记录分析助手。以下是${contactLabels}的聊天记录（已脱敏处理）：\n\n${ctxText}\n\n请根据以上聊天记录回答用户的问题，分析时请客观、有洞察力，用中文回答，语言自然流畅。`
      : `你是一个聊天记录分析助手，请帮助分析${contactLabels}的聊天记录，用中文回答。`;

    const abort = new AbortController();
    abortRef.current = abort;
    const streamStart = Date.now();

    try {
      const resp = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: sysPrompt },
            ...newMessages.map(m => ({ role: m.role, content: m.content })),
          ],
          profile_id: selectedProfileId !== '__default__' ? selectedProfileId : '',
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

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const chunk = JSON.parse(line.slice(6)) as { delta?: string; thinking?: string; done?: boolean; error?: string };
            if (chunk.error) throw new Error(chunk.error);
            if (chunk.done) break;
            if (chunk.delta || chunk.thinking) {
              setMessages(prev => {
                const next = [...prev];
                const msg = next[assistantIdx];
                if (msg) next[assistantIdx] = {
                  ...msg,
                  content: chunk.delta ? msg.content + chunk.delta : msg.content,
                  thinking: chunk.thinking ? (msg.thinking ?? '') + chunk.thinking : msg.thinking,
                };
                return next;
              });
              scrollToBottom();
            }
          } catch (e) {
            if (!(e instanceof SyntaxError)) throw e;
          }
        }
      }
    } catch (e: unknown) {
      if ((e as { name?: string }).name === 'AbortError') return;
      setMessages(prev => {
        const next = [...prev];
        const msg = next[assistantIdx];
        if (msg) next[assistantIdx] = { ...msg, content: `❌ ${e instanceof Error ? e.message : '请求失败'}`, streaming: false };
        return next;
      });
    } finally {
      const elapsed = (Date.now() - streamStart) / 1000;
      setMessages(prev => {
        const next = [...prev];
        const msg = next[assistantIdx];
        if (msg?.streaming) {
          const chars = msg.content.length;
          const tokensPerSec = elapsed > 0.1 ? Math.round(chars / elapsed / 1.5) : 0;
          next[assistantIdx] = { ...msg, streaming: false, stats: { elapsed, tokensPerSec, chars, provider: llmProvider, model: llmModel, timestamp: Date.now() } };
        }
        return next;
      });
      setLoading(false);
      abortRef.current = null;
    }
  }, [loading, selectedItems, messages, scrollToBottom, selectedProfileId, llmProvider, llmModel]);

  // 自动保存对话到后端
  useEffect(() => {
    if (loading || messages.length === 0) return;
    // 至少有一条 assistant 消息且不在 streaming 状态
    const hasComplete = messages.some(m => m.role === 'assistant' && !m.streaming && m.content);
    if (!hasComplete) return;

    // 生成 key（如果没有）
    let key = conversationKey;
    if (!key) {
      key = `ai-home:${Date.now()}`;
      setConversationKey(key);
    }

    // 保存
    const saveData = messages.map(m => ({
      role: m.role,
      content: m.content,
      provider: m.stats?.provider,
      model: m.stats?.model,
    }));
    fetch('/api/ai/conversations', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, messages: saveData }),
    }).then(() => {
      window.dispatchEvent(new Event('welink:conversation-saved'));
    }).catch(() => {});
  }, [messages, loading, conversationKey]);

  // 加载历史对话
  const loadConversation = useCallback(async (key: string) => {
    try {
      const resp = await fetch(`/api/ai/conversations?key=${encodeURIComponent(key)}`);
      const data = await resp.json();
      if (data.messages?.length) {
        setMessages(data.messages.map((m: { role: string; content: string }) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })));
        setConversationKey(key);
      }
    } catch {}
  }, []);

  const startNewConversation = useCallback(() => {
    setMessages([]);
    setConversationKey(null);
    setSelectedItems([]);
  }, []);

  const handleSend = (query?: string) => {
    const q = query ?? input;
    sendMessage(q);
  };

  const handleChip = (prompt: string) => {
    if (selectedItems.length === 0) {
      setInput(prompt);
      setNoSelectionHint(true);
      setTimeout(() => setNoSelectionHint(false), 2000);
      return;
    }
    sendMessage(prompt);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setMessages(prev => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === 'assistant' && last.streaming) {
        next[next.length - 1] = { ...last, streaming: false };
      }
      return next;
    });
    setLoading(false);
    setCtxLoading(false);
  };

  // 分享用：联系人展示名称 + 第一个联系人头像
  const shareContactName = selectedItems.length > 0
    ? selectedItems.map(item =>
        item.kind === 'group' ? `${itemName(item)}群` : itemName(item)
      ).join('、')
    : undefined;
  const shareAvatarUrl = selectedItems.length === 1 ? itemAvatar(selectedItems[0]) : undefined;

  // ── 输入卡片（复用于两种布局）─────────────────────────────────────────────

  const inputCard = (
    <div className="w-full max-w-xl mx-auto">
      <div className={`bg-white dark:bg-[#1c1c1e] rounded-3xl border-2 shadow-sm transition-colors ${noSelectionHint ? 'border-amber-300 dark:border-amber-500/60' : 'border-gray-100 dark:border-white/10 focus-within:border-[#07c160]/40 dark:focus-within:border-[#07c160]/50'}`}>
        {/* 分析对象选择区 */}
        <div className="px-4 pt-3.5 pb-2.5">
          <SubjectPicker
            contacts={contacts}
            groups={groups}
            selected={selectedItems}
            onAdd={handleAddItem}
            onRemove={handleRemoveItem}
            disabled={loading}
          />
        </div>
        <div className="mx-4 border-t border-dashed border-gray-100 dark:border-white/10" />
        {/* 问题输入区 */}
        <div className="px-4 pt-2.5 pb-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={hasChatHistory ? 1 : 2}
            disabled={loading}
            placeholder={
              ctxLoading ? '正在加载聊天记录…'
              : noSelectionHint ? '请先在上方选择分析对象↑'
              : hasChatHistory ? '继续提问…（Enter 发送）'
              : '想问什么？（Enter 发送，Shift+Enter 换行）'
            }
            className={`w-full resize-none bg-transparent text-sm outline-none leading-relaxed transition-colors ${
              noSelectionHint ? 'placeholder-amber-400' : 'placeholder-gray-300'
            } disabled:opacity-50`}
          />
        </div>
        {/* 底栏：模型切换 + 发送按钮 */}
        <div className="px-3 pb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 min-h-[28px]">
            {profiles.length > 1 ? (
              <select
                value={selectedProfileId}
                onChange={e => setSelectedProfileId(e.target.value)}
                className="text-[10px] text-[#576b95] bg-[#576b95]/10 px-2 py-0.5 rounded-full font-semibold border-0 outline-none cursor-pointer dark:bg-[#576b95]/20"
              >
                {profiles.map(p => (
                  <option key={p.id} value={p.id}>
                    {`${PROVIDER_LABELS[p.provider] ?? p.provider}${p.model ? ` · ${p.model}` : ''}`}
                  </option>
                ))}
              </select>
            ) : selectedProfile && (
              <span className="text-[10px] text-gray-300 font-medium">
                {PROVIDER_LABELS[selectedProfile.provider] ?? selectedProfile.provider}
                {selectedProfile.model ? ` · ${selectedProfile.model}` : ''}
              </span>
            )}
          </div>
          {loading ? (
            <button
              onClick={handleStop}
              className="flex-shrink-0 w-9 h-9 bg-red-400 hover:bg-red-500 text-white rounded-xl flex items-center justify-center transition-colors"
              title="停止"
            >
              <Square size={13} fill="white" />
            </button>
          ) : (
            <button
              onClick={() => handleSend()}
              disabled={!input.trim()}
              className="flex-shrink-0 w-9 h-9 bg-[#07c160] hover:bg-[#06ad56] disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-xl flex items-center justify-center transition-colors"
            >
              <Send size={15} />
            </button>
          )}
        </div>
      </div>
      {/* 消息条数选择 */}
      <div className="mt-3 flex items-center justify-center gap-1.5 flex-wrap">
        <span className="text-[10px] text-gray-300">消息量:</span>
        {([100, 500, 1000] as const).map(n => (
          <button key={n} onClick={() => setHomeMsgLimit(n)}
            className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all ${
              homeMsgLimit === n ? 'bg-[#07c160] text-white' : 'bg-gray-100 dark:bg-white/10 text-gray-400 hover:bg-gray-200 dark:hover:bg-white/20'
            }`}>
            最近 {n} 条
          </button>
        ))}
        <button onClick={() => setHomeMsgLimit(null)}
          className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all ${
            homeMsgLimit === null ? 'bg-[#ff9500] text-white' : 'bg-gray-100 dark:bg-white/10 text-gray-400 hover:bg-gray-200 dark:hover:bg-white/20'
          }`}>
          全部
        </button>
      </div>
      <p className="mt-1.5 text-center text-[10px] text-gray-300 font-medium">
        {homeMsgLimit === null
          ? '将使用时间范围内全部记录，消息量大时 token 消耗较高'
          : `每个联系人/群取最近 ${homeMsgLimit} 条`}
        {' · '}手机号等敏感信息自动脱敏
        {homeMsgLimit === null && (
          <span className="text-orange-400"> · 大量消息建议去联系人页面用混合检索分析</span>
        )}
      </p>
    </div>
  );

  // ── 对话模式 ───────────────────────────────────────────────────────────────

  if (hasChatHistory) {
    // 对话标题：最多显示前两个名字
    const headerNames = selectedItems.slice(0, 2).map(itemName);
    const headerTitle = headerNames.join('、') + (selectedItems.length > 2 ? ` 等${selectedItems.length}个` : '');
    const headerAvatar = selectedItems.length === 1 ? itemAvatar(selectedItems[0]) : undefined;

    return (
      <div className="flex flex-col min-h-full">
        {/* 顶部栏 */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-4 sm:px-6 py-3 bg-white/90 dark:bg-[#1c1c1e]/90 backdrop-blur border-b border-gray-100 dark:border-white/10">
          <button
            onClick={handleNewChat}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-white/8 text-sm font-semibold text-gray-500 dark:text-gray-400 hover:text-[#1d1d1f] dark:hover:text-gray-100 transition-all -ml-1"
            title="返回首页"
          >
            <ArrowLeft size={16} />
            返回
          </button>

          {/* 中间：对象信息 */}
          {selectedItems.length > 0 && (
            <div className="flex items-center gap-2 absolute left-1/2 -translate-x-1/2">
              {selectedItems.length === 1 ? (() => {
                const item = selectedItems[0];
                const canClick = item.kind === 'contact' ? !!onContactClick : !!onGroupClick;
                const handleClick = () => {
                  if (item.kind === 'contact' && onContactClick) onContactClick(item.data);
                  else if (item.kind === 'group' && onGroupClick) onGroupClick(item.data);
                };
                const avatar = headerAvatar
                  ? <img src={avatarSrc(headerAvatar)} className="w-6 h-6 rounded-full object-cover flex-shrink-0" alt={headerTitle} />
                  : item.kind === 'group'
                    ? <div className="w-6 h-6 rounded-full bg-[#576b95]/20 flex items-center justify-center flex-shrink-0"><Users size={13} className="text-[#576b95]" /></div>
                    : <div className="w-6 h-6 rounded-full bg-[#07c160] flex items-center justify-center text-white text-[10px] font-black flex-shrink-0">{headerTitle[0]}</div>;
                return (
                  <button
                    onClick={canClick ? handleClick : undefined}
                    className={`flex items-center gap-1.5 ${canClick ? 'hover:opacity-70 transition-opacity cursor-pointer' : 'cursor-default'}`}
                    title={canClick ? `查看${item.kind === 'group' ? '群聊' : '私聊'}详情` : undefined}
                  >
                    {avatar}
                    <span className={`text-sm font-semibold text-[#1d1d1f] dark:text-gray-100 truncate max-w-[120px]${privacyMode ? ' privacy-blur' : ''}`}>{headerTitle}</span>
                  </button>
                );
              })() : (
                <div className="flex items-center gap-1.5">
                  <div className="flex -space-x-2">
                    {selectedItems.slice(0, 3).map((item, i) => {
                      const av = itemAvatar(item);
                      const nm = itemName(item);
                      return av
                        ? <img key={i} src={avatarSrc(av)} className="w-6 h-6 rounded-full object-cover border-2 border-white dark:border-[#1c1c1e] flex-shrink-0" alt={nm} />
                        : item.kind === 'group'
                          ? <div key={i} className="w-6 h-6 rounded-full bg-[#576b95]/20 border-2 border-white dark:border-[#1c1c1e] flex items-center justify-center flex-shrink-0"><Users size={10} className="text-[#576b95]" /></div>
                          : <div key={i} className="w-6 h-6 rounded-full bg-[#07c160] border-2 border-white dark:border-[#1c1c1e] flex items-center justify-center text-white text-[8px] font-black flex-shrink-0">{nm[0]}</div>;
                    })}
                  </div>
                  <span className="text-sm font-semibold text-[#1d1d1f] dark:text-gray-100 truncate max-w-[140px]">{headerTitle}</span>
                </div>
              )}
            </div>
          )}

          {/* 右侧：时间范围 */}
          <span className="text-[10px] text-gray-400 font-medium">{timeRange.label}</span>
        </div>

        {/* 消息区 */}
        <div className="flex-1 px-4 sm:px-6 py-6 space-y-5 max-w-3xl w-full mx-auto">
          {messages.map((msg, i) => (
            <MessageBubble
              key={i}
              msg={msg}
              contactName={shareContactName}
              avatarUrl={shareAvatarUrl}
              llmProvider={llmProvider}
              llmModel={llmModel}
              prevQuestion={
                msg.role === 'assistant'
                  ? [...messages].slice(0, i).reverse().find(m => m.role === 'user')?.content
                  : undefined
              }
            />
          ))}
          <div ref={bottomRef} />
        </div>

        {/* 输入区 */}
        <div className="sticky bottom-0 bg-white/90 dark:bg-[#1c1c1e]/90 backdrop-blur border-t border-gray-100 dark:border-white/10 px-4 sm:px-6 py-4">
          {inputCard}
        </div>
      </div>
    );
  }

  // ── 空白（首次）模式 ────────────────────────────────────────────────────────

  return (
    <div className="min-h-full flex flex-col items-center justify-center px-4 py-16">

      {/* Hero */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 shadow-lg shadow-green-100 overflow-hidden">
          <img src="/favicon.svg" alt="WeLink" className="w-full h-full" />
        </div>
        <h1 className="text-3xl font-black text-[#1d1d1f] dark:text-gray-100 tracking-tight">WeLink</h1>
        <p className="text-gray-400 mt-1.5 text-sm font-medium">想了解哪段关系？直接问我</p>
        <div className="mt-2 flex items-center justify-center gap-2 text-xs text-gray-400">
          <span className="font-semibold text-[#07c160]">{timeRange.label}</span>
          <button
            onClick={onReselect}
            className="flex items-center gap-1 underline hover:text-gray-600 transition-colors"
          >
            <RotateCcw size={10} />
            重新选择
          </button>
        </div>
      </div>

      {/* 模式切换 */}
      <div className="flex items-center gap-2 mb-6">
        <button
          onClick={() => setMode('contact')}
          className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
            mode === 'contact' ? 'bg-[#07c160] text-white' : 'bg-gray-100 dark:bg-white/10 text-gray-500 hover:bg-gray-200'
          }`}
        >
          联系人/群聊分析
        </button>
        <button
          onClick={() => setMode('cross')}
          className={`flex items-center gap-1 px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
            mode === 'cross' ? 'bg-[#576b95] text-white' : 'bg-gray-100 dark:bg-white/10 text-gray-500 hover:bg-gray-200'
          }`}
        >
          <Globe size={12} />
          跨联系人问答
        </button>
      </div>

      {mode === 'cross' ? (
        <div className="w-full max-w-xl mx-auto" style={{ minHeight: 400 }}>
          <CrossContactQA
            onOpenSettings={onReselect}
            onContactClick={uname => {
              const c = contacts.find(cc => cc.username === uname);
              if (c) onContactClick?.(c);
            }}
            onGroupClick={uname => {
              const g = groups.find(gg => gg.username === uname);
              if (g) onGroupClick?.(g);
            }}
          />
        </div>
      ) : (
      <>
      {/* 历史记录 */}
      <ConversationHistory
        prefix="ai-home:"
        currentKey={conversationKey}
        onSelect={loadConversation}
        onNew={startNewConversation}
        className="w-full max-w-xl mx-auto mb-4"
      />

      {/* 输入卡片 */}
      {inputCard}

      {/* 快捷 Prompt 胶囊 */}
      <div className="flex flex-wrap gap-2 mt-6 justify-center max-w-xl">
        {PRESETS.map(p => (
          <button
            key={p.label}
            onClick={() => handleChip(p.prompt)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold border border-gray-200 dark:border-white/10 text-gray-500 dark:text-gray-400 hover:border-[#07c160] hover:text-[#07c160] hover:bg-[#f0faf4] dark:hover:bg-[#07c160]/10 transition-colors"
          >
            <Bot size={11} />
            {p.label}
          </button>
        ))}
      </div>

      {/* 最近聊天（联系人 + 群聊混合） */}
      {recentItems.length > 0 && (
        <div className="w-full max-w-xl mt-8">
          <p className="text-[10px] font-black text-gray-300 uppercase tracking-widest mb-3 text-center">最近聊天</p>
          <div className="flex gap-3 overflow-x-auto pb-1 justify-center flex-wrap">
            {recentItems.map(item => {
              const name = itemName(item);
              const avatar = itemAvatar(item);
              const id = itemId(item);
              const isSelected = selectedItems.some(s => itemId(s) === id);
              return (
                <button
                  key={id}
                  onClick={() => {
                    if (isSelected) {
                      handleRemoveItem(id);
                    } else {
                      handleAddItem(item);
                      textareaRef.current?.focus();
                    }
                  }}
                  className={`flex-shrink-0 flex flex-col items-center gap-1.5 p-2 rounded-2xl border-2 transition-all ${
                    isSelected
                      ? 'border-[#07c160] bg-[#f0faf4] dark:bg-[#07c160]/10'
                      : 'border-transparent hover:border-gray-200 dark:hover:border-white/10 hover:bg-gray-50 dark:hover:bg-white/5'
                  }`}
                >
                  <div className="relative">
                    {avatar
                      ? <img src={avatarSrc(avatar)} className="w-10 h-10 rounded-full object-cover" alt={name} />
                      : item.kind === 'group'
                        ? <div className="w-10 h-10 rounded-full bg-[#576b95]/15 flex items-center justify-center"><Users size={18} className="text-[#576b95]" /></div>
                        : <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#07c160] to-[#06ad56] flex items-center justify-center text-white text-sm font-black">{name[0]}</div>
                    }
                    {isSelected && (
                      <div className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-[#07c160] flex items-center justify-center">
                        <Check size={10} className="text-white" />
                      </div>
                    )}
                  </div>
                  <span className={`text-[10px] font-semibold text-gray-500 dark:text-gray-400 max-w-[52px] truncate${privacyMode ? ' privacy-blur' : ''}`}>{name}</span>
                </button>
              );
            })}
          </div>
          {selectedItems.length > 0 && (
            <p className="text-center text-[10px] text-[#07c160] font-semibold mt-2">
              已选 {selectedItems.length} 个对话 · 点击已选项可取消
            </p>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
};
