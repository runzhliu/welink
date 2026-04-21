/**
 * 时光机 · 当天 AI 分析面板
 *
 * 两种模式：
 *   full（全量）   — 前端先并行拉完当天所有会话消息，拼成上下文发给 /api/ai/analyze
 *   hybrid（检索） — 后端走 /api/ai/day-rag 做混合检索后再生成
 *
 * 相比旧版的改动：
 *   - loadDayContext() 从 for-await 串行改成 Promise.all 并行（10+ 接口同时发）
 *   - hybrid 和 full 的 SSE 解析合并到 consumeSSEStream，消除重复
 *   - 复制 / 分享 handler 用 useCallback 固化
 *   - 流式回复气泡加 aria-live，屏幕阅读器能读到「分析中…」
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft, Bot, Send, Loader2, Square, Copy, Check, Share2, Sparkles,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { calendarApi } from '../../services/api';
import type { CalendarDayEntry, ChatMessage, GroupChatMessage } from '../../types';
import { generateShareImage } from '../../utils/shareImage';
import { RevealLink } from '../common/RevealLink';
import { isAIConfigError } from '../../utils/aiError';
import { PROVIDER_LABELS, consumeSSEStream } from './calendarUtils';

// ─── 类型 ─────────────────────────────────────────────────────────────────────

export interface DayAIMessage {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  stats?: { elapsed: number; tokensPerSec: number; chars: number; provider?: string; model?: string };
}

interface DayAIPanelProps {
  date: string;
  contacts: CalendarDayEntry[];
  groups: CalendarDayEntry[];
  onBack: () => void;
  onOpenSettings?: () => void;
}

interface ProfileItem { id: string; provider: string; model?: string; }

// ─── 预设问题 ────────────────────────────────────────────────────────────────
const DAY_PRESETS = [
  { label: '今日概览', prompt: '请总结今天所有聊天的主要内容、话题和情绪基调。' },
  { label: '重要事项', prompt: '今天的聊天中提到了哪些重要事项、约定或待办事项？' },
  { label: '情绪状态', prompt: '从今天的聊天记录来看，整体情绪状态怎么样？' },
  { label: '趣味总结', prompt: '用轻松有趣的方式总结今天的聊天，找出最有意思的片段。' },
];

// ─── AI 回复气泡 ──────────────────────────────────────────────────────────────

const DayAssistantBubble: React.FC<{
  msg: DayAIMessage;
  date: string;
  prevQuestion?: string;
  onOpenSettings?: () => void;
}> = ({ msg, date, prevQuestion, onOpenSettings }) => {
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareMsg, setShareMsg] = useState<{ ok: boolean; text: string; path?: string } | null>(null);

  const handleCopy = useCallback(() => {
    if (!msg.content) return;
    navigator.clipboard.writeText(msg.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }, [msg.content]);

  const handleShare = useCallback(async () => {
    if (!msg.content || sharing) return;
    setSharing(true);
    setShareMsg(null);
    try {
      const savedPath = await generateShareImage({
        question: prevQuestion,
        answer: msg.content,
        contactName: `${date} 时光机`,
        stats: msg.stats ? {
          provider: msg.stats.provider,
          model: msg.stats.model,
          elapsedSecs: msg.stats.elapsed,
          tokensPerSec: msg.stats.tokensPerSec,
          charCount: msg.stats.chars,
        } : undefined,
      });
      const isAppMode = savedPath.startsWith('/') || /^[A-Z]:\\/i.test(savedPath);
      setShareMsg({ ok: true, text: isAppMode ? `已保存至 ${savedPath}` : '图片已下载', path: isAppMode ? savedPath : undefined });
    } catch (err) {
      setShareMsg({ ok: false, text: `生成失败：${(err as Error).message}` });
    } finally {
      setSharing(false);
      setTimeout(() => setShareMsg(null), 4000);
    }
  }, [msg.content, msg.stats, sharing, prevQuestion, date]);

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex gap-2 group">
        <div className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-white mt-0.5 bg-[#576b95]">
          <Bot size={12} />
        </div>
        <div className="max-w-[85%] flex flex-col gap-0.5">
          <div className="px-3 py-2 rounded-2xl rounded-bl-sm text-sm leading-relaxed break-words bg-gray-100 dark:bg-white/10 text-gray-800 dark:text-gray-200 prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 dark:prose-invert">
            {msg.content
              ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
              : ''}
            {!msg.streaming && msg.content && isAIConfigError(msg.content) && onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="not-prose mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#07c160] text-white text-xs font-bold hover:bg-[#06ad56] transition-colors shadow-sm"
              >
                <Sparkles size={12} /> 去设置
              </button>
            )}
            {msg.stats && !msg.streaming && (
              <div className="flex items-center justify-end gap-1.5 mt-1.5 text-[10px] text-gray-400 not-prose flex-wrap">
                {msg.stats.provider && <span className="font-medium">{PROVIDER_LABELS[msg.stats.provider] ?? msg.stats.provider}{msg.stats.model ? ` · ${msg.stats.model}` : ''}</span>}
                {msg.stats.provider && <span className="text-gray-300">·</span>}
                <span>{msg.stats.elapsed.toFixed(1)}s</span>
                <span className="text-gray-300">·</span>
                <span>~{msg.stats.tokensPerSec} tok/s</span>
                <span className="text-gray-300">·</span>
                <span>{msg.stats.chars} 字符</span>
              </div>
            )}
          </div>
          {msg.content && !msg.streaming && (
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={handleCopy}
                aria-label={copied ? '已复制到剪贴板' : '复制回复'}
                className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold text-gray-400 hover:text-[#07c160] hover:bg-[#f0faf4] dark:hover:bg-[#07c160]/10 transition-colors"
              >
                {copied ? <Check size={10} className="text-[#07c160]" /> : <Copy size={10} />}
                {copied ? '已复制' : '复制'}
              </button>
              <button
                type="button"
                onClick={handleShare}
                disabled={sharing}
                aria-label="生成分享图片"
                className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold text-gray-400 hover:text-[#576b95] hover:bg-[#f0f4ff] dark:hover:bg-[#576b95]/10 transition-colors disabled:opacity-50"
              >
                {sharing ? <Loader2 size={10} className="animate-spin" /> : <Share2 size={10} />}
                {sharing ? '生成中…' : '分享'}
              </button>
            </div>
          )}
        </div>
      </div>
      {shareMsg && (
        <p className={`text-[10px] font-medium ml-8 break-all leading-relaxed ${shareMsg.ok ? 'text-[#07c160]' : 'text-red-500'}`}>
          {shareMsg.text}
          {shareMsg.path && <RevealLink path={shareMsg.path} className="ml-2" />}
        </p>
      )}
    </div>
  );
};

// ─── 主面板 ──────────────────────────────────────────────────────────────────

export const DayAIPanel: React.FC<DayAIPanelProps> = ({ date, contacts, groups, onBack, onOpenSettings }) => {
  const [messages, setMessages] = useState<DayAIMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [ragMode, setRagMode] = useState<'full' | 'hybrid'>('full');
  const [ragInfo, setRagInfo] = useState<{ hits: number; retrieved: number } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [profiles, setProfiles] = useState<ProfileItem[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');

  useEffect(() => {
    let alive = true;
    fetch('/api/preferences')
      .then(r => r.json())
      .then((d: { llm_profiles?: ProfileItem[]; llm_provider?: string; llm_model?: string }) => {
        if (!alive) return;
        if (d.llm_profiles && d.llm_profiles.length > 0) {
          setProfiles(d.llm_profiles);
          setSelectedProfileId(d.llm_profiles[0].id);
        } else if (d.llm_provider) {
          setProfiles([{ id: '__default__', provider: d.llm_provider, model: d.llm_model }]);
          setSelectedProfileId('__default__');
        }
      }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const selectedProfile = profiles.find(p => p.id === selectedProfileId) ?? profiles[0];

  const scrollToBottom = useCallback(
    () => setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50),
    [],
  );

  // 并行拉取当天所有私聊 + 群聊消息，再拼成上下文文本。
  // 旧版是顺序 await，10 私聊 + 3 群聊 = 13 次串行网络延迟；改并行后理论上降为 max(个体延迟)
  const loadDayContext = useCallback(async (): Promise<{ text: string; count: number }> => {
    const [contactResults, groupResults] = await Promise.all([
      Promise.all(contacts.map(entry =>
        calendarApi.getContactMessages(date, entry.username)
          .then(msgs => ({ entry, msgs: (msgs || []) as ChatMessage[] }))
          .catch(() => ({ entry, msgs: [] as ChatMessage[] })),
      )),
      Promise.all(groups.map(entry =>
        calendarApi.getGroupMessages(date, entry.username)
          .then(msgs => ({ entry, msgs: (msgs || []) as GroupChatMessage[] }))
          .catch(() => ({ entry, msgs: [] as GroupChatMessage[] })),
      )),
    ]);

    const allLines: string[] = [];
    for (const { entry, msgs } of contactResults) {
      if (msgs.length === 0) continue;
      allLines.push(`\n=== 与 ${entry.display_name} 的私聊 ===`);
      for (const m of msgs) {
        if (!m.content.startsWith('[')) {
          allLines.push(`[${date} ${m.time}] ${m.is_mine ? '我' : entry.display_name}：${m.content}`);
        }
      }
    }
    for (const { entry, msgs } of groupResults) {
      if (msgs.length === 0) continue;
      allLines.push(`\n=== 群聊「${entry.display_name}」===`);
      for (const m of msgs) {
        if (!m.content.startsWith('[')) {
          allLines.push(`[${date} ${m.time}] ${m.speaker}：${m.content}`);
        }
      }
    }
    return { text: allLines.join('\n'), count: allLines.filter(l => !l.startsWith('\n===')).length };
  }, [contacts, groups, date]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;
    const userMsg: DayAIMessage = { role: 'user', content: text.trim() };
    const newMessages = [...messages, userMsg];
    const assistantIdx = newMessages.length;
    setMessages([...newMessages, { role: 'assistant', content: '', streaming: true }]);
    setInput('');
    setLoading(true);
    scrollToBottom();

    const abort = new AbortController();
    abortRef.current = abort;
    const streamStart = Date.now();

    const updateAssistant = (patch: Partial<DayAIMessage>) =>
      setMessages(prev => {
        const next = [...prev];
        if (next[assistantIdx]) next[assistantIdx] = { ...next[assistantIdx], ...patch };
        return next;
      });

    const profileId = selectedProfileId !== '__default__' ? selectedProfileId : '';

    try {
      let resp: Response;
      if (ragMode === 'hybrid') {
        resp = await fetch('/api/ai/day-rag', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, profile_id: profileId, messages: newMessages.map(m => ({ role: m.role, content: m.content })) }),
          signal: abort.signal,
        });
      } else {
        updateAssistant({ content: '📅 正在加载当天聊天记录…' });
        const { text: ctxText, count } = await loadDayContext();
        if (count === 0) {
          updateAssistant({ content: '当天暂无文本聊天记录可分析。', streaming: false });
          return;
        }
        updateAssistant({ content: '' });
        const systemPrompt = `你是微信聊天数据分析助手。以下是 ${date} 这一天所有的聊天记录（包含私聊和群聊）：\n\n${ctxText}\n\n请基于以上聊天记录回答用户的问题。`;
        resp = await fetch('/api/ai/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: '', is_group: false, from: 0, to: 0,
            profile_id: profileId,
            messages: [{ role: 'system', content: systemPrompt }, ...newMessages.map(m => ({ role: m.role, content: m.content }))],
          }),
          signal: abort.signal,
        });
      }

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? resp.statusText);
      }

      let acc = '';
      await consumeSSEStream(resp, chunk => {
        if (chunk.error) throw new Error(chunk.error);
        if (chunk.rag_meta) setRagInfo(chunk.rag_meta);
        if (chunk.delta) {
          acc += chunk.delta;
          updateAssistant({ content: acc });
          scrollToBottom();
        }
      });
    } catch (e: unknown) {
      if ((e as { name?: string }).name === 'AbortError') return;
      updateAssistant({ content: `❌ ${e instanceof Error ? e.message : '请求失败'}`, streaming: false });
    } finally {
      const elapsed = (Date.now() - streamStart) / 1000;
      setMessages(prev => {
        const next = [...prev];
        const msg = next[assistantIdx];
        if (msg?.streaming) {
          const chars = msg.content.length;
          const tokensPerSec = elapsed > 0.1 ? Math.round(chars / elapsed / 1.5) : 0;
          next[assistantIdx] = {
            ...msg,
            streaming: false,
            stats: {
              elapsed, tokensPerSec, chars,
              provider: selectedProfile?.provider,
              model: selectedProfile?.model,
            },
          };
        }
        return next;
      });
      setLoading(false);
      scrollToBottom();
    }
  }, [loading, messages, ragMode, selectedProfileId, selectedProfile, date, loadDayContext, scrollToBottom]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b dark:border-white/10 flex-shrink-0">
        <button
          type="button"
          onClick={onBack}
          aria-label="返回"
          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
        >
          <ChevronLeft size={16} className="text-gray-500" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="font-black text-sm text-[#1d1d1f] dark:text-white truncate">{date} · AI 分析</div>
          <div className="text-[10px] text-gray-400">{contacts.length} 私聊 · {groups.length} 群聊</div>
        </div>
        {profiles.length > 1 && (
          <div className="flex items-center gap-1 flex-wrap">
            {profiles.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedProfileId(p.id)}
                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors ${
                  selectedProfileId === p.id
                    ? 'bg-[#576b95] text-white border-[#576b95]'
                    : 'bg-white dark:bg-white/5 text-gray-400 border-gray-200 dark:border-white/10 hover:border-[#576b95] hover:text-[#576b95]'
                }`}
              >
                {`${PROVIDER_LABELS[p.provider] ?? p.provider}${p.model ? ` · ${p.model}` : ''}`}
              </button>
            ))}
          </div>
        )}
        <div className="flex rounded-lg border border-gray-200 dark:border-white/10 overflow-hidden flex-shrink-0" role="radiogroup" aria-label="分析模式">
          <button
            type="button" role="radio" aria-checked={ragMode === 'full'}
            onClick={() => setRagMode('full')}
            className={`px-2 py-1 text-[10px] font-bold transition-colors ${ragMode === 'full' ? 'bg-[#07c160] text-white' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
          >
            全量
          </button>
          <button
            type="button" role="radio" aria-checked={ragMode === 'hybrid'}
            onClick={() => setRagMode('hybrid')}
            className={`px-2 py-1 text-[10px] font-bold transition-colors ${ragMode === 'hybrid' ? 'bg-[#576b95] text-white' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
          >
            检索
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" aria-live="polite">
        {messages.length === 0 && (
          <div className="space-y-3">
            <div className="text-[11px] text-gray-400 text-center pt-2">
              {ragMode === 'full' ? '全量分析：加载当天所有聊天记录' : '混合检索：从已建索引的对话中检索'}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DAY_PRESETS.map(p => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => sendMessage(p.prompt)}
                  className="px-2.5 py-1 rounded-full border border-[#07c160] text-[#07c160] text-[11px] font-semibold hover:bg-[#07c160] hover:text-white transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {ragInfo && ragMode === 'hybrid' && (
          <div className="text-[10px] text-[#576b95] bg-[#576b95]/5 dark:bg-[#576b95]/15 rounded-lg px-3 py-1.5 break-words">
            检索到 {ragInfo.hits} 条相关消息（含上下文共 {ragInfo.retrieved} 条）
          </div>
        )}
        {messages.map((msg, i) => (
          msg.role === 'user' ? (
            <div key={`u-${i}`} className="flex gap-2 flex-row-reverse">
              <div className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center bg-[#07c160] text-white text-[10px] font-black mt-0.5">我</div>
              <div className="max-w-[85%] px-3 py-2 rounded-2xl rounded-br-sm text-sm leading-relaxed whitespace-pre-wrap break-words bg-[#07c160] text-white">
                {msg.content}
              </div>
            </div>
          ) : msg.streaming ? (
            <div key={`s-${i}`} className="flex gap-2">
              <div className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center bg-[#576b95] text-white mt-0.5"><Bot size={12} /></div>
              <div className="px-3 py-2 rounded-2xl rounded-bl-sm text-sm bg-gray-100 dark:bg-white/10 text-gray-400">
                <span className="flex items-center gap-1.5 text-xs">
                  <Loader2 size={12} className="animate-spin text-[#576b95]" />
                  分析中…{selectedProfile && <span className="ml-1 text-[#576b95]/70">{PROVIDER_LABELS[selectedProfile.provider] ?? selectedProfile.provider}{selectedProfile.model ? ` · ${selectedProfile.model}` : ''}</span>}
                </span>
              </div>
            </div>
          ) : (
            <DayAssistantBubble
              key={`a-${i}`}
              msg={msg}
              date={date}
              prevQuestion={messages.slice(0, i).reverse().find(m => m.role === 'user')?.content}
              onOpenSettings={onOpenSettings}
            />
          )
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="px-3 pb-3 flex-shrink-0">
        <div className="flex items-end gap-2 bg-gray-50 dark:bg-white/5 rounded-2xl px-3 py-2 border border-gray-100 dark:border-white/10">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
            placeholder="提问关于这一天的聊天…"
            rows={1}
            aria-label="向 AI 提问"
            className="flex-1 bg-transparent text-sm resize-none outline-none placeholder:text-gray-400 max-h-20 min-h-[1.25rem] dark:text-gray-100"
          />
          {loading
            ? <button type="button" onClick={() => abortRef.current?.abort()} aria-label="停止生成" className="p-1.5 rounded-lg bg-red-100 text-red-500 hover:bg-red-200 dark:bg-red-500/20 dark:hover:bg-red-500/30 flex-shrink-0 transition-colors"><Square size={14} /></button>
            : <button type="button" onClick={() => sendMessage(input)} disabled={!input.trim()} aria-label="发送" className="p-1.5 rounded-lg bg-[#07c160] text-white hover:bg-[#06ad56] disabled:opacity-30 flex-shrink-0 transition-colors"><Send size={14} /></button>
          }
        </div>
      </div>
    </div>
  );
};
