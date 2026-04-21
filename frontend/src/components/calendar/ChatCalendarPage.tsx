/**
 * 时光机 — 聊天日历
 *
 * 三种视图由用户切换：
 *   - QuarterlyView（季度，3 月滚动）默认
 *   - MonthView（单月大图）
 *   - YearView（年贡献图）
 * 视图偏好写 localStorage（welink_calendar_view）。
 *
 * 主文件只负责：拉 heatmap / 管 selectedDate / 去年今天回忆 / 右侧面板 / 折线图。
 * 日历展示逻辑拆到 QuarterlyView / MonthView / YearView 三个文件。
 */

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  Hourglass, MessageSquare, ChevronLeft, ChevronRight, X, Users, MessagesSquare,
  Bot, Sparkles, CalendarDays, CalendarRange, LayoutGrid, GitCommitHorizontal,
  type LucideIcon,
} from 'lucide-react';
import { calendarApi } from '../../services/api';
import type { CalendarDayEntry, ContactStats, ChatMessage, GroupChatMessage } from '../../types';
import { Section } from '../common/Section';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';
import { avatarSrc } from '../../utils/avatar';
import { DayAIPanel } from './DayAIPanel';
import { QuarterlyView } from './QuarterlyView';
import { MonthView } from './MonthView';
import { YearView } from './YearView';
import { TimelineViewMode } from './TimelineViewMode';
import {
  HEAT_COLORS_DISPLAY, EMPTY_CELL_CLASS,
  isoDate,
  PANEL_MIN_WIDTH, PANEL_MAX_WIDTH, PANEL_DEFAULT_WIDTH, isNarrowViewport,
  loadCalendarView, saveCalendarView,
  type CalendarViewType, type CalendarViewRange,
} from './calendarUtils';

