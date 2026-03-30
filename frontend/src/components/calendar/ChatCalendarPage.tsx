/**
 * 时光机 — 3 个月分页聊天日历
 *
 * 布局：
 *   上：← [年月范围] → + 3 个月日历网格并排 + 对应时段折线图
 *   右侧面板：点击日期后显示当天活跃联系人/群聊，再点进去看消息
 */

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Hourglass, MessageSquare, ChevronLeft, ChevronRight, X, Users, MessagesSquare, Bot, Send, Loader2, Square } from 'lucide-react';
import { calendarApi } from '../../services/api';
import type { CalendarDayEntry, ContactStats, ChatMessage, GroupChatMessage } from '../../types';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';

interface Props {
  contacts: ContactStats[];
  onContactClick?: (contact: ContactStats) => void;
}

// ─── 颜色 ──────────────────────────────────────────────────────────────────────
const HEAT_COLORS = ['#ebedf0', '#c6e9d0', '#87d4a8', '#40c463', '#216e39'];
function heatColor(val: number, max: number): string {
  if (val === 0 || max === 0) return HEAT_COLORS[0];
  const r = val / max;
  if (r <= 0.1) return HEAT_COLORS[1];
  if (r <= 0.3) return HEAT_COLORS[2];
  if (r <= 0.6) return HEAT_COLORS[3];
  return HEAT_COLORS[4];
}

// ─── 工具函数 ──────────────────────────────────────────────────────────────────
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
const firstWeekday = (y: number, m: number) => { const d = new Date(y, m, 1).getDay(); return d === 0 ? 6 : d - 1; };
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const MONTH_NAMES = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

// ─── 单月日历格 ────────────────────────────────────────────────────────────────
interface MonthGridProps {
  year: number;
  month: number;
  heatmap: Record<string, number>;
  maxVal: number;
  selectedDate: string | null;
  onDayClick: (date: string) => void;
}

