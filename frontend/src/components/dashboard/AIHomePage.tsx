/**
 * AI 首页 — 以「直接问我」为核心的纯净首页，对话直接在页面内生成
 */

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Bot, Send, X, Search, RotateCcw, Loader2, Copy, Check, Square, ArrowLeft, Share2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { generateShareImage } from '../../utils/shareImage';
import type { ContactStats, TimeRange, ChatMessage } from '../../types';
import { contactsApi } from '../../services/api';

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
  { label: '关系分析', prompt: '请分析我和这个人的聊天关系，包括互动频率、话题偏好和情感倾向，以及这段关系的特点。' },
  { label: '情感变化', prompt: '请分析我们聊天记录中情感基调的变化，找出情绪高峰和低谷的时期，以及可能的原因。' },
  { label: '高频话题', prompt: '请总结我们聊天中最常讨论的话题和关键词，并分析各话题的比重与变化趋势。' },
  { label: '沟通风格', prompt: '请分析我和这个人各自的沟通风格：用词习惯、句子长短、表达方式，以及两人风格的异同。' },
  { label: '趣味总结', prompt: '请用轻松有趣的方式总结我们的聊天记录，找出印象最深的对话片段或有趣的互动模式。' },
];

// ─── 联系人选择器 ──────────────────────────────────────────────────────────────

