import { Select } from '../common/Select';
import { ModelAvatar } from '../common/ModelAvatar';
import { Dialog } from '../common/Dialog';
import { RelativeTime } from '../common/RelativeTime';
/**
 * AI 首页 — 以「直接问我」为核心的纯净首页，对话直接在页面内生成
 */

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { MessageSquare, Send, X, Search, RotateCcw, Loader2, Copy, Check, Square, ArrowLeft, ArrowUpRight, Share2, Users, Plus, ChevronDown, ChevronRight, ListTree, Globe, Settings, RefreshCw } from 'lucide-react';
import { CrossContactQA } from './CrossContactQA';
import { ReplyAssistant } from './ReplyAssistant';
import { saveConversation } from '../../services/conversationStore';
import { ConversationHistory } from './ConversationHistory';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { SharePreview } from '../common/SharePreview';
import { Avatar } from '../common/Avatar';
import { avatarSrc } from '../../utils/avatar';
import type { ContactStats, TimeRange, ChatMessage, GroupInfo, GroupChatMessage, BackendStatus } from '../../types';
import { contactsApi, groupsApi } from '../../services/api';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';
import { isAIConfigError } from '../../utils/aiError';
import { AIConfigNotice } from '../common/AIConfigNotice';
import { SearchContextModal, type SearchContextTarget } from '../search/SearchContextModal';
import { ModelComparison } from './ModelComparison';