interface Props {
  contacts: ContactStats[];
  onContactClick?: (contact: ContactStats) => void;
  onOpenSettings?: () => void;
}

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
    let alive = true;
    setLoading(true);
    setMsgs([]);
    const fn = entry.is_group
      ? calendarApi.getGroupMessages(date, entry.username)
      : calendarApi.getContactMessages(date, entry.username);
    fn.then(d => { if (alive) setMsgs(d || []); })
      .catch(() => { if (alive) setMsgs([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [date, entry.username, entry.is_group]);

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
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {entry.small_head_url ? (
            <img loading="lazy" src={avatarSrc(entry.small_head_url)} alt="" className="w-7 h-7 rounded-lg object-cover flex-shrink-0"
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
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2" aria-busy={loading}>
        {loading && <div className="text-center text-gray-300 py-8 animate-pulse text-sm">加载中...</div>}
        {!loading && msgs.length === 0 && <div className="text-center text-gray-300 py-8 text-sm">暂无消息</div>}
        {msgs.map((m, i) => {
          const isMine = 'is_mine' in m ? m.is_mine : false;
          const speaker = 'speaker' in m ? (m as GroupChatMessage).speaker : (isMine ? '我' : entry.display_name);
          const key = `${m.time || ''}-${i}`;
          return (
            <div key={key} className={`flex gap-2 ${isMine ? 'flex-row-reverse' : ''}`}>
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

// ─── 当天详情面板 ──────────────────────────────────────────────────────────────

interface DayPanelProps {
  date: string;
  contacts: CalendarDayEntry[];
  groups: CalendarDayEntry[];
  loading: boolean;
  onClose: () => void;
  onOpenSettings?: () => void;
}

const DayPanel: React.FC<DayPanelProps> = ({ date, contacts, groups, loading, onClose, onOpenSettings }) => {
  const { privacyMode } = usePrivacyMode();
  const [viewEntry, setViewEntry] = useState<CalendarDayEntry | null>(null);
  const [aiMode, setAiMode] = useState(false);
  useEffect(() => { setViewEntry(null); setAiMode(false); }, [date]);

  const total = contacts.reduce((s, c) => s + c.count, 0) + groups.reduce((s, g) => s + g.count, 0);

  if (viewEntry) return <MessagesView date={date} entry={viewEntry} onBack={() => setViewEntry(null)} />;
  if (aiMode) return <DayAIPanel date={date} contacts={contacts} groups={groups} onBack={() => setAiMode(false)} onOpenSettings={onOpenSettings} />;

  const renderEntry = (entry: CalendarDayEntry) => (
    <button
      key={`${entry.is_group ? 'g' : 'c'}-${entry.username}`}
      type="button"
      onClick={() => setViewEntry(entry)}
      aria-label={`${entry.display_name}，${entry.is_group ? '群聊' : '私聊'}，${entry.count} 条`}
      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-white/5 transition-colors group focus:outline-none focus-visible:bg-gray-50 dark:focus-visible:bg-white/5"
    >
      {entry.small_head_url ? (
        <img loading="lazy" src={avatarSrc(entry.small_head_url)} alt="" className="w-9 h-9 rounded-xl object-cover flex-shrink-0"
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
    </button>
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
            <button
              type="button"
              onClick={() => setAiMode(true)}
              aria-label="AI 分析"
              className="p-2 rounded-xl text-gray-400 hover:text-[#07c160] hover:bg-[#e7f8f0] dark:hover:bg-[#07c160]/10 transition-colors"
              title="AI 分析"
            >
              <Bot size={16} />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
          >
            <X size={16} className="text-gray-400" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto" aria-busy={loading}>
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

// ─── 视图切换器 ───────────────────────────────────────────────────────────────

const VIEW_OPTIONS: { value: CalendarViewType; label: string; Icon: LucideIcon }[] = [
  { value: 'quarter', label: '季度', Icon: CalendarRange },
  { value: 'month', label: '单月', Icon: CalendarDays },
  { value: 'year', label: '年度', Icon: LayoutGrid },
  { value: 'timeline', label: '时间线', Icon: GitCommitHorizontal },
];

const ViewSwitcher: React.FC<{ value: CalendarViewType; onChange: (v: CalendarViewType) => void }> = ({ value, onChange }) => (
  <div
    className="inline-flex rounded-xl border border-gray-200 dark:border-white/10 overflow-hidden bg-white dark:bg-[#1c1c1e] shadow-sm"
    role="radiogroup"
    aria-label="日历视图切换"
  >
    {VIEW_OPTIONS.map(({ value: v, label, Icon }) => (
      <button
        key={v}
        type="button"
        role="radio"
        aria-checked={value === v}
        onClick={() => onChange(v)}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#07c160] focus-visible:ring-inset ${
          value === v
            ? 'bg-[#07c160] text-white'
            : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5'
        }`}
      >
        <Icon size={12} />
        {label}
      </button>
    ))}
  </div>
);

// ─── 主页面 ────────────────────────────────────────────────────────────────────

export const ChatCalendarPage: React.FC<Props> = ({ contacts, onContactClick, onOpenSettings }) => {
  const [heatmap, setHeatmap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const [view, setView] = useState<CalendarViewType>(loadCalendarView);
  const handleViewChange = useCallback((v: CalendarViewType) => {
    setView(v);
    saveCalendarView(v);
  }, []);

  // 当前视图对应的范围（由子视图 onRangeChange 上报）
  const [range, setRange] = useState<CalendarViewRange>({ label: '', from: '', to: '' });
  const handleRangeChange = useCallback((r: CalendarViewRange) => setRange(r), []);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayContacts, setDayContacts] = useState<CalendarDayEntry[]>([]);
  const [dayGroups, setDayGroups] = useState<CalendarDayEntry[]>([]);
  const [dayLoading, setDayLoading] = useState(false);
  const dayFetchRef = useRef(0);

  // 右侧面板宽度
  const [panelWidth, setPanelWidth] = useState(() =>
    isNarrowViewport() ? Math.round(window.innerWidth * 0.9) : PANEL_DEFAULT_WIDTH,
  );
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const onResize = () => {
      const maxForViewport = Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, window.innerWidth - 120));
      setPanelWidth(prev => Math.min(prev, maxForViewport));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: panelWidth };
    const maxForViewport = Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, window.innerWidth - 120));
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startX - ev.clientX;
      const next = Math.min(maxForViewport, Math.max(PANEL_MIN_WIDTH, dragRef.current.startWidth + delta));
      setPanelWidth(next);
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    calendarApi.getHeatmap()
      .then(h => { if (alive) setHeatmap(h.heatmap || {}); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  // 折线图数据：根据当前视图的范围切片
  const visibleTrend = useMemo(() => {
    if (!range.from || !range.to) return [];
    const result: { date: string; count: number }[] = [];
    const cur = new Date(range.from);
    const end = new Date(range.to);
    while (cur <= end) {
      const d = isoDate(cur);
      result.push({ date: d, count: heatmap[d] || 0 });
      cur.setDate(cur.getDate() + 1);
    }
    return result;
  }, [heatmap, range]);

  // X 轴 tick：每月 1 号和 15 号（密度足够又不重叠）
  const trendLabels = useMemo(
    () => visibleTrend.filter(p => p.date.endsWith('-01') || p.date.endsWith('-15')).map(p => p.date.slice(5)),
    [visibleTrend],
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

  // 去年今天 / N 年前
  const memories = useMemo(() => {
    const today = new Date();
    const result: { year: number; date: string; count: number }[] = [];
    for (let y = 1; y <= 5; y++) {
      const d = new Date(today.getFullYear() - y, today.getMonth(), today.getDate());
      const ds = isoDate(d);
      const c = heatmap[ds] ?? 0;
      if (c > 0) result.push({ year: y, date: ds, count: c });
    }
    return result;
  }, [heatmap]);

  // 当前视图组件（时间线模式单独处理，因为它吃 contacts 而不是 heatmap）
  const HeatmapView = useMemo(() => {
    switch (view) {
      case 'month': return MonthView;
      case 'year': return YearView;
      default: return QuarterlyView;
    }
  }, [view]);

  const isTimeline = view === 'timeline';
  const subtitle = isTimeline
    ? '你是什么时候认识每个人的'
    : '聊天足迹，点击日期查看当天记录';

  return (
    <div className="flex gap-0 h-[calc(100vh-6rem)] -mx-4 sm:-mx-10">
      {/* ── 左栏 ─────────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-5 overflow-y-auto px-4 sm:px-10 py-6 flex-1 min-w-0">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h1 className="dk-text text-3xl sm:text-5xl font-black tracking-tight text-[#1d1d1f] mb-1">时光机</h1>
            <p className="text-gray-400 text-sm">{subtitle}</p>
          </div>
          <ViewSwitcher value={view} onChange={handleViewChange} />
        </div>

        {memories.length > 0 && !isTimeline && (
          <div className="w-full dk-card bg-gradient-to-r from-[#f0faf4] to-[#e7f8f0] dark:from-[#07c160]/10 dark:to-[#07c160]/5
            border border-[#07c160]/20 rounded-2xl px-5 py-3">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-9 h-9 rounded-xl bg-[#07c160] flex items-center justify-center flex-shrink-0">
                <Sparkles size={16} className="text-white" />
              </div>
              <div className="text-sm font-bold text-[#1d1d1f] dk-text">
                {memories.length === 1
                  ? `${memories[0].year} 年前的今天`
                  : `回忆：${memories.map(m => `${m.year}年前`).join('、')}的今天`}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 ml-12">
              {memories.map(m => (
                <button
                  key={m.date}
                  type="button"
                  onClick={() => handleDayClick(m.date)}
                  aria-label={`跳到 ${m.date}，${m.count} 条`}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold
                    bg-white/70 dark:bg-white/10 text-[#07c160] hover:bg-white hover:shadow-sm transition-all"
                >
                  <span>{m.date}</span>
                  <span className="text-gray-400 font-normal">{m.count} 条</span>
                  <ChevronRight size={12} />
                </button>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div className="dk-card bg-white dark:bg-[#1c1c1e] border border-gray-100 dark:border-white/10 rounded-3xl p-5 shadow-sm h-40 flex items-center justify-center text-gray-300 animate-pulse text-sm">
            加载中...
          </div>
        ) : isTimeline ? (
          <TimelineViewMode contacts={contacts} onContactClick={onContactClick} />
        ) : (
          <HeatmapView
            heatmap={heatmap}
            selectedDate={selectedDate}
            onDayClick={handleDayClick}
            onRangeChange={handleRangeChange}
          />
        )}

        {/* 色阶图例 + 折线图：只在热图视图下有意义，时间线模式隐藏 */}
        {!loading && !isTimeline && (
          <>
            <div className="flex items-center justify-end gap-1.5" aria-label="颜色图例">
              <span className="text-[10px] text-gray-400">少</span>
              {HEAT_COLORS_DISPLAY.map((c, idx) => (
                idx === 0
                  ? <div key="empty-chip" className={`w-2.5 h-2.5 rounded-sm ${EMPTY_CELL_CLASS}`} />
                  : <div key={c} className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: c }} />
              ))}
              <span className="text-[10px] text-gray-400">多</span>
            </div>

            <Section
              title="消息趋势"
              subtitle={range.label}
              icon={<Hourglass size={14} strokeWidth={2.5} />}
              defaultOpen={false}
              className="bg-white dark:bg-[#1c1c1e] border border-gray-100 dark:border-white/10 !rounded-3xl"
            >
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
            </Section>
          </>
        )}
      </div>

      {/* ── 右侧面板 ─────────────────────────────────────────────────────────── */}
      {selectedDate && (
        <div
          className="border-l dark:border-white/10 bg-white dark:bg-[#1c1c1e] overflow-hidden flex flex-col flex-shrink-0 relative"
          style={{ width: panelWidth, maxWidth: '100vw' }}
        >
          <div
            className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[#07c160]/40 active:bg-[#07c160]/60 z-10 hidden sm:block"
            onMouseDown={handleDragStart}
            role="separator"
            aria-orientation="vertical"
            aria-label="拖动调整面板宽度"
          />
          <DayPanel
            date={selectedDate}
            contacts={dayContacts}
            groups={dayGroups}
            loading={dayLoading}
            onClose={() => setSelectedDate(null)}
            onOpenSettings={onOpenSettings}
          />
        </div>
      )}
    </div>
  );
};