const ContactPicker: React.FC<{
  contacts: ContactStats[];
  selected: ContactStats | null;
  onSelect: (c: ContactStats | null) => void;
  disabled?: boolean;
}> = ({ contacts, selected, onSelect, disabled }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return contacts.slice(0, 20);
    const q = query.toLowerCase();
    return contacts
      .filter(c => (c.remark + c.nickname + c.username).toLowerCase().includes(q))
      .slice(0, 20);
  }, [contacts, query]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (selected) {
    const name = selected.remark || selected.nickname || selected.username;
    const avatar = selected.small_head_url || selected.big_head_url;
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-[#f0faf4] border border-[#07c160]/30 rounded-xl">
        {avatar
          ? <img src={avatar} className="w-6 h-6 rounded-full object-cover flex-shrink-0" alt={name} />
          : <div className="w-6 h-6 rounded-full bg-[#07c160] flex items-center justify-center flex-shrink-0 text-white text-[10px] font-black">{name[0]}</div>
        }
        <span className="text-sm font-semibold text-[#07c160] flex-1 truncate">{name}</span>
        {!disabled && (
          <button onClick={() => onSelect(null)} className="text-[#07c160]/60 hover:text-[#07c160] transition-colors">
            <X size={14} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-xl bg-white hover:border-[#07c160]/40 transition-colors">
        <Search size={14} className="text-gray-300 flex-shrink-0" />
        <input
          className="flex-1 text-sm bg-transparent outline-none placeholder-gray-300 min-w-0"
          placeholder="选择联系人…"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
        />
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-100 rounded-2xl shadow-xl overflow-hidden max-h-60 overflow-y-auto">
          {filtered.map(c => {
            const name = c.remark || c.nickname || c.username;
            const avatar = c.small_head_url || c.big_head_url;
            return (
              <button
                key={c.username}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-[#f0faf4] transition-colors text-left"
                onMouseDown={e => { e.preventDefault(); onSelect(c); setQuery(''); setOpen(false); }}
              >
                {avatar
                  ? <img src={avatar} className="w-8 h-8 rounded-full object-cover flex-shrink-0" alt={name} />
                  : <div className="w-8 h-8 rounded-full bg-[#07c160]/20 flex items-center justify-center flex-shrink-0 text-[#07c160] text-sm font-black">{name[0]}</div>
                }
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-[#1d1d1f] truncate">{name}</div>
                  <div className="text-[10px] text-gray-400">{c.total_messages.toLocaleString()} 条消息</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ─── 消息气泡 ──────────────────────────────────────────────────────────────────

type ChatMsg = { role: 'user' | 'assistant'; content: string; streaming?: boolean };

const MessageBubble: React.FC<{
  msg: ChatMsg;
  contactName?: string;
  avatarUrl?: string;
  prevQuestion?: string;
}> = ({ msg, contactName, avatarUrl, prevQuestion }) => {
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);

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
      const savedPath = await generateShareImage({ question: prevQuestion, answer: msg.content, contactName, avatarUrl });
      const isAppMode = savedPath.startsWith('/');
      setShareMsg({ ok: true, text: isAppMode ? `已保存至 ${savedPath}` : '图片已下载' });
    } catch (err) {
      setShareMsg({ ok: false, text: `生成失败：${(err as Error).message}` });
    } finally {
      setSharing(false);
      setTimeout(() => setShareMsg(null), 4000);
    }
  };

  return (
    <div className="flex gap-2 flex-row group">
      <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center bg-[#576b95] text-white mt-0.5">
        <Bot size={13} />
      </div>
      <div className="flex flex-col gap-1 max-w-[80%]">
        <div className="px-4 py-2.5 rounded-2xl rounded-bl-sm text-sm leading-relaxed bg-[#f0f0f0] text-[#1d1d1f] prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-hr:my-2">
          {msg.content
            ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
            : msg.streaming
              ? <span className="flex items-center gap-2 text-gray-400 text-xs"><Loader2 size={13} className="animate-spin text-[#576b95] flex-shrink-0" />正在分析，请稍候…</span>
              : ''}
        </div>
        {msg.content && !msg.streaming && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold text-gray-400 hover:text-[#07c160] hover:bg-[#f0faf4] transition-colors"
                title="复制内容"
              >
                {copied ? <Check size={11} className="text-[#07c160]" /> : <Copy size={11} />}
                {copied ? '已复制' : '复制'}
              </button>
              <button
                onClick={handleShare}
                disabled={sharing}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold text-gray-400 hover:text-[#576b95] hover:bg-[#f0f4ff] transition-colors disabled:opacity-50"
                title="保存为图片分享"
              >
                {sharing ? <Loader2 size={11} className="animate-spin" /> : <Share2 size={11} />}
                {sharing ? '生成中…' : '分享'}
              </button>
            </div>
            {shareMsg && (
              <p className={`text-[10px] font-medium px-1 ${shareMsg.ok ? 'text-[#07c160]' : 'text-red-500'}`}>
                {shareMsg.text}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── 主组件 ───────────────────────────────────────────────────────────────────

export interface AIHomePageProps {
  contacts: ContactStats[];
  timeRange: TimeRange;
  onReselect: () => void;
}

export const AIHomePage: React.FC<AIHomePageProps> = ({
  contacts,
  timeRange,
  onReselect,
}) => {
  const [selectedContact, setSelectedContact] = useState<ContactStats | null>(null);
  const [input, setInput] = useState('');
  const [noContactHint, setNoContactHint] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loading, setLoading] = useState(false);
  const [ctxLoading, setCtxLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const hasChatHistory = messages.length > 0;

  // 最近聊天：按最后消息时间排序，取前 12 个
  const recentContacts = useMemo(() =>
    [...contacts]
      .filter(c => c.total_messages > 0)
      .sort((a, b) => new Date(b.last_message_time).getTime() - new Date(a.last_message_time).getTime())
      .slice(0, 12),
    [contacts]
  );

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

  const sendMessage = useCallback(async (q: string) => {
    if (!q.trim() || loading) return;
    if (!selectedContact) {
      setNoContactHint(true);
      setTimeout(() => setNoContactHint(false), 2000);
      textareaRef.current?.focus();
      return;
    }

    setLoading(true);
    setCtxLoading(true);
    setInput('');

    const name = selectedContact.remark || selectedContact.nickname || selectedContact.username;

    // 加载最近 200 条消息
    let ctxText = '';
    try {
      const msgs: ChatMessage[] = await contactsApi.exportMessages(selectedContact.username) ?? [];
      const recent = msgs.slice(-200);
      const lines = recent.map(m => `[${m.date ?? ''} ${m.time}] ${m.is_mine ? '我' : name}：${m.content}`);
      ctxText = lines.map(l => maskPrivacy(l, name)).join('\n');
    } catch { /* ignore, send without context */ }
    setCtxLoading(false);

    const userMsg: ChatMsg = { role: 'user', content: q.trim() };
    const newMessages = [...messages, userMsg];
    const assistantIdx = newMessages.length;
    setMessages([...newMessages, { role: 'assistant', content: '', streaming: true }]);
    scrollToBottom();

    const sysPrompt = ctxText
      ? `你是一个聊天记录分析助手。以下是我与「${name}」的最近聊天记录（已脱敏处理）：\n\n${ctxText}\n\n请根据以上聊天记录回答用户的问题，分析时请客观、有洞察力，用中文回答，语言自然流畅。`
      : `你是一个聊天记录分析助手，请帮助分析我与「${name}」的聊天关系，用中文回答。`;

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const resp = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: sysPrompt },
            ...newMessages.map(m => ({ role: m.role, content: m.content })),
          ],
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
            const chunk = JSON.parse(line.slice(6)) as { delta?: string; done?: boolean; error?: string };
            if (chunk.error) throw new Error(chunk.error);
            if (chunk.done) break;
            if (chunk.delta) {
              setMessages(prev => {
                const next = [...prev];
                const msg = next[assistantIdx];
                if (msg) next[assistantIdx] = { ...msg, content: msg.content + chunk.delta };
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
      setMessages(prev => {
        const next = [...prev];
        const msg = next[assistantIdx];
        if (msg?.streaming) next[assistantIdx] = { ...msg, streaming: false };
        return next;
      });
      setLoading(false);
      abortRef.current = null;
    }
  }, [loading, selectedContact, messages, scrollToBottom]);

  const handleSend = (query?: string) => {
    const q = query ?? input;
    sendMessage(q);
  };

  const handleChip = (prompt: string) => {
    if (!selectedContact) {
      setInput(prompt);
      setNoContactHint(true);
      setTimeout(() => setNoContactHint(false), 2000);
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

  // ── 输入卡片（复用于两种布局）─────────────────────────────────────────────

  const inputCard = (
    <div className="w-full max-w-xl mx-auto">
      <div className={`bg-white rounded-3xl border-2 shadow-sm transition-colors ${noContactHint ? 'border-amber-300' : 'border-gray-100 focus-within:border-[#07c160]/40'}`}>
        <div className="px-4 pt-4 pb-2">
          <ContactPicker
            contacts={contacts}
            selected={selectedContact}
            onSelect={c => { setSelectedContact(c); if (!c) handleNewChat(); }}
            disabled={loading}
          />
        </div>
        <div className="mx-4 border-t border-dashed border-gray-100" />
        <div className="px-4 pt-2 pb-3 flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={hasChatHistory ? 1 : 2}
            disabled={loading}
            placeholder={
              ctxLoading ? '正在加载聊天记录…'
              : noContactHint ? '请先选择一个联系人↑'
              : hasChatHistory ? '继续提问…（Enter 发送）'
              : '想问什么？（Enter 发送，Shift+Enter 换行）'
            }
            className={`flex-1 resize-none bg-transparent text-sm outline-none leading-relaxed transition-colors ${
              noContactHint ? 'placeholder-amber-400' : 'placeholder-gray-300'
            } disabled:opacity-50`}
          />
          {loading ? (
            <button
              onClick={handleStop}
              className="mb-0.5 flex-shrink-0 w-9 h-9 bg-red-400 hover:bg-red-500 text-white rounded-xl flex items-center justify-center transition-colors"
              title="停止"
            >
              <Square size={13} fill="white" />
            </button>
          ) : (
            <button
              onClick={() => handleSend()}
              disabled={!input.trim()}
              className="mb-0.5 flex-shrink-0 w-9 h-9 bg-[#07c160] hover:bg-[#06ad56] disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-xl flex items-center justify-center transition-colors"
            >
              <Send size={15} />
            </button>
          )}
        </div>
      </div>
      <p className="mt-2 text-center text-[10px] text-gray-300 font-medium">
        优先使用最近 200 条聊天记录 · 手机号等敏感信息自动脱敏
      </p>
    </div>
  );

  // ── 对话模式 ───────────────────────────────────────────────────────────────

  if (hasChatHistory) {
    const contactName = selectedContact
      ? (selectedContact.remark || selectedContact.nickname || selectedContact.username)
      : '';
    const contactAvatar = selectedContact?.small_head_url || selectedContact?.big_head_url || undefined;

    return (
      <div className="flex flex-col min-h-full">
        {/* 顶部栏 */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-4 sm:px-6 py-3 bg-white/90 backdrop-blur border-b border-gray-100">
          {/* 返回首页按钮（左侧，最显眼的操作） */}
          <button
            onClick={handleNewChat}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl hover:bg-gray-100 text-sm font-semibold text-gray-500 hover:text-[#1d1d1f] transition-all -ml-1"
            title="返回首页"
          >
            <ArrowLeft size={16} />
            返回
          </button>

          {/* 中间：联系人信息 */}
          {selectedContact && (
            <div className="flex items-center gap-2 absolute left-1/2 -translate-x-1/2">
              {contactAvatar
                ? <img src={contactAvatar} className="w-6 h-6 rounded-full object-cover flex-shrink-0" alt={contactName} />
                : <div className="w-6 h-6 rounded-full bg-[#07c160] flex items-center justify-center text-white text-[10px] font-black flex-shrink-0">{contactName[0]}</div>
              }
              <span className="text-sm font-semibold text-[#1d1d1f] truncate max-w-[120px]">{contactName}</span>
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
              contactName={contactName}
              avatarUrl={contactAvatar}
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
        <div className="sticky bottom-0 bg-white/90 backdrop-blur border-t border-gray-100 px-4 sm:px-6 py-4">
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
        <h1 className="text-3xl font-black text-[#1d1d1f] tracking-tight">WeLink</h1>
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

      {/* 输入卡片 */}
      {inputCard}

      {/* 快捷 Prompt 胶囊 */}
      <div className="flex flex-wrap gap-2 mt-6 justify-center max-w-xl">
        {PRESETS.map(p => (
          <button
            key={p.label}
            onClick={() => handleChip(p.prompt)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold border border-gray-200 text-gray-500 hover:border-[#07c160] hover:text-[#07c160] hover:bg-[#f0faf4] transition-colors"
          >
            <Bot size={11} />
            {p.label}
          </button>
        ))}
      </div>

      {/* 最近聊天 */}
      {recentContacts.length > 0 && (
        <div className="w-full max-w-xl mt-8">
          <p className="text-[10px] font-black text-gray-300 uppercase tracking-widest mb-3 text-center">最近聊天</p>
          <div className="flex gap-3 overflow-x-auto pb-1 justify-center flex-wrap">
            {recentContacts.map(c => {
              const name = c.remark || c.nickname || c.username;
              const avatar = c.small_head_url || c.big_head_url;
              return (
                <button
                  key={c.username}
                  onClick={() => { setSelectedContact(c); textareaRef.current?.focus(); }}
                  className={`flex-shrink-0 flex flex-col items-center gap-1.5 p-2 rounded-2xl border-2 transition-all ${
                    selectedContact?.username === c.username
                      ? 'border-[#07c160] bg-[#f0faf4]'
                      : 'border-transparent hover:border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {avatar
                    ? <img src={avatar} className="w-10 h-10 rounded-full object-cover" alt={name} />
                    : <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#07c160] to-[#06ad56] flex items-center justify-center text-white text-sm font-black">{name[0]}</div>
                  }
                  <span className="text-[10px] font-semibold text-gray-500 max-w-[52px] truncate">{name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