const PROVIDER_LABELS: Record<string, string> = {
  deepseek: 'DeepSeek', kimi: 'Kimi', gemini: 'Gemini', glm: 'GLM',
  grok: 'Grok', openai: 'OpenAI', claude: 'Claude', ollama: 'Ollama', custom: '自定义', antigravity: 'Antigravity 网关',
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

function buildAnalysisPrompt(context: string, labels: string): string {
  return context
    ? `你是一个聊天记录分析助手。以下是${labels}的聊天记录（已脱敏处理）：\n\n${context}\n\n请根据以上聊天记录回答用户的问题，分析时请客观、有洞察力，用中文回答。涉及具体聊天内容的结论请使用对应消息编号引用，例如 [1]；只能引用上面实际存在的编号，不要编造。`
    : `你是一个聊天记录分析助手，请帮助分析${labels}的聊天记录，用中文回答。`;
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

  const showDropdown = open;

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center gap-2 flex-wrap min-h-[28px]">
        {/* 标签 */}
        <span className="home-composer-label shrink-0 select-none">分析对象</span>

        {/* 已选 chips */}
        {selected.map(item => {
          const name = itemName(item);
          const avatar = itemAvatar(item);
          const id = itemId(item);
          return (
            <div key={id} className="flex items-center gap-1 pl-1 pr-1 py-0.5 bg-[#f0faf4] dark:bg-[#07c160]/15 border border-[#07c160]/25 rounded-full">
              {avatar
                ? <Avatar src={avatar} name={name} className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
                : item.kind === 'group'
                  ? <div className="w-5 h-5 rounded-full bg-[#576b95]/15 flex items-center justify-center flex-shrink-0"><Users size={10} className="text-[#576b95]" /></div>
                  : <div className="w-5 h-5 rounded-full bg-[#07c160] flex items-center justify-center text-white text-[9px] font-black flex-shrink-0">{name[0]}</div>
              }
              <span className={`text-xs font-semibold text-[#07c160] max-w-[72px] truncate${privacyMode ? ' privacy-blur' : ''}`}>{name}</span>
              {!disabled && (
                <button aria-label={`移除${name}`} onClick={() => onRemove(id)} className="text-[#07c160]/40 hover:text-[#07c160] transition-colors p-0.5 ml-0.5">
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
                aria-label="搜索联系人或群聊"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); setQuery(''); } }}
              />
              <button type="button" aria-label="关闭联系人搜索" onClick={() => { setOpen(false); setQuery(''); }} className="text-gray-300 hover:text-gray-500 dark:hover:text-gray-300 transition-colors">
                <X size={10} />
              </button>
            </div>
          ) : (
            <button
              onClick={openSearch}
              aria-expanded={open}
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
                    onClick={() => { onAdd({ kind: 'contact', data: c }); setQuery(''); setOpen(false); }}
                  >
                    {avatar
                      ? <Avatar src={avatar} name={name} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
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
                    onClick={() => { onAdd({ kind: 'group', data: g }); setQuery(''); setOpen(false); }}
                  >
                    {avatar
                      ? <Avatar src={avatar} name={name} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
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

type HomeSource = { id: string; username: string; display_name: string; is_group: boolean; avatar_url?: string; date: string; time: string; content: string; is_mine: boolean; speaker?: string };
type ProfileItem = { id: string; name: string; provider: string; model?: string; base_url?: string };
type ChatMsg = {
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  streaming?: boolean;
  sources?: HomeSource[];
  stats?: { elapsed: number; tokensPerSec: number; chars: number; provider?: string; model?: string; timestamp?: number };
};

const MessageBubble: React.FC<{
  msg: ChatMsg;
  contactName?: string;
  avatarUrl?: string;
  prevQuestion?: string;
  llmProvider?: string;
  llmModel?: string;
  onOpenSettings?: () => void;
}> = ({ msg, contactName, avatarUrl, prevQuestion, llmProvider, llmModel, onOpenSettings }) => {
  const [copied, setCopied] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [sourceTarget, setSourceTarget] = useState<SearchContextTarget | null>(null);
  const [showPerfMetrics, setShowPerfMetrics] = useState<boolean>(() => {
    try { return localStorage.getItem('welink_home_perf_metrics') === '1'; } catch { return false; }
  });
  const togglePerfMetrics = () => {
    setShowPerfMetrics(v => {
      const next = !v;
      try { localStorage.setItem('welink_home_perf_metrics', next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };

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


  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2 flex-row group">
        <ModelAvatar provider={msg.stats?.provider || (msg.streaming ? llmProvider : undefined)} model={msg.stats?.model || (msg.streaming ? llmModel : undefined)} />
        <div className="flex flex-col gap-1 max-w-[80%]">
          <div className="px-4 py-2.5 rounded-2xl rounded-bl-sm text-sm leading-relaxed bg-[#f0f0f0] dark:bg-white/10 text-[#1d1d1f] dark:text-gray-100 prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-hr:my-2">
            {msg.thinking && (
              <div className="not-prose mb-2">
                <button
                  onClick={() => setThinkingOpen(v => !v)}
                  className="flex items-center gap-1.5 text-[11px] text-[#576b95] hover:text-[#576b95]/80 transition-colors"
                >
                  <ListTree size={12} />
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
            {!msg.streaming && msg.content && isAIConfigError(msg.content) && onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="not-prose mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#07c160] text-white text-xs font-bold hover:bg-[#06ad56] transition-colors shadow-sm"
              >
                <Settings size={12} /> 去设置
              </button>
            )}
            {msg.stats && !msg.streaming && (
              <div className="flex flex-col items-end gap-0.5 mt-2 text-[10px] text-gray-400 not-prose">
                {showPerfMetrics && msg.stats.provider && (
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
                  return (
                    <div className="flex items-center gap-1.5">
                      <span>{d.getFullYear()}年{d.getMonth()+1}月{d.getDate()}日{d.getHours()}点{String(d.getMinutes()).padStart(2,'0')}分</span>
                      {msg.stats.provider && (
                        <button
                          onClick={togglePerfMetrics}
                          title={showPerfMetrics ? '隐藏性能详情' : '显示性能详情'}
                          className="text-gray-300 hover:text-[#07c160] transition-colors"
                        >
                          {showPerfMetrics ? '▴ 详情' : 'ℹ 详情'}
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
          {!!msg.sources?.length && !msg.streaming && <details className="rounded-lg border dk-border p-2 text-xs"><summary className="cursor-pointer font-semibold">查看引用的聊天记录（{msg.sources.length}）</summary><p className="mt-1 text-gray-500">引用是模型给出的线索，请打开上下文核对；原文保存在本机对话历史中。</p>{msg.sources.map(source => <button key={source.id} type="button" className="mt-2 block w-full text-left rounded bg-gray-50 dark:bg-white/5 p-2 break-all" onClick={() => setSourceTarget({ username: source.username, displayName: source.display_name, date: source.date, targetTime: source.time, targetContent: source.content, isGroup: source.is_group, avatarUrl: source.avatar_url })}>[{source.id}] {source.date} {source.time} · {source.content}</button>)}</details>}
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
                onClick={() => setShareOpen(true)}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold text-gray-400 hover:text-[#576b95] hover:bg-[#f0f4ff] dark:hover:bg-[#576b95]/15 transition-colors disabled:opacity-50"
                title="保存为图片分享"
              >
                <Share2 size={11} />
                分享
              </button>
            </div>
          )}
        </div>
      </div>
      {shareOpen && <SharePreview options={{ question: prevQuestion, answer: msg.content, contactName, avatarUrl, stats: msg.stats ? { provider: msg.stats.provider, model: msg.stats.model, elapsedSecs: msg.stats.elapsed, tokensPerSec: msg.stats.tokensPerSec, charCount: msg.stats.chars, timestamp: msg.stats.timestamp } : undefined }} onClose={() => setShareOpen(false)} />}
      {sourceTarget && <SearchContextModal {...sourceTarget} onClose={() => setSourceTarget(null)} />}
    </div>
  );
};

// ─── 主组件 ───────────────────────────────────────────────────────────────────

export interface AIHomePageProps {
  contacts: ContactStats[];
  timeRange: TimeRange;
  indexStatus?: BackendStatus | null;
  demoMockActive?: boolean;
  onReselect: () => void;
  onContactClick?: (contact: ContactStats) => void;
  onGroupClick?: (group: GroupInfo) => void;
  onNavigateToAnniversary?: () => void;
  onOpenSettings?: () => void;
}

export const AIHomePage: React.FC<AIHomePageProps> = ({
  contacts,
  timeRange,
  indexStatus,
  demoMockActive = false,
  onReselect,
  onContactClick,
  onGroupClick,
  onNavigateToAnniversary: _onNavigateToAnniversary, // 老调用方仍在传；目前简报 banner 里不用
  onOpenSettings,
}) => {
  const { privacyMode } = usePrivacyMode();
  const [mode, setMode] = useState<'contact' | 'cross' | 'reply'>('contact');
  const [recentPage, setRecentPage] = useState(0);
  const [selectedItems, setSelectedItems] = useState<SelectableItem[]>([]);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [input, setInput] = useState('');
  const [noSelectionHint, setNoSelectionHint] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loading, setLoading] = useState(false);
  const [homeMsgLimit, setHomeMsgLimit] = useState<number | null>(200); // null = 全部
  const [ctxLoading, setCtxLoading] = useState(false);
  const [contextError, setContextError] = useState('');
  const [pendingRequest, setPendingRequest] = useState<{ question: string; context: string; labels: string; counts: { name: string; count: number; capped: boolean }[]; history: ChatMsg[]; sources: HomeSource[]; profileId: string; provider: string; model: string; baseURL: string; range: string } | null>(null);
  const [compareProfileId, setCompareProfileId] = useState('');
  const [comparison, setComparison] = useState<{ profiles: [ProfileItem, ProfileItem]; messages: { role: string; content: string }[]; sources: HomeSource[] } | null>(null);
  const prepareGeneration = useRef(0);
  // 快捷 prompt 展开状态：默认 collapsed（只显示前 3 个 + 「更多」），用户可展开全部
  const [presetsExpanded, setPresetsExpanded] = useState<boolean>(() => {
    try { return localStorage.getItem('welink_home_presets_expanded') === '1'; } catch { return false; }
  });
  const togglePresets = () => {
    setPresetsExpanded(v => {
      const next = !v;
      try { localStorage.setItem('welink_home_presets_expanded', next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };

  // 新用户引导：从未选过任何分析对象 ⇒ 给 SubjectPicker 加 pulse 动画和提示条
  const [onboarded, setOnboarded] = useState<boolean>(() => {
    try { return localStorage.getItem('welink_home_onboarded_v1') === '1'; } catch { return true; }
  });
  const markOnboarded = () => {
    setOnboarded(true);
    try { localStorage.setItem('welink_home_onboarded_v1', '1'); } catch { /* ignore */ }
  };

  // 高级选项（消息量预设）默认收起，localStorage 记忆用户偏好
  const [showAdvanced, setShowAdvanced] = useState<boolean>(() => {
    try { return localStorage.getItem('welink_home_advanced_open') === '1'; } catch { return false; }
  });
  const toggleAdvanced = () => {
    setShowAdvanced(v => {
      const next = !v;
      try { localStorage.setItem('welink_home_advanced_open', next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };

  // 性能指标详情展开状态在 MessageBubble 内部管理（localStorage 全局共享）
  const [conversationKey, setConversationKey] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasChatHistory = messages.length > 0;

  // 加载群聊列表
  useEffect(() => {
    groupsApi.getList().then(setGroups).catch(() => {});
  }, []);

  // Provider profiles（支持多配置切换）
  const [profiles, setProfiles] = useState<ProfileItem[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  useEffect(() => {
    fetch('/api/preferences')
      .then(r => r.json())
      .then((d: { llm_profiles?: ProfileItem[]; llm_provider?: string; llm_model?: string; llm_base_url?: string }) => {
        if (d.llm_profiles && d.llm_profiles.length > 0) {
          setProfiles(d.llm_profiles);
          setSelectedProfileId(d.llm_profiles[0].id);
        } else if (d.llm_provider) {
          const p = { id: '__default__', name: d.llm_provider, provider: d.llm_provider, model: d.llm_model ?? '', base_url: d.llm_base_url ?? '' };
          setProfiles([p]);
          setSelectedProfileId('__default__');
        }
      })
      .catch(() => {});
  }, []);
  const selectedProfile = profiles.find(p => p.id === selectedProfileId) ?? profiles[0];
  const llmProvider = selectedProfile?.provider ?? '';
  const llmModel = selectedProfile?.model ?? '';
  const llmBaseURL = selectedProfile?.base_url ?? '';

  // 联系人与群聊按最近消息排序，按批次浏览而不丢失选择。
  const allRecentItems = useMemo(() => {
    const contactItems: SelectableItem[] = contacts
      .filter(c => c.total_messages > 0)
      .map(c => ({ kind: 'contact' as const, data: c }));
    const groupItems: SelectableItem[] = groups
      .map(g => ({ kind: 'group' as const, data: g }));
    const all = [...contactItems, ...groupItems];
    return all.sort((a, b) => {
      const aT = new Date(a.data.last_message_time).getTime() || 0;
      const bT = new Date(b.data.last_message_time).getTime() || 0;
      return bT - aT;
    });
  }, [contacts, groups]);
  const recentPageCount = Math.ceil(allRecentItems.length / 14);
  const currentRecentPage = recentPageCount ? recentPage % recentPageCount : 0;
  const recentItems = allRecentItems.slice(currentRecentPage * 14, (currentRecentPage + 1) * 14);

  // 智能第一个问题：基于 Top 3 联系人和群聊生成个性化建议
  const smartSuggestions = useMemo(() => {
    const topContacts = [...contacts]
      .filter(c => c.total_messages > 20)
      .sort((a, b) => b.total_messages - a.total_messages)
      .slice(0, 3);
    const topGroup = [...groups]
      .sort((a, b) => b.total_messages - a.total_messages)[0];

    type Sug = { label: string; prompt: string; target: SelectableItem };
    const out: Sug[] = [];

    if (topContacts[0]) {
      const c = topContacts[0];
      const name = c.remark || c.nickname || c.username;
      out.push({
        label: `分析我和${name}的关系`,
        prompt: `请分析我和${name}的聊天记录：互动频率、话题偏好、情感倾向、关系发展阶段。`,
        target: { kind: 'contact', data: c },
      });
    }
    if (topContacts[1]) {
      const c = topContacts[1];
      const name = c.remark || c.nickname || c.username;
      out.push({
        label: `${name} 的聊天风格`,
        prompt: `${name}有什么说话特点？用词习惯、句子长短、表情使用和常提到的话题。`,
        target: { kind: 'contact', data: c },
      });
    }
    if (topGroup) {
      out.push({
        label: `${topGroup.name} 最近在聊什么`,
        prompt: `${topGroup.name}这个群最近一个月聊的最多的话题有哪些？主要发言的人是谁？`,
        target: { kind: 'group', data: topGroup },
      });
    }
    if (topContacts[2]) {
      const c = topContacts[2];
      const name = c.remark || c.nickname || c.username;
      out.push({
        label: `和${name}的趣味瞬间`,
        prompt: `用轻松有趣的方式总结我和${name}的聊天，挑 3-5 个印象深刻的对话片段或梗。`,
        target: { kind: 'contact', data: c },
      });
    }
    return out;
  }, [contacts, groups]);

  // 智能建议一键用：自动选目标 + 填 prompt（不自动发，让用户确认）
  const applySmartSuggestion = (sug: { prompt: string; target: SelectableItem }) => {
    setSelectedItems([sug.target]);
    setInput(sug.prompt);
    markOnboarded();
    setTimeout(() => textareaRef.current?.focus(), 30);
  };

  const scrollToBottom = useCallback(() => {
    if (scrollTimerRef.current) return;
    scrollTimerRef.current = setTimeout(() => {
      scrollTimerRef.current = null;
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  }, []);

  useEffect(() => () => {
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
  }, []);

  useEffect(() => {
    if (hasChatHistory) scrollToBottom();
  }, [messages.length, hasChatHistory, scrollToBottom]);

  const handleNewChat = () => {
    prepareGeneration.current++;
    setPendingRequest(null);
    setContextError('');
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setConversationKey(null);
    setLoading(false);
    setCtxLoading(false);
    setInput('');
  };

  const handleAddItem = (item: SelectableItem) => {
    const id = itemId(item);
    setSelectedItems(prev => prev.some(s => itemId(s) === id) ? prev : [...prev, item]);
    markOnboarded(); // 选过对象就不再是新用户
    requestAnimationFrame(() => textareaRef.current?.focus());
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
    setContextError('');
    setInput(q);
    const generation = ++prepareGeneration.current;

    // 加载所有选中对象的消息
    const totalLimit = homeMsgLimit;
    const perItem = totalLimit != null ? Math.max(50, Math.floor(totalLimit / selectedItems.length)) : undefined;
    const sections: string[] = [];
    const counts: { name: string; count: number; capped: boolean }[] = [];
    const sources: HomeSource[] = [];

    try {
      for (const item of selectedItems) {
        if (generation !== prepareGeneration.current) return;
        const name = itemName(item);
        if (item.kind === 'contact') {
          const msgs: ChatMessage[] = await contactsApi.exportMessages(item.data.username, timeRange.from ?? undefined, timeRange.to ?? undefined, perItem) ?? [];
          const recent = perItem && msgs.length > perItem ? msgs.slice(-perItem) : msgs;
          const lines = recent.map(m => { const id = String(sources.length + 1); sources.push({ id, username: item.data.username, display_name: name, is_group: false, avatar_url: itemAvatar(item), date: m.date || '', time: m.time, content: m.content, is_mine: m.is_mine }); return `[${id}] [${m.date ?? ''} ${m.time}] ${m.is_mine ? '我' : name}：${m.content}`; });
          counts.push({ name, count: recent.length, capped: msgs.length >= 50000 });
          sections.push(`=== 与「${name}」的聊天记录 ===\n${lines.map(l => maskPrivacy(l, name)).join('\n')}`);
        } else {
          const msgs: GroupChatMessage[] = await groupsApi.exportMessages(item.data.username, timeRange.from ?? undefined, timeRange.to ?? undefined, perItem) ?? [];
          const recent = perItem && msgs.length > perItem ? msgs.slice(-perItem) : msgs;
          const lines = recent.map(m => { const id = String(sources.length + 1); sources.push({ id, username: item.data.username, display_name: name, is_group: true, avatar_url: itemAvatar(item), date: m.date || '', time: m.time, content: m.content, is_mine: m.is_mine, speaker: m.speaker }); return `[${id}] [${m.date ?? ''} ${m.time}] ${m.speaker || '成员'}：${m.content}`; });
          counts.push({ name, count: recent.length, capped: msgs.length >= 50000 });
          sections.push(`=== 「${name}」群聊记录 ===\n${lines.map(l => maskPrivacy(l)).join('\n')}`);
        }
      }
    } catch {
      if (generation === prepareGeneration.current) {
        setContextError('读取聊天记录失败，请检查数据目录后重试。本次没有发送请求。');
        setCtxLoading(false);
        setLoading(false);
      }
      return;
    }
    if (generation !== prepareGeneration.current) return;
    setCtxLoading(false);

    const ctxText = sections.join('\n\n');
    const contactLabels = selectedItems.map(item =>
      item.kind === 'contact' ? `「${itemName(item)}」` : `「${itemName(item)}」群`
    ).join('、');

    setCompareProfileId('');
    setPendingRequest({ question: q.trim(), context: ctxText, labels: contactLabels, counts, history: messages, sources, profileId: selectedProfileId, provider: llmProvider, model: llmModel, baseURL: llmBaseURL, range: timeRange.label });
    setLoading(false);
  }, [loading, selectedItems, messages, selectedProfileId, llmProvider, llmModel, llmBaseURL, homeMsgLimit, timeRange.from, timeRange.to, timeRange.label]);

  const confirmSend = async () => {
    if (!pendingRequest || loading) return;
    const { question, context: ctxText, labels: contactLabels, history, sources, profileId, provider, model, baseURL } = pendingRequest;
    setPendingRequest(null);
    setLoading(true);
    setInput('');
    const userMsg: ChatMsg = { role: 'user', content: question };
    const newMessages = [...history, userMsg];
    const assistantIdx = newMessages.length;
    setMessages([...newMessages, { role: 'assistant', content: '', streaming: true }]);
    scrollToBottom();

    const sysPrompt = buildAnalysisPrompt(ctxText, contactLabels);

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
          profile_id: profileId !== '__default__' ? profileId : '',
          expected_profile: { provider, model, base_url: baseURL },
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
      let completed = false;

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
            if (chunk.done) { completed = true; break; }
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
      if (!completed) throw new Error('响应中断，结果可能不完整，请重试。');
    } catch (e: unknown) {
      if ((e as { name?: string }).name === 'AbortError' || abortRef.current !== abort) return;
      setMessages(prev => {
        const next = [...prev];
        const msg = next[assistantIdx];
        if (msg) next[assistantIdx] = { ...msg, content: `${msg.content ? `${msg.content}\n\n` : ''}❌ ${e instanceof Error ? e.message : '请求失败'}`, streaming: false };
        return next;
      });
    } finally {
      if (abortRef.current !== abort) return;
      const elapsed = (Date.now() - streamStart) / 1000;
      setMessages(prev => {
        const next = [...prev];
        const msg = next[assistantIdx];
        if (msg?.streaming) {
          const chars = msg.content.length;
          const tokensPerSec = elapsed > 0.1 ? Math.round(chars / elapsed / 1.5) : 0;
          const ids = new Set(Array.from(msg.content.matchAll(/\[(\d+)\]/g), match => match[1]));
          next[assistantIdx] = { ...msg, streaming: false, sources: sources.filter(source => ids.has(source.id)), stats: { elapsed, tokensPerSec, chars, provider, model, timestamp: Date.now() } };
        }
        return next;
      });
      setLoading(false);
      abortRef.current = null;
    }
  };

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
      ...(m.sources?.length ? { sources: m.sources } : {}),
    }));
    saveConversation(key, saveData).then(() => {
      window.dispatchEvent(new Event('welink:conversation-saved'));
    }).catch(() => {});
  }, [messages, loading, conversationKey]);

  // 加载历史对话
  const loadConversation = useCallback(async (key: string) => {
    try {
      const resp = await fetch(`/api/ai/conversations?key=${encodeURIComponent(key)}`);
      const data = await resp.json();
      if (data.messages?.length) {
        setMessages(data.messages.map((m: { role: string; content: string; sources?: HomeSource[] }) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
          sources: m.sources,
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
    // Enter 发送；Shift+Enter 换行；Ctrl/Cmd+Enter 也发送（适合粘了多行后一键提交）
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleStop = () => {
    prepareGeneration.current++;
    abortRef.current?.abort();
    abortRef.current = null;
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
    <div className="w-full max-w-2xl mx-auto">
      <Dialog open={!!pendingRequest} title="确认发送内容" onClose={() => setPendingRequest(null)}>
        {pendingRequest && <div className="space-y-4">
          <p className="text-xs text-[var(--text-secondary)]">{demoMockActive ? '目标：演示回复，使用模拟数据，不调用外部模型。' : <>目标：{PROVIDER_LABELS[pendingRequest.provider] ?? (pendingRequest.provider || '未配置模型')}{pendingRequest.model ? ` · ${pendingRequest.model}` : ''}。内容将发送到所选模型服务；第三方网关还会接收这些内容。</>}</p>
          <p className="text-xs text-[var(--text-secondary)]">数据范围：{pendingRequest.range} · 聊天记录 {pendingRequest.counts.reduce((n, item) => n + item.count, 0)} 条 · 历史对话 {pendingRequest.history.length} 条</p>
          <p className={`text-xs text-[var(--text-secondary)] break-words${privacyMode ? ' privacy-blur' : ''}`}>{pendingRequest.counts.map(item => `${item.name}：${item.count} 条`).join('；')}</p>
          {pendingRequest.counts.some(item => item.capped) && <p className="text-xs text-amber-600">部分会话达到读取上限，最多读取最近 50,000 条，较早记录可能未包含。</p>}
          {pendingRequest.counts.every(item => item.count === 0) && <p className="text-xs text-amber-600">所选范围没有读取到聊天记录，请确认数据范围。</p>}
          <p className="text-xs text-[var(--text-secondary)]">已尝试遮盖聊天正文中的手机号、身份证、邮箱、卡号及部分私聊联系人名称；提示词标题、问题和历史对话可能仍含姓名或敏感信息，请检查后发送。</p>
          {profiles.length > 1 && <label className="block text-xs font-semibold">多模型对比（可选）<select aria-label="选择对比模型" className="dk-input mt-2 w-full" value={compareProfileId} onChange={e => setCompareProfileId(e.target.value)}><option value="">只发送给当前模型</option>{profiles.filter(p => p.id !== pendingRequest.profileId).map(p => <option value={p.id} key={p.id}>{p.name || p.provider}{p.model ? ` · ${p.model}` : ''}</option>)}</select>{compareProfileId && <span className="mt-1 block font-normal text-amber-600">相同内容会分别发送给两个模型服务，可能产生两次费用；对比结果不会保存。</span>}</label>}
          <details><summary className="cursor-pointer text-xs font-semibold text-[var(--accent-text)]">查看将发送的完整提示词、问题和历史对话</summary>
            <pre className={`mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--bg-subtle)] p-3 text-xs text-[var(--text-primary)]${privacyMode ? ' privacy-blur' : ''}`}>{buildAnalysisPrompt(pendingRequest.context, pendingRequest.labels)}{'\n\n'}{pendingRequest.history.map(m => `${m.role === 'user' ? '我' : 'AI'}：${m.content}`).join('\n')}{'\n'}我：{pendingRequest.question}</pre>
          </details>
          <div className="flex justify-end gap-2"><button type="button" className="ui-button ui-button-secondary" onClick={() => setPendingRequest(null)}>返回修改</button><button type="button" className="ui-button ui-button-primary" onClick={() => { const first = profiles.find(p => p.id === pendingRequest.profileId); const second = profiles.find(p => p.id === compareProfileId); if (compareProfileId && first && second && first.id !== second.id) { setComparison({ profiles: [first, second], sources: pendingRequest.sources, messages: [{ role: 'system', content: buildAnalysisPrompt(pendingRequest.context, pendingRequest.labels) }, ...pendingRequest.history.map(m => ({ role: m.role, content: m.content })), { role: 'user', content: pendingRequest.question }] }); setPendingRequest(null); setCompareProfileId(''); } else { void confirmSend(); } }}>{compareProfileId ? '确认发送给两个模型' : '确认发送'}</button></div>
        </div>}
      </Dialog>
      {comparison && <ModelComparison profiles={comparison.profiles} messages={comparison.messages} sources={comparison.sources} onClose={() => setComparison(null)} />}
      {contextError && <p role="alert" className="mb-2 text-xs text-red-600 dark:text-red-400">{contextError}</p>}
      <div className={`home-composer ${noSelectionHint ? 'needs-subject' : ''}`}>
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
        <div className="mx-4 border-t dk-border" />
        {/* 问题输入区 */}
        <div className="px-4 pt-2.5 pb-2">
          <textarea
            ref={textareaRef}
            aria-label="输入分析问题"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={hasChatHistory ? 1 : 2}
            disabled={loading}
            placeholder={
              ctxLoading ? '正在加载聊天记录…'
              : noSelectionHint ? '请先在上方选择分析对象 ↑'
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
              <Select
                value={selectedProfileId}
                onValueChange={nextValue => setSelectedProfileId(nextValue)}
                className="text-[10px] text-[#576b95] bg-[#576b95]/10 px-2 py-0.5 rounded-full font-semibold border-0 outline-none cursor-pointer dark:bg-[#576b95]/20"
              >
                {profiles.map(p => (
                  <option key={p.id} value={p.id}>
                    {`${PROVIDER_LABELS[p.provider] ?? p.provider}${p.model ? ` · ${p.model}` : ''}`}
                  </option>
                ))}
              </Select>
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
              aria-label="停止生成"
              className="flex-shrink-0 w-9 h-9 bg-red-400 hover:bg-red-500 text-white rounded-xl flex items-center justify-center transition-colors"
              title="停止"
            >
              <Square size={13} fill="white" />
            </button>
          ) : (
            <button
              onClick={() => handleSend()}
              aria-label="发送问题"
              disabled={!input.trim()}
              className="flex-shrink-0 w-9 h-9 bg-[#07c160] hover:bg-[#06ad56] disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-xl flex items-center justify-center transition-colors"
            >
              <Send size={15} />
            </button>
          )}
        </div>
      </div>
      {/* 高级选项（消息量 + 说明）—— 默认收起，避免新用户被预设按钮吓到 */}
      <div className="mt-2 text-center">
        <button
          onClick={toggleAdvanced}
          className="text-[10px] text-gray-300 hover:text-[#07c160] transition-colors font-medium"
        >
          消息量：{homeMsgLimit === null ? '全部' : `最近 ${homeMsgLimit} 条`} · 高级 {showAdvanced ? '▴' : '▾'}
        </button>
        {showAdvanced && (
          <div className="mt-2 mx-auto max-w-2xl">
            <div className="flex items-center justify-center gap-1.5 flex-wrap">
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
            <p className="mt-1.5 text-[10px] text-gray-300 font-medium">
              {homeMsgLimit === null
                ? '每个会话最多读取范围内最近 50,000 条，消息量大时 token 消耗较高'
                : `选中对象共享约 ${homeMsgLimit} 条的预算，每个对象至少取 50 条`}
              {' · '}手机号等敏感信息自动脱敏
              {homeMsgLimit === null && (
                <span className="text-orange-400"> · 大量消息建议去联系人页面用混合检索分析</span>
              )}
            </p>
          </div>
        )}
      </div>
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
                  ? <img loading="lazy" src={avatarSrc(headerAvatar)} className="w-6 h-6 rounded-full object-cover flex-shrink-0" alt={headerTitle} />
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
                        ? <img loading="lazy" key={i} src={avatarSrc(av)} className="w-6 h-6 rounded-full object-cover border-2 border-white dark:border-[#1c1c1e] flex-shrink-0" alt={nm} />
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
              onOpenSettings={onOpenSettings}
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
          <AIConfigNotice
            visible={profiles.length === 0 && !demoMockActive}
            onOpenSettings={onOpenSettings}
            className="max-w-3xl mx-auto mb-3"
          />
          {inputCard}
        </div>
      </div>
    );
  }

  // ── 空白（首次）模式 ────────────────────────────────────────────────────────

  return (
    <div className="home-landing min-h-full flex flex-col items-center px-5">


      {/* Hero */}
      <div className="home-hero text-center max-w-2xl">
        <div className="home-eyebrow">你的聊天记忆助手</div>
        <h1>从聊天记录里，读懂关系。</h1>
        <p className="mt-3 text-sm leading-relaxed">选一位联系人或一个群聊，让记录告诉你更多。</p>
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
        {indexStatus && <p className="mt-2 text-xs text-[var(--text-secondary)]" role="status">
          {indexStatus.last_error ? '索引出现问题，请重新选择时间范围并重试' : indexStatus.is_indexing ? '正在更新索引' : indexStatus.is_initialized ? `索引已就绪 · ${indexStatus.total_cached} 位联系人` : '索引尚未完成'}
          {!indexStatus.last_error && !!indexStatus.last_indexed_at && <> · 本次服务运行期间索引完成于 <RelativeTime ts={indexStatus.last_indexed_at} /></>}
        </p>}
      </div>

      {/* 模式切换 */}
      <div className="ui-segmented mb-6" role="group" aria-label="问答模式">
        <button
          type="button"
          onClick={() => setMode('contact')}
          aria-pressed={mode === 'contact'}
        >
          联系人/群聊分析
        </button>
        <button
          type="button"
          onClick={() => setMode('cross')}
          aria-pressed={mode === 'cross'}
          className="flex items-center gap-1.5"
        >
          <Globe size={12} />
          跨联系人问答
        </button>
        <button type="button" onClick={() => setMode('reply')} aria-pressed={mode === 'reply'}>我的口吻回复</button>
      </div>

      {mode === 'reply' ? <ReplyAssistant contacts={contacts} onOpenSettings={onOpenSettings} /> : mode === 'cross' ? (
        <div className="w-full max-w-2xl mx-auto" style={{ minHeight: 400 }}>
          <CrossContactQA
            onOpenSettings={onOpenSettings}
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
        busy={loading}
        className="w-full max-w-2xl mx-auto mb-4"
      />

      {/* 新用户引导条：仅在首次访问 + 无选中对象时显示，标记首条用户动作后消失 */}
      {!onboarded && selectedItems.length === 0 && (
        <div className="home-onboarding w-full max-w-2xl mx-auto mb-3 px-4 py-3 rounded-xl flex items-center justify-between gap-3">
          <span className="text-xs font-medium flex items-center gap-1.5">
            从一段对话开始：选择联系人或群聊，再写下你想了解的问题。
          </span>
          <button
            onClick={markOnboarded}
            className="text-[10px] text-gray-400 hover:text-gray-600 transition-colors whitespace-nowrap"
          >
            不再提示
          </button>
        </div>
      )}

      {/* AI 未配置提示（优先级最高，覆盖在输入卡片之前） */}
      <AIConfigNotice
        visible={profiles.length === 0 && !demoMockActive}
        onOpenSettings={onOpenSettings}
        className="w-full max-w-2xl mb-4"
      />

      {/* 输入卡片 */}
      {inputCard}

      {/* 智能建议 + 通用快捷提问 */}
      <div className="mt-6 max-w-2xl w-full flex flex-col items-center gap-3">
        {/* 智能建议（基于用户 Top 联系人，最多 4 条） */}
        {smartSuggestions.length > 0 && (
          <div className="w-full">
            <div className="text-[10px] font-bold text-[#576b95] uppercase tracking-widest mb-2 text-center flex items-center justify-center gap-1.5">
              可以从这些问题开始
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {smartSuggestions.slice(0, 4).map((s, i) => (
                <button
                  key={i}
                  onClick={() => applySmartSuggestion(s)}
                  className={`home-suggestion${privacyMode ? ' privacy-blur' : ''}`}
                  title="点击自动选中对象 + 填入问题"
                >
                  <span>{s.label}</span><ArrowUpRight size={15} aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 通用快捷提问：默认前 3 个可见 + 「更多」展开剩余 */}
        <div className="w-full">
          <div className="text-[10px] font-bold text-gray-300 uppercase tracking-widest mb-2 text-center">通用快捷</div>
          <div className="flex flex-wrap gap-2 justify-center">
            {PRESETS.slice(0, presetsExpanded ? PRESETS.length : 3).map(p => (
              <button
                key={p.label}
                onClick={() => handleChip(p.prompt)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold border border-gray-200 dark:border-white/10 text-gray-500 dark:text-gray-400 hover:border-[#07c160] hover:text-[#07c160] hover:bg-[#f0faf4] dark:hover:bg-[#07c160]/10 transition-colors"
              >
                <MessageSquare size={11} />
                {p.label}
              </button>
            ))}
            {PRESETS.length > 3 && (
              <button
                onClick={togglePresets}
                className="px-3 py-1.5 rounded-full text-xs font-semibold text-gray-400 hover:text-[#07c160] transition-colors"
              >
                {presetsExpanded ? '收起 ▴' : `更多 ${PRESETS.length - 3} 条 ▾`}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 最近聊天（联系人 + 群聊混合） */}
      {recentItems.length > 0 && (
        <div className="w-full max-w-2xl mt-8" aria-label="最近聊天">
          <div className="relative mb-3 text-center"><span className="text-xs font-medium text-gray-400">最近聊天</span>{recentPageCount > 1 && <button type="button" onClick={() => setRecentPage(page => (page + 1) % recentPageCount)} className="absolute right-0 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-[#07835d]" aria-label={`换一批最近聊天，当前第 ${currentRecentPage + 1} / ${recentPageCount} 批`}><RefreshCw size={12} />换一批</button>}</div>
          <div className="flex gap-2 overflow-x-auto pb-1 justify-center flex-wrap">
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
                    <Avatar src={avatar ? avatarSrc(avatar) : undefined} name={name} />
                    {isSelected && (
                      <div className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-[#07c160] flex items-center justify-center">
                        <Check size={10} className="text-white" />
                      </div>
                    )}
                  </div>
                  <span className={`text-xs font-medium text-gray-500 dark:text-gray-400 max-w-[60px] truncate${privacyMode ? ' privacy-blur' : ''}`}>{name}</span>
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