const MonthGrid: React.FC<MonthGridProps> = ({ year, month, heatmap, maxVal, selectedDate, onDayClick }) => {
  const total = daysInMonth(year, month);
  const offset = firstWeekday(year, month);
  const cells: (number | null)[] = [...Array(offset).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="flex-1 min-w-0">
      {/* 月份标题 */}
      <div className="text-sm font-black text-[#1d1d1f] dark:text-white mb-2 text-center">
        {MONTH_NAMES[month]}
      </div>
      <div className="grid grid-cols-7 gap-px">
        {WEEKDAYS.map(d => (
          <div key={d} className="text-center text-[10px] font-bold text-gray-400 py-1">{d}</div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`e-${i}`} className="h-7" />;
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const count = heatmap[dateStr] || 0;
          const isSelected = dateStr === selectedDate;
          const isToday = dateStr === isoDate(new Date());
          return (
            <button
              key={dateStr}
              onClick={() => onDayClick(dateStr)}
              title={`${dateStr}  ${count} 条`}
              className={`
                h-7 rounded text-[11px] font-semibold transition-all duration-100
                flex items-center justify-center
                ${isSelected ? 'ring-2 ring-[#07c160] ring-offset-1 z-10' : 'hover:opacity-75'}
                ${isToday && !isSelected ? 'ring-1 ring-gray-400' : ''}
              `}
              style={{ backgroundColor: heatColor(count, maxVal) }}
            >
              <span className={count > 0 ? 'text-gray-800 dark:text-gray-100' : 'text-gray-400'}>{day}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

// ─── 折线图 Tooltip ────────────────────────────────────────────────────────────
const TrendTooltip: React.FC<{ active?: boolean; payload?: { value: number }[]; label?: string }> = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-[#2c2c2e] border border-gray-100 dark:border-white/10 rounded-xl px-3 py-2 shadow-lg text-xs">
      <div className="font-bold text-gray-500 mb-0.5">{label}</div>
      <div className="font-black text-[#07c160] text-sm">{payload[0].value.toLocaleString()} 条</div>
    </div>
  );
};

// ─── 消息视图 ──────────────────────────────────────────────────────────────────
interface MessagesViewProps {
  date: string;
  entry: CalendarDayEntry;
  onBack: () => void;
}

const MessagesView: React.FC<MessagesViewProps> = ({ date, entry, onBack }) => {
  const [msgs, setMsgs] = useState<(ChatMessage | GroupChatMessage)[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const fn = entry.is_group
      ? calendarApi.getGroupMessages(date, entry.username)
      : calendarApi.getContactMessages(date, entry.username);
    fn.then(d => setMsgs(d || [])).finally(() => setLoading(false));
  }, [date, entry.username, entry.is_group]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b dark:border-white/10 flex-shrink-0">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
          <ChevronLeft size={16} className="text-gray-500" />
        </button>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {entry.small_head_url ? (
            <img src={entry.small_head_url} alt="" className="w-7 h-7 rounded-lg object-cover flex-shrink-0"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          ) : (
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#07c160] to-[#06ad56] flex items-center justify-center text-white text-xs font-black flex-shrink-0">
              {entry.display_name.charAt(0)}
            </div>
          )}
          <span className="font-bold text-sm truncate">{entry.display_name}</span>
        </div>
        <span className="text-xs text-gray-400 flex-shrink-0">{date}</span>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {loading && <div className="text-center text-gray-300 py-8 animate-pulse text-sm">加载中...</div>}
        {!loading && msgs.length === 0 && <div className="text-center text-gray-300 py-8 text-sm">暂无消息</div>}
        {msgs.map((m, i) => {
          const isMine = 'is_mine' in m ? m.is_mine : false;
          const speaker = 'speaker' in m ? (m as GroupChatMessage).speaker : (isMine ? '我' : entry.display_name);
          return (
            <div key={i} className={`flex gap-2 ${isMine ? 'flex-row-reverse' : ''}`}>
              <div className={`text-[10px] font-bold flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-white mt-0.5 ${isMine ? 'bg-[#07c160]' : 'bg-gray-300'}`}>
                {speaker.charAt(0)}
              </div>
              <div className={`max-w-[80%] flex flex-col gap-0.5 ${isMine ? 'items-end' : 'items-start'}`}>
                {'speaker' in m && !isMine && <span className="text-[10px] text-gray-400 ml-1">{speaker}</span>}
                <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed break-words ${isMine ? 'bg-[#07c160] text-white rounded-tr-sm' : 'bg-gray-100 dark:bg-white/10 text-gray-800 dark:text-gray-200 rounded-tl-sm'}`}>
                  {m.content}
                </div>
                <span className="text-[10px] text-gray-400 mx-1">{m.time}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── 当天 AI 分析面板 ──────────────────────────────────────────────────────────

interface DayAIMessage {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

const DAY_PRESETS = [
  { label: '今日概览', prompt: '请总结今天所有聊天的主要内容、话题和情绪基调。' },
  { label: '重要事项', prompt: '今天的聊天中提到了哪些重要事项、约定或待办事项？' },
  { label: '情绪状态', prompt: '从今天的聊天记录来看，整体情绪状态怎么样？' },
  { label: '趣味总结', prompt: '用轻松有趣的方式总结今天的聊天，找出最有意思的片段。' },
];

interface DayAIPanelProps {
  date: string;
  contacts: CalendarDayEntry[];
  groups: CalendarDayEntry[];
  onBack: () => void;
}

const DayAIPanel: React.FC<DayAIPanelProps> = ({ date, contacts, groups, onBack }) => {
  const [messages, setMessages] = useState<DayAIMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [ragMode, setRagMode] = useState<'full' | 'hybrid'>('full');
  const [ragInfo, setRagInfo] = useState<{ hits: number; retrieved: number } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollToBottom = () => setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);

  const loadDayContext = async (): Promise<{ text: string; count: number }> => {
    const allLines: string[] = [];
    for (const entry of contacts) {
      const msgs = await calendarApi.getContactMessages(date, entry.username).catch(() => []);
      if (msgs && msgs.length > 0) {
        allLines.push(`\n=== 与 ${entry.display_name} 的私聊 ===`);
        for (const m of msgs) {
          if (!m.content.startsWith('[')) {
            allLines.push(`[${date} ${m.time}] ${m.is_mine ? '我' : entry.display_name}：${m.content}`);
          }
        }
      }
    }
    for (const entry of groups) {
      const msgs = await calendarApi.getGroupMessages(date, entry.username).catch(() => []);
      if (msgs && msgs.length > 0) {
        allLines.push(`\n=== 群聊「${entry.display_name}」===`);
        for (const m of msgs) {
          if (!m.content.startsWith('[')) {
            allLines.push(`[${date} ${m.time}] ${m.speaker}：${m.content}`);
          }
        }
      }
    }
    return { text: allLines.join('\n'), count: allLines.filter(l => !l.startsWith('\n===')).length };
  };

  const sendMessage = async (text: string) => {
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

    const updateAssistant = (patch: Partial<DayAIMessage>) =>
      setMessages(prev => {
        const next = [...prev];
        if (next[assistantIdx]) next[assistantIdx] = { ...next[assistantIdx], ...patch };
        return next;
      });

    try {
      if (ragMode === 'hybrid') {
        const resp = await fetch('/api/ai/day-rag', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, messages: newMessages.map(m => ({ role: m.role, content: m.content })) }),
          signal: abort.signal,
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({})) as { error?: string };
          throw new Error(err.error ?? resp.statusText);
        }
        const reader = resp.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let accContent = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const chunk = JSON.parse(line.slice(6)) as { delta?: string; done?: boolean; error?: string; rag_meta?: { hits: number; retrieved: number } };
              if (chunk.error) throw new Error(chunk.error);
              if (chunk.rag_meta) setRagInfo(chunk.rag_meta);
              if (chunk.done) break;
              if (chunk.delta) { accContent += chunk.delta; updateAssistant({ content: accContent }); scrollToBottom(); }
            } catch (e) { if (!(e instanceof SyntaxError)) throw e; }
          }
        }
      } else {
        updateAssistant({ content: '📅 正在加载当天聊天记录…' });
        const { text: ctxText, count } = await loadDayContext();
        if (count === 0) { updateAssistant({ content: '当天暂无文本聊天记录可分析。', streaming: false }); return; }
        updateAssistant({ content: '' });
        const systemPrompt = `你是微信聊天数据分析助手。以下是 ${date} 这一天所有的聊天记录（包含私聊和群聊）：\n\n${ctxText}\n\n请基于以上聊天记录回答用户的问题。`;
        const resp = await fetch('/api/ai/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: '', is_group: false, from: 0, to: 0,
            messages: [{ role: 'system', content: systemPrompt }, ...newMessages.map(m => ({ role: m.role, content: m.content }))],
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
        let accContent = '';
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
              if (chunk.delta) { accContent += chunk.delta; updateAssistant({ content: accContent }); scrollToBottom(); }
            } catch (e) { if (!(e instanceof SyntaxError)) throw e; }
          }
        }
      }
    } catch (e: unknown) {
      if ((e as { name?: string }).name === 'AbortError') return;
      updateAssistant({ content: `❌ ${e instanceof Error ? e.message : '请求失败'}`, streaming: false });
    } finally {
      updateAssistant({ streaming: false });
      setLoading(false);
      scrollToBottom();
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b dark:border-white/10 flex-shrink-0">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
          <ChevronLeft size={16} className="text-gray-500" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="font-black text-sm text-[#1d1d1f] dark:text-white truncate">{date} · AI 分析</div>
          <div className="text-[10px] text-gray-400">{contacts.length} 私聊 · {groups.length} 群聊</div>
        </div>
        <div className="flex rounded-lg border border-gray-200 dark:border-white/10 overflow-hidden flex-shrink-0">
          <button onClick={() => setRagMode('full')}
            className={`px-2 py-1 text-[10px] font-bold transition-colors ${ragMode === 'full' ? 'bg-[#07c160] text-white' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}>
            全量
          </button>
          <button onClick={() => setRagMode('hybrid')}
            className={`px-2 py-1 text-[10px] font-bold transition-colors ${ragMode === 'hybrid' ? 'bg-[#576b95] text-white' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}>
            检索
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="space-y-3">
            <div className="text-[11px] text-gray-400 text-center pt-2">
              {ragMode === 'full' ? '全量分析：加载当天所有聊天记录' : '混合检索：从已建索引的对话中检索'}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DAY_PRESETS.map(p => (
                <button key={p.label} onClick={() => sendMessage(p.prompt)}
                  className="px-2.5 py-1 rounded-full border border-[#07c160] text-[#07c160] text-[11px] font-semibold hover:bg-[#07c160] hover:text-white transition-colors">
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {ragInfo && ragMode === 'hybrid' && (
          <div className="text-[10px] text-[#576b95] bg-[#576b95]/5 rounded-lg px-3 py-1.5">
            检索到 {ragInfo.hits} 条相关消息（含上下文共 {ragInfo.retrieved} 条）
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-white mt-0.5 ${msg.role === 'user' ? 'bg-[#07c160] text-[10px] font-black' : 'bg-[#576b95]'}`}>
              {msg.role === 'user' ? '我' : <Bot size={12} />}
            </div>
            <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${msg.role === 'user' ? 'bg-[#07c160] text-white rounded-br-sm' : 'bg-gray-100 dark:bg-white/10 text-gray-800 dark:text-gray-200 rounded-bl-sm'}`}>
              {msg.content
                ? msg.content
                : msg.streaming
                  ? <span className="flex items-center gap-1.5 text-gray-400 text-xs"><Loader2 size={12} className="animate-spin text-[#576b95]" />分析中…</span>
                  : ''}
            </div>
          </div>
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
            className="flex-1 bg-transparent text-sm resize-none outline-none placeholder:text-gray-400 max-h-20 min-h-[1.25rem]"
          />
          {loading
            ? <button onClick={() => { abortRef.current?.abort(); }} className="p-1.5 rounded-lg bg-red-100 text-red-500 hover:bg-red-200 flex-shrink-0 transition-colors"><Square size={14} /></button>
            : <button onClick={() => sendMessage(input)} disabled={!input.trim()} className="p-1.5 rounded-lg bg-[#07c160] text-white hover:bg-[#06ad56] disabled:opacity-30 flex-shrink-0 transition-colors"><Send size={14} /></button>
          }
        </div>
      </div>
    </div>
  );
};

// ─── 当天详情面板 ──────────────────────────────────────────────────────────────
interface DayPanelProps {
  date: string;
  contacts: CalendarDayEntry[];
  groups: CalendarDayEntry[];
  loading: boolean;
  onClose: () => void;
}

const DayPanel: React.FC<DayPanelProps> = ({ date, contacts, groups, loading, onClose }) => {
  const { privacyMode } = usePrivacyMode();
  const [viewEntry, setViewEntry] = useState<CalendarDayEntry | null>(null);
  const [aiMode, setAiMode] = useState(false);
  useEffect(() => { setViewEntry(null); setAiMode(false); }, [date]);

  const total = contacts.reduce((s, c) => s + c.count, 0) + groups.reduce((s, g) => s + g.count, 0);

  if (viewEntry) return <MessagesView date={date} entry={viewEntry} onBack={() => setViewEntry(null)} />;
  if (aiMode) return <DayAIPanel date={date} contacts={contacts} groups={groups} onBack={() => setAiMode(false)} />;

  const renderEntry = (entry: CalendarDayEntry) => (
    <div key={entry.username}
      className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer transition-colors group"
      onClick={() => setViewEntry(entry)}
    >
      {entry.small_head_url ? (
        <img src={entry.small_head_url} alt="" className="w-9 h-9 rounded-xl object-cover flex-shrink-0"
          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      ) : (
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#07c160] to-[#06ad56] flex items-center justify-center text-white text-sm font-black flex-shrink-0">
          {entry.display_name.charAt(0)}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className={`font-semibold text-sm truncate${privacyMode ? ' privacy-blur' : ''}`}>{entry.display_name}</div>
        <div className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
          {entry.is_group ? <MessagesSquare size={10} /> : <MessageSquare size={10} />}
          {entry.is_group ? '群聊' : '私聊'}
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0 text-[#07c160]">
        <span className="text-sm font-black">{entry.count}</span>
        <span className="text-xs text-gray-400">条</span>
        <ChevronRight size={14} className="text-gray-300 group-hover:text-gray-400" />
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b dark:border-white/10 flex-shrink-0">
        <div>
          <div className="font-black text-base text-[#1d1d1f] dark:text-white">{date}</div>
          <div className="text-xs text-gray-400 mt-0.5">{total.toLocaleString()} 条消息</div>
        </div>
        <div className="flex items-center gap-1">
          {!loading && total > 0 && (
            <button onClick={() => setAiMode(true)}
              className="p-2 rounded-xl text-gray-400 hover:text-[#07c160] hover:bg-[#e7f8f0] dark:hover:bg-[#07c160]/10 transition-colors"
              title="AI 分析">
              <Bot size={16} />
            </button>
          )}
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
            <X size={16} className="text-gray-400" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && <div className="text-center text-gray-300 py-12 animate-pulse text-sm">加载中...</div>}
        {!loading && contacts.length === 0 && groups.length === 0 && (
          <div className="text-center text-gray-300 py-12 text-sm">当天无消息记录</div>
        )}
        {!loading && contacts.length > 0 && (
          <>
            <div className="px-4 py-2 text-[11px] font-bold text-gray-400 flex items-center gap-1.5">
              <Users size={11} /> 私聊 · {contacts.length} 位
            </div>
            {contacts.map(renderEntry)}
          </>
        )}
        {!loading && groups.length > 0 && (
          <>
            <div className="px-4 py-2 text-[11px] font-bold text-gray-400 flex items-center gap-1.5 mt-1">
              <MessagesSquare size={11} /> 群聊 · {groups.length} 个
            </div>
            {groups.map(renderEntry)}
          </>
        )}
      </div>
    </div>
  );
};

// ─── 主页面 ────────────────────────────────────────────────────────────────────
export const ChatCalendarPage: React.FC<Props> = () => {
  const [heatmap, setHeatmap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  // 滚动容器 ref
  const scrollRef = useRef<HTMLDivElement>(null);
  // 当前可见的组索引（每组 3 个月）
  const [currentGroupIdx, setCurrentGroupIdx] = useState(0);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayContacts, setDayContacts] = useState<CalendarDayEntry[]>([]);
  const [dayGroups, setDayGroups] = useState<CalendarDayEntry[]>([]);
  const [dayLoading, setDayLoading] = useState(false);
  const dayFetchRef = useRef(0);

  useEffect(() => {
    setLoading(true);
    calendarApi.getHeatmap()
      .then(h => setHeatmap(h.heatmap || {}))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // 从 heatmap 数据推导所有月份列表（最早月 → 当月）
  const allMonths = useMemo(() => {
    const dates = Object.keys(heatmap).sort();
    if (!dates.length) return [];
    const start = new Date(dates[0].slice(0, 7) + '-01');
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth(), 1);
    const months: { year: number; month: number }[] = [];
    const cur = new Date(start);
    while (cur <= end) {
      months.push({ year: cur.getFullYear(), month: cur.getMonth() });
      cur.setMonth(cur.getMonth() + 1);
    }
    return months;
  }, [heatmap]);

  // 每 3 个月一组
  const monthGroups = useMemo(() => {
    const groups: { year: number; month: number }[][] = [];
    for (let i = 0; i < allMonths.length; i += 3) {
      groups.push(allMonths.slice(i, i + 3));
    }
    return groups;
  }, [allMonths]);

  // 加载完成后滚到最后一组（最新）
  useEffect(() => {
    if (!monthGroups.length) return;
    const lastIdx = monthGroups.length - 1;
    setCurrentGroupIdx(lastIdx);
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollLeft = el.scrollWidth;
    });
  }, [monthGroups.length]);

  // 滚动时更新 currentGroupIdx
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !monthGroups.length) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    setCurrentGroupIdx(Math.max(0, Math.min(idx, monthGroups.length - 1)));
  }, [monthGroups.length]);

  const goPrev = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: el.scrollLeft - el.clientWidth, behavior: 'smooth' });
  };
  const goNext = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: el.scrollLeft + el.clientWidth, behavior: 'smooth' });
  };

  // 当前可见组的月份
  const currentGroup = monthGroups[currentGroupIdx] || [];

  // 当前组日期范围
  const [rangeStart, rangeEnd] = useMemo(() => {
    if (!currentGroup.length) return ['', ''];
    const first = currentGroup[0];
    const last = currentGroup[currentGroup.length - 1];
    const start = `${first.year}-${String(first.month + 1).padStart(2, '0')}-01`;
    const lastDay = daysInMonth(last.year, last.month);
    const end = `${last.year}-${String(last.month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return [start, end];
  }, [currentGroup]);

  // 当前组最大值（颜色归一化用）
  const maxVal = useMemo(() => {
    let max = 1;
    for (const [d, c] of Object.entries(heatmap)) {
      if (d >= rangeStart && d <= rangeEnd && c > max) max = c;
    }
    return max;
  }, [heatmap, rangeStart, rangeEnd]);

  // 折线图数据（当前组所有天）
  const visibleTrend = useMemo(() => {
    if (!rangeStart || !rangeEnd) return [];
    const result: { date: string; count: number }[] = [];
    const cur = new Date(rangeStart);
    const end = new Date(rangeEnd);
    while (cur <= end) {
      const d = isoDate(cur);
      result.push({ date: d, count: heatmap[d] || 0 });
      cur.setDate(cur.getDate() + 1);
    }
    return result;
  }, [heatmap, rangeStart, rangeEnd]);

  const trendLabels = useMemo(() =>
    visibleTrend.filter(p => p.date.endsWith('-01') || p.date.endsWith('-15')).map(p => p.date.slice(5)),
    [visibleTrend]
  );

  const handleDayClick = useCallback((date: string) => {
    setSelectedDate(date);
    setDayLoading(true);
    const ticket = ++dayFetchRef.current;
    calendarApi.getDay(date)
      .then(d => {
        if (ticket !== dayFetchRef.current) return;
        setDayContacts(d.contacts || []);
        setDayGroups(d.groups || []);
      })
      .catch(() => {
        if (ticket !== dayFetchRef.current) return;
        setDayContacts([]);
        setDayGroups([]);
      })
      .finally(() => {
        if (ticket !== dayFetchRef.current) return;
        setDayLoading(false);
      });
  }, []);

  // 标题标签
  const navLabel = useMemo(() => {
    if (!currentGroup.length) return '';
    const first = currentGroup[0];
    const last = currentGroup[currentGroup.length - 1];
    if (first.year === last.year) {
      return `${first.year}年 ${MONTH_NAMES[first.month]} — ${MONTH_NAMES[last.month]}`;
    }
    return `${first.year}年${MONTH_NAMES[first.month]} — ${last.year}年${MONTH_NAMES[last.month]}`;
  }, [currentGroup]);

  return (
    <div className="flex gap-0 h-[calc(100vh-6rem)] -mx-4 sm:-mx-10">
      {/* ── 左栏 ─────────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-5 overflow-y-auto px-4 sm:px-10 py-6 flex-1">
        <div>
          <h1 className="dk-text text-3xl sm:text-5xl font-black tracking-tight text-[#1d1d1f] mb-1">时光机</h1>
          <p className="text-gray-400 text-sm">聊天足迹，点击日期查看当天记录</p>
        </div>

        {/* 日历卡片 */}
        <div className="dk-card bg-white dark:bg-[#1c1c1e] border border-gray-100 dark:border-white/10 rounded-3xl p-5 shadow-sm">
          {/* 导航栏 */}
          <div className="flex items-center justify-between mb-4">
            <button onClick={goPrev} disabled={currentGroupIdx === 0}
              className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 transition-colors disabled:opacity-20">
              <ChevronLeft size={18} className="text-gray-500" />
            </button>
            <div className="flex items-center gap-2">
              <Hourglass size={15} className="text-[#07c160]" strokeWidth={2.5} />
              <span className="font-black text-base text-[#1d1d1f] dark:text-white">{navLabel}</span>
            </div>
            <button onClick={goNext} disabled={currentGroupIdx >= monthGroups.length - 1}
              className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 transition-colors disabled:opacity-20">
              <ChevronRight size={18} className="text-gray-500" />
            </button>
          </div>

          {loading ? (
            <div className="h-40 flex items-center justify-center text-gray-300 animate-pulse text-sm">加载中...</div>
          ) : (
            /* 横向滚动容器：每组占满宽度，scroll-snap 每组对齐 */
            <div
              ref={scrollRef}
              className="overflow-x-auto"
              style={{ scrollSnapType: 'x mandatory', scrollBehavior: 'smooth', WebkitOverflowScrolling: 'touch' }}
              onScroll={handleScroll}
            >
              <div className="flex" style={{ width: `${monthGroups.length * 100}%` }}>
                {monthGroups.map((group, gi) => (
                  <div
                    key={gi}
                    className="flex gap-4 px-1"
                    style={{ width: `${100 / monthGroups.length}%`, scrollSnapAlign: 'start', flexShrink: 0 }}
                  >
                    {group.map(({ year, month }) => (
                      <MonthGrid
                        key={`${year}-${month}`}
                        year={year} month={month}
                        heatmap={heatmap} maxVal={maxVal}
                        selectedDate={selectedDate}
                        onDayClick={handleDayClick}
                      />
                    ))}
                    {/* 补齐不足 3 个月的空位 */}
                    {group.length < 3 && Array.from({ length: 3 - group.length }).map((_, k) => (
                      <div key={`empty-${k}`} className="flex-1" />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 图例 + 页码点 */}
          <div className="flex items-center justify-between mt-4">
            <div className="flex gap-1">
              {monthGroups.map((_, i) => (
                <button
                  key={i}
                  onClick={() => scrollRef.current?.scrollTo({ left: i * (scrollRef.current.clientWidth), behavior: 'smooth' })}
                  className={`rounded-full transition-all duration-200 ${i === currentGroupIdx ? 'w-4 h-1.5 bg-[#07c160]' : 'w-1.5 h-1.5 bg-gray-200 dark:bg-white/20'}`}
                />
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-400">少</span>
              {HEAT_COLORS.map(c => <div key={c} className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: c }} />)}
              <span className="text-[10px] text-gray-400">多</span>
            </div>
          </div>
        </div>

        {/* 折线图 */}
        <div className="dk-card bg-white dark:bg-[#1c1c1e] border border-gray-100 dark:border-white/10 rounded-3xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Hourglass size={14} className="text-[#07c160]" strokeWidth={2.5} />
            <span className="font-black text-sm text-[#1d1d1f] dark:text-white">消息趋势</span>
            <span className="text-gray-400 text-xs">{navLabel}</span>
          </div>
          {loading ? (
            <div className="h-28 flex items-center justify-center text-gray-300 animate-pulse text-sm">加载中...</div>
          ) : (
            <ResponsiveContainer width="100%" height={120}>
              <AreaChart data={visibleTrend} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
                onClick={e => { if (e?.activePayload?.[0]) handleDayClick((e.activePayload[0].payload as { date: string }).date); }}>
                <defs>
                  <linearGradient id="calGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#07c160" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#07c160" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="date" tickFormatter={v => v.slice(5)} ticks={trendLabels}
                  tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<TrendTooltip />} />
                <Area type="monotone" dataKey="count" stroke="#07c160" strokeWidth={2}
                  fill="url(#calGrad)" dot={false} activeDot={{ r: 4, fill: '#07c160', cursor: 'pointer' }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── 右侧面板 ─────────────────────────────────────────────────────────── */}
      {selectedDate && (
        <div className="border-l dark:border-white/10 bg-white dark:bg-[#1c1c1e] overflow-hidden flex flex-col w-80 flex-shrink-0">
          <DayPanel
            date={selectedDate}
            contacts={dayContacts}
            groups={dayGroups}
            loading={dayLoading}
            onClose={() => setSelectedDate(null)}
          />
        </div>
      )}
    </div>
  );
};
