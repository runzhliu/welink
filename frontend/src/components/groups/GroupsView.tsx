/**
 * 群聊画像视图
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Users, MessageSquare, MessageCircle, Clock, ChevronRight, ChevronUp, ChevronDown, Loader2, X, BarChart2, EyeOff, Search, Download, Bot, TrendingUp, Flame, Calendar, Crown, Maximize2, Minimize2, Sparkles, Heart, BookOpen, Zap } from 'lucide-react';
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { GroupInfo, GroupDetail, ContactStats, GroupChatMessage } from '../../types';
import { SearchContextModal, type SearchContextTarget } from '../search/SearchContextModal';
import { groupsApi } from '../../services/api';
import { exportGroupCsv, exportGroupTxt, EXPORT_LIMIT, parseExportResult } from '../../utils/exportChat';
import { CalendarHeatmap } from '../contact/CalendarHeatmap';
import { GroupDayChatPanel } from './GroupDayChatPanel';
import { GroupChatReplay } from './GroupChatReplay';
import { ClockFingerprint } from './ClockFingerprint';
import { GroupYearReviewModal } from './GroupYearReviewModal';
import { getGroupPersonaTags, toneClasses } from '../../utils/groupPersona';
import { Section } from '../common/Section';
import { MessageTypePieChart } from '../common/MessageTypePieChart';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';
import { RelationshipGraphPanel } from './RelationshipGraphPanel';
import {
  MEMBER_RANK_LIMIT_KEY, MEMBER_NAME_WIDTH_KEY,
  DEFAULT_RANK_LIMIT, DEFAULT_NAME_WIDTH,
} from '../common/SettingsPage';
import { LLMAnalysisTab } from '../contact/LLMAnalysisTab';
import { GroupSimChat } from './GroupSimChat';
import { RelativeTime } from '../common/RelativeTime';
import { GroupComparePanel } from './GroupComparePanel';
import { ForgeSkillModal } from '../contact/ForgeSkillModal';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { AIAnalysisBadge } from '../dashboard/ContactTable';
import { avatarSrc } from '../../utils/avatar';

// ─── 群详情弹窗 ───────────────────────────────────────────────────────────────

// 后端 weekly_dist[0]=周日, ...[6]=周六；显示改为周一~周日
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEK_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const MEMBER_COLORS = ['#07c160', '#10aeff', '#ff9500', '#fa5151', '#576b95', '#40c463'];

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function shiftDays(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return isoDate(d); }
function shiftMonths(n: number) { const d = new Date(); d.setMonth(d.getMonth() - n); return isoDate(d); }
const _today = isoDate(new Date());
const exportPresets = [
  { label: '最近一天', from: _today,           to: _today },
  { label: '最近一周', from: shiftDays(6),     to: _today },
  { label: '最近一月', from: shiftMonths(1),   to: _today },
  { label: '最近一年', from: shiftMonths(12),  to: _today },
];

interface GroupDetailModalProps {
  group: GroupInfo;
  onClose: () => void;
  allContacts: ContactStats[];
  onContactClick: (c: ContactStats) => void;
  onBlock?: (username: string) => void;
  onOpenSettings?: () => void;
}

export const GroupDetailModal: React.FC<GroupDetailModalProps> = ({ group, onClose, allContacts, onContactClick, onBlock, onOpenSettings }) => {
  const { privacyMode } = usePrivacyMode();

  // 根据显示名（remark/nickname）查找联系人
  const findContact = (displayName: string): ContactStats | null => {
    return allContacts.find(c =>
      (c.remark && c.remark === displayName) ||
      (c.nickname && c.nickname === displayName) ||
      c.username === displayName
    ) ?? null;
  };
  const [tab, setTab] = useState<'portrait' | 'search' | 'ai' | 'relationships' | 'sim' | 'replay'>('portrait');
  const [showYearReview, setShowYearReview] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [forgeOpen, setForgeOpen] = useState(false);
  const [blockConfirmOpen, setBlockConfirmOpen] = useState(false);
  const [memberSort, setMemberSort] = useState<'count' | 'last' | 'name'>('count');
  const [memberSortAsc, setMemberSortAsc] = useState(false);
  const toggleSort = (key: 'count' | 'last' | 'name') => {
    if (memberSort === key) { setMemberSortAsc(!memberSortAsc); }
    else { setMemberSort(key); setMemberSortAsc(false); }
  };
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [dayPanel, setDayPanel] = useState<{ date: string; count: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchSpeaker, setSearchSpeaker] = useState('');
  const [searchResults, setSearchResults] = useState<GroupChatMessage[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchDone, setSearchDone] = useState(false);
  const [contextTarget, setContextTarget] = useState<SearchContextTarget | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const [showExportPanel, setShowExportPanel] = useState(false);
  const [exportMsg, setExportMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const exportPanelRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 点击外部关闭导出面板
  useEffect(() => {
    if (!showExportPanel) return;
    const handler = (e: MouseEvent) => {
      if (exportPanelRef.current && !exportPanelRef.current.contains(e.target as Node)) {
        setShowExportPanel(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showExportPanel]);

  const handleExport = useCallback(async (format: 'csv' | 'txt') => {
    setExporting(true);
    setExportMsg(null);
    try {
      const from = exportFrom ? Math.floor(new Date(exportFrom).getTime() / 1000) : undefined;
      const to = exportTo ? Math.floor(new Date(exportTo + 'T23:59:59').getTime() / 1000) : undefined;
      const msgs = await groupsApi.exportMessages(group.username, from, to) ?? [];
      if (msgs.length === 0) {
        setExportMsg({ ok: false, message: '该时间范围内没有消息记录' });
        setTimeout(() => setExportMsg(null), 4000);
        return;
      }
      const result = format === 'csv'
        ? await exportGroupCsv(msgs, group.name, exportFrom || undefined, exportTo || undefined)
        : await exportGroupTxt(msgs, group.name, exportFrom || undefined, exportTo || undefined);
      const parsed = parseExportResult(result);
      if (parsed.ok && msgs.length >= EXPORT_LIMIT) {
        parsed.message += `（超出限制，仅含最近 ${EXPORT_LIMIT.toLocaleString()} 条）`;
      }
      setExportMsg(parsed);
      setTimeout(() => setExportMsg(null), 4000);
    } finally {
      setExporting(false);
    }
  }, [group, exportFrom, exportTo]);

  // 排行榜显示设置（从 localStorage 读取，与设置页同步）
  const [rankLimit, setRankLimit] = useState<number>(() =>
    Number(localStorage.getItem(MEMBER_RANK_LIMIT_KEY)) || DEFAULT_RANK_LIMIT
  );
  const [nameWidth, setNameWidth] = useState<number>(() =>
    Number(localStorage.getItem(MEMBER_NAME_WIDTH_KEY)) || DEFAULT_NAME_WIDTH
  );

  // 监听 localStorage 变化（设置页修改时同步）
  useEffect(() => {
    const onStorage = () => {
      setRankLimit(Number(localStorage.getItem(MEMBER_RANK_LIMIT_KEY)) || DEFAULT_RANK_LIMIT);
      setNameWidth(Number(localStorage.getItem(MEMBER_NAME_WIDTH_KEY)) || DEFAULT_NAME_WIDTH);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // 名字列拖拽
  const dragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);
  const onDragStart = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = nameWidth;
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const newW = Math.min(400, Math.max(60, dragStartWidth.current + ev.clientX - dragStartX.current));
      setNameWidth(newW);
      localStorage.setItem(MEMBER_NAME_WIDTH_KEY, String(newW));
    };
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [nameWidth]);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      groupsApi.getDetail(group.username).then((d) => {
        if (cancelled) return;
        if (d) {
          setDetail(d);
          setLoading(false);
        } else {
          // 后台还在计算，2秒后重试
          setTimeout(() => { if (!cancelled) poll(); }, 2000);
        }
      }).catch(() => { if (!cancelled) setLoading(false); });
    };
    poll();
    return () => { cancelled = true; };
  }, [group.username]);

  const handleSearch = useCallback(async (q: string, speaker?: string) => {
    if (!q.trim()) return;
    setSearchLoading(true);
    setSearchDone(false);
    try {
      const results = await groupsApi.searchMessages(group.username, q.trim(), speaker || undefined);
      setSearchResults(results ?? []);
      setSearchDone(true);
    } catch (e) {
      console.error('Search failed', e);
    } finally {
      setSearchLoading(false);
    }
  }, [group.username]);

  const hourlyData = detail?.hourly_dist.map((v, h) => ({
    label: `${h.toString().padStart(2, '0')}`,
    value: v,
    isLateNight: h < 5,
  })) ?? [];

  const weeklyData = WEEK_ORDER.map((i, idx) => ({
    label: WEEK_LABELS[idx],
    value: detail?.weekly_dist[i] ?? 0,
  }));

  const sortedMembers = useMemo(() => {
    if (!detail?.member_rank) return [];
    const list = [...detail.member_rank];
    const dir = memberSortAsc ? -1 : 1;
    switch (memberSort) {
      case 'count': list.sort((a, b) => (b.count - a.count) * dir); break;
      case 'last': list.sort((a, b) => (b.last_message_time ?? '').localeCompare(a.last_message_time ?? '') * dir); break;
      case 'name': list.sort((a, b) => a.speaker.localeCompare(b.speaker, 'zh') * dir); break;
    }
    return list;
  }, [detail?.member_rank, memberSort, memberSortAsc]);

  const maxMember = detail?.member_rank?.[0]?.count ?? 1;

  const peakDay = useMemo(() => {
    if (!detail) return null;
    const entries = Object.entries(detail.daily_heatmap);
    if (entries.length === 0) return null;
    return entries.reduce((best, cur) => cur[1] > best[1] ? cur : best);
  }, [detail]);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end sm:items-center justify-center animate-in fade-in duration-200 ${
        fullscreen ? 'bg-white dark:bg-[var(--bg-page)]' : 'bg-[#1d1d1f]/90 backdrop-blur-md sm:p-8'
      }`}
      onClick={fullscreen ? undefined : onClose}
    >
      <div
        className={`dk-card bg-white overflow-hidden shadow-2xl relative transition-all duration-300 ${
          fullscreen
            ? 'w-full h-full rounded-none'
            : 'rounded-t-[32px] sm:rounded-[48px] w-full sm:max-w-5xl max-h-[calc(100dvh-5rem)] sm:max-h-[92vh] animate-in slide-in-from-bottom sm:zoom-in'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
      <div className={`overflow-y-auto ${fullscreen ? 'h-full' : 'max-h-[calc(100dvh-5rem)] sm:max-h-[92vh]'}`}>
        {/* 固定顶部区域（不随内容滚动的视觉效果，通过 sticky 实现） */}
        <div className="sticky top-0 z-10 bg-white dark:bg-[var(--bg-card)] px-4 sm:px-8 lg:px-10 pt-4 sm:pt-6">
        <div className="absolute top-4 right-4 sm:top-6 sm:right-8 flex items-center gap-2">
          {/* 导出 */}
          <div className="relative" ref={exportPanelRef}>
            <button
              disabled={exporting}
              onClick={() => setShowExportPanel(v => !v)}
              className={`p-2 rounded-xl transition-colors duration-200 disabled:opacity-40 ${showExportPanel ? 'text-[#07c160] bg-[#e7f8f0] dark:bg-[#07c160]/15' : 'text-gray-300 hover:text-[#07c160] hover:bg-[#e7f8f0] dark:hover:bg-[#07c160]/15'}`}
              title="导出聊天记录"
            >
              {exporting ? <Loader2 size={20} className="animate-spin" /> : <Download size={20} strokeWidth={2} />}
            </button>
            {showExportPanel && (
              <div className="absolute right-0 top-full mt-1 flex flex-col dk-card bg-white dk-border border border-gray-100 rounded-2xl shadow-lg z-10 w-56 p-3 gap-2">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">日期范围（可选）</p>
                <div className="flex flex-wrap gap-1">
                  {exportPresets.map(p => (
                    <button
                      key={p.label}
                      onClick={() => { setExportFrom(p.from); setExportTo(p.to); }}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors
                        ${exportFrom === p.from && exportTo === p.to
                          ? 'bg-[#07c160] text-white border-[#07c160]'
                          : 'text-gray-500 dark:text-gray-400 border-gray-200 hover:border-[#07c160] hover:text-[#07c160]'}`}
                    >{p.label}</button>
                  ))}
                </div>
                <input
                  type="date" value={exportFrom} onChange={e => setExportFrom(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-[#07c160] dk-input dk-border"
                />
                <input
                  type="date" value={exportTo} onChange={e => setExportTo(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-[#07c160] dk-input dk-border"
                />
                <div className="flex gap-1 mt-1">
                  <button onClick={() => handleExport('csv')} disabled={exporting} className="flex-1 px-2 py-2 text-xs text-center text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-white/5 hover:bg-[#f0faf4] dark:hover:bg-[#07c160]/10 hover:text-[#07c160] rounded-xl transition-colors font-medium disabled:opacity-40">CSV</button>
                  <button onClick={() => handleExport('txt')} disabled={exporting} className="flex-1 px-2 py-2 text-xs text-center text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-white/5 hover:bg-[#f0faf4] dark:hover:bg-[#07c160]/10 hover:text-[#07c160] rounded-xl transition-colors font-medium disabled:opacity-40">TXT</button>
                </div>
                {exportMsg && (
                  <p className={`text-[10px] mt-1.5 leading-tight ${exportMsg.ok ? 'text-[#07c160]' : 'text-red-500'}`}>
                    {exportMsg.ok ? '✓ ' : '✕ '}{exportMsg.message}
                  </p>
                )}
              </div>
            )}
          </div>
          <button
            onClick={() => setForgeOpen(true)}
            className="p-2 rounded-xl text-gray-300 hover:text-[#8b5cf6] hover:bg-[#8b5cf6]/10 transition-colors duration-200"
            title="炼化群为 Skill（导出给 Claude Code / Codex / Cursor 等工具使用）"
          >
            <Sparkles size={20} strokeWidth={2} />
          </button>
          <button
            onClick={() => setFullscreen(v => !v)}
            className="p-2 rounded-xl text-gray-300 hover:text-[#07c160] hover:bg-[#e7f8f0] dark:hover:bg-[#07c160]/15 transition-colors duration-200"
            title={fullscreen ? '退出全屏' : '全屏'}
          >
            {fullscreen ? <Minimize2 size={20} strokeWidth={2} /> : <Maximize2 size={20} strokeWidth={2} />}
          </button>
          {onBlock && (
            <button
              onClick={() => setBlockConfirmOpen(true)}
              className="p-2 rounded-xl text-gray-300 hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors duration-200"
              title="屏蔽该群聊"
            >
              <EyeOff size={20} strokeWidth={2} />
            </button>
          )}
          <button onClick={onClose} className="text-gray-300 hover:text-gray-700 dark:hover:text-gray-200">
            <X size={28} strokeWidth={2} />
          </button>
        </div>

        {/* Header */}
        <div className="flex items-center gap-4 mb-6 pr-10">
          {group.small_head_url ? (
            <img loading="lazy" src={avatarSrc(group.small_head_url)} alt="" className="w-14 h-14 rounded-2xl object-cover flex-shrink-0"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          ) : (
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#10aeff] to-[#0e8dd6] flex items-center justify-center text-white flex-shrink-0">
              <Users size={26} strokeWidth={2} />
            </div>
          )}
          <div>
            <h3 className={`dk-text text-2xl sm:text-3xl font-black text-[#1d1d1f]${privacyMode ? ' privacy-blur' : ''}`}>{group.name}</h3>
            <p className="text-xs text-gray-400 mt-1 flex flex-wrap items-center gap-1.5">
              <span>{group.total_messages.toLocaleString()} 条消息</span>
              {(group.first_message_ts || group.first_message_time) && (
                <>
                  <span className="text-gray-300">·</span>
                  <span>始于 <RelativeTime ts={group.first_message_ts} placeholder={group.first_message_time || '-'} /></span>
                </>
              )}
              <span className="text-gray-300">·</span>
              <span>最近 <RelativeTime ts={group.last_message_ts} placeholder={group.last_message_time || '-'} /></span>
            </p>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-2 border-b border-gray-100 dk-border">
          {(['portrait', 'relationships', 'search', 'replay', 'ai', 'sim'] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                if (t === 'search') setTimeout(() => searchInputRef.current?.focus(), 50);
              }}
              className={`flex items-center gap-1 px-5 py-2 rounded-t-xl text-sm font-bold transition border-b-2 -mb-px ${
                tab === t ? 'text-[#07c160] border-[#07c160]' : 'text-gray-400 border-transparent hover:text-gray-600 dark:hover:text-gray-200'
              }`}
            >
              {t === 'ai' && <Bot size={13} className="flex-shrink-0" />}
              {t === 'sim' && <Users size={13} className="flex-shrink-0" />}
              {t === 'portrait' ? '群聊画像' : t === 'relationships' ? '人物关系' : t === 'search' ? '搜索记录' : t === 'replay' ? '回放' : t === 'sim' ? 'AI 群聊' : 'AI 分析'}
              {t === 'ai' && <AIAnalysisBadge username={group.username} isGroup={true} />}
            </button>
          ))}
        </div>
        </div>{/* end sticky header */}

        <div className="px-4 sm:px-8 lg:px-10 pb-4 sm:pb-8 pt-4">
        {tab === 'relationships' && (
          <RelationshipGraphPanel username={group.username} />
        )}

        {tab === 'ai' && (
          <LLMAnalysisTab
            username={group.username}
            displayName={group.name}
            isGroup={true}
            totalMessages={group.total_messages}
            onOpenSettings={onOpenSettings}
          />
        )}

        {tab === 'replay' && (
          <GroupChatReplay username={group.username} groupName={group.name} />
        )}

        {tab === 'sim' && (
          <GroupSimChat group={group} onOpenSettings={onOpenSettings} />
        )}

        {tab === 'search' && (
          <div>
            <form onSubmit={(e) => { e.preventDefault(); handleSearch(searchQuery, searchSpeaker); }} className="flex flex-wrap gap-2 mb-6">
              <div className="flex-1 min-w-[200px] relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" strokeWidth={2.5} />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索群聊内容..."
                  className="w-full pl-9 pr-4 py-2.5 rounded-2xl border border-gray-200 text-sm focus:outline-none focus:border-[#07c160] transition-colors bg-gray-50 dk-subtle dk-border"
                />
              </div>
              <select
                value={searchSpeaker}
                onChange={(e) => setSearchSpeaker(e.target.value)}
                className="px-3 py-2.5 rounded-2xl border border-gray-200 text-sm bg-gray-50 dk-subtle dk-border focus:outline-none focus:border-[#07c160] transition-colors min-w-[120px]"
              >
                <option value="">全部成员</option>
                {(detail?.member_rank ?? []).map((m) => (
                  <option key={m.speaker} value={m.speaker}>{m.speaker}</option>
                ))}
              </select>
              <button
                type="submit"
                disabled={!searchQuery.trim() || searchLoading}
                className="px-5 py-2.5 bg-[#07c160] text-white rounded-2xl text-sm font-bold disabled:opacity-40 hover:bg-[#06ad56] transition-colors"
              >
                搜索
              </button>
            </form>

            {searchLoading ? (
              <div className="flex flex-col items-center justify-center h-40 gap-3">
                <Loader2 size={28} className="text-[#07c160] animate-spin" />
                <span className="text-xs text-gray-400">消息量较大时搜索可能需要一点时间，请稍候…</span>
              </div>
            ) : searchDone && searchResults.length === 0 ? (
              <div className="text-center text-gray-300 py-12 text-sm">未找到相关消息</div>
            ) : searchResults.length > 0 ? (
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <p className="text-xs text-gray-400">找到 {searchResults.length} 条消息{searchSpeaker ? ` · ${searchSpeaker}` : ''}</p>
                  <button
                    onClick={() => exportGroupTxt(searchResults, group.name)}
                    className="text-[10px] text-gray-400 hover:text-[#07c160] transition-colors flex items-center gap-1"
                  >
                    <Download size={12} /> 导出 TXT
                  </button>
                  <button
                    onClick={() => exportGroupCsv(searchResults, group.name)}
                    className="text-[10px] text-gray-400 hover:text-[#07c160] transition-colors flex items-center gap-1"
                  >
                    <Download size={12} /> 导出 CSV
                  </button>
                </div>
                <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                  {searchResults.map((msg, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-3 py-2 border-b border-gray-50 dark:border-white/5 last:border-0 cursor-pointer hover:bg-[#f8f9fb] dark:hover:bg-white/5 rounded-xl px-2 transition-colors"
                      onClick={() => msg.date && setContextTarget({
                        username: group.username,
                        displayName: group.name,
                        date: msg.date,
                        targetTime: msg.time,
                        targetContent: msg.content,
                        isGroup: true,
                      })}
                      title="点击查看当天完整对话"
                    >
                      {msg.avatar_url ? (
                        <img src={avatarSrc(msg.avatar_url)} alt="" className="w-7 h-7 rounded-full flex-shrink-0 object-cover mt-0.5" />
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-[#576b95] flex items-center justify-center text-white text-[9px] font-black flex-shrink-0 mt-0.5">
                          {msg.speaker.charAt(0)}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 mb-0.5">
                          <span className="text-xs font-bold text-gray-600 dark:text-gray-300">{msg.speaker}</span>
                          <span className="text-[10px] text-gray-300">{msg.date} {msg.time}</span>
                        </div>
                        <div className="text-sm text-[#1d1d1f] dark:text-gray-100 leading-relaxed break-words whitespace-pre-wrap bg-[#f0f0f0] dark:bg-white/10 rounded-2xl rounded-tl-sm px-3 py-2">
                          {msg.content}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {tab === 'portrait' && loading ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <Loader2 size={32} className="text-[#07c160] animate-spin" />
            <div className="text-center">
              <span className="text-sm text-gray-400">正在分析群聊数据…</span>
              <p className="text-[10px] text-gray-300 mt-1">大群成员和消息较多，首次分析可能需要一些时间</p>
            </div>
          </div>
        ) : tab === 'portrait' && detail ? (
          <div className="space-y-6">
            {/* 群号称卡 + 时钟指纹 + 影响力 + 年报入口 —— 挂在画像顶部 */}
            {(() => {
              const tags = getGroupPersonaTags(detail);
              const weeklyHourly = detail.weekly_hourly_dist;
              const infl = detail.my_influence_score ?? -1;
              const myRate = detail.my_reply_rate ?? 0;
              const baseRate = detail.group_base_reply_rate ?? 0;
              const show = tags.length > 0 || (weeklyHourly && weeklyHourly.length === 7) || infl >= 0;
              if (!show) return null;
              return (
                <div className="dk-subtle bg-[#f8f9fb] rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Zap size={14} className="text-[#ff9500]" />
                      <h4 className="text-sm font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider">这个群的指纹</h4>
                    </div>
                    <button
                      onClick={() => setShowYearReview(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-gradient-to-r from-[#ff9500] to-[#fa5151] text-white hover:opacity-90 transition-opacity"
                    >
                      <BookOpen size={12} /> AI 年报
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {/* 群号称标签 */}
                    {tags.length > 0 && (
                      <div className="md:col-span-2 space-y-2">
                        <div className="text-[11px] text-gray-400">群号称</div>
                        <div className="flex flex-wrap gap-1.5">
                          {tags.map(t => (
                            <span key={t.label} className={`px-2 py-1 rounded-full text-xs font-bold ${toneClasses(t.tone)}`}>
                              {t.emoji} {t.label}
                            </span>
                          ))}
                        </div>
                        {infl >= 0 && (
                          <div className="pt-2">
                            <div className="text-[11px] text-gray-400 mb-1">我的影响力</div>
                            <div className="flex items-baseline gap-2 flex-wrap">
                              <span className={`text-lg font-black ${infl >= 70 ? 'text-[#07c160]' : infl >= 40 ? 'text-[#576b95]' : 'text-gray-400'}`}>
                                {infl}
                              </span>
                              <span className="text-[11px] text-gray-400">
                                ({myRate >= 0 ? `我发言 ${Math.round(myRate * 100)}% 有回应` : '样本不足'}
                                {baseRate > 0 ? ` · 群基线 ${Math.round(baseRate * 100)}%` : ''})
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {/* 时钟指纹 */}
                    {weeklyHourly && weeklyHourly.length === 7 && (
                      <div className="space-y-1">
                        <div className="text-[11px] text-gray-400">时钟指纹 · 7×24</div>
                        <div className="overflow-x-auto">
                          <ClockFingerprint matrix={weeklyHourly} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* 我的群 CP —— 仅在有 ≥1 个入选时显示 */}
            {(detail.my_cps?.length ?? 0) > 0 && (
              <div className="dk-subtle bg-gradient-to-br from-[#fff5f7] to-[#f0faf4] dark:from-[#fa5151]/10 dark:to-[#07c160]/10 rounded-2xl p-4 border border-[#fa5151]/10 dark:border-white/10">
                <div className="flex items-center gap-2 mb-3">
                  <Heart size={14} className="text-[#fa5151]" />
                  <h4 className="text-sm font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    群内 · 我的 CP
                  </h4>
                  <span className="text-[10px] text-gray-400">跟我引用互动最多</span>
                </div>
                <div className="flex flex-wrap gap-3">
                  {detail.my_cps!.map((cp) => {
                    const contact = allContacts.find(c => c.username === cp.username);
                    const clickable = !!contact;
                    return (
                      <div
                        key={cp.username}
                        onClick={clickable ? () => onContactClick?.(contact!) : undefined}
                        className={`flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white dark:bg-white/10 shadow-sm ${clickable ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all' : ''}`}
                      >
                        {cp.avatar_url ? (
                          <img
                            loading="lazy"
                            src={cp.avatar_url}
                            alt=""
                            className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-[#fa5151]/10 flex items-center justify-center flex-shrink-0">
                            <Heart size={12} className="text-[#fa5151]" />
                          </div>
                        )}
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm font-bold text-[#1d1d1f] dk-text truncate">{cp.display_name}</span>
                          <span className="text-[10px] text-gray-400">引用互动 {cp.replies} 次</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 成员发言排行 */}
            {(detail.member_rank?.length ?? 0) > 0 && (() => {
              const activeCount = sortedMembers.filter(m => m.count > 0).length;
              const silentCount = sortedMembers.length - activeCount;
              const displayMembers = sortedMembers.slice(0, rankLimit);

              return (
              <div className="space-y-4">
                {/* ── 活跃成员 ── */}
                <div className="dk-subtle bg-[#f8f9fb] rounded-2xl p-4">
                  {/* 标题 + 快捷筛选 + 统计 */}
                  <div className="flex items-center gap-3 mb-3 flex-wrap">
                    <h4 className="text-sm font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-2">
                      <BarChart2 size={14} /> 成员发言排行
                    </h4>
                    <div className="flex items-center gap-1">
                      {[10, 50, sortedMembers.length].filter((n, i, a) => n > 0 && a.indexOf(n) === i).map(n => (
                        <button key={n} onClick={() => { setRankLimit(n); localStorage.setItem(MEMBER_RANK_LIMIT_KEY, String(n)); }}
                          className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all ${
                            rankLimit === n ? 'bg-[#07c160] text-white' : 'bg-gray-100 dark:bg-white/10 text-gray-400 hover:bg-gray-200'
                          }`}>
                          {n === sortedMembers.length ? '全部' : `Top ${n}`}
                        </button>
                      ))}
                    </div>
                    <div className="ml-auto flex items-center gap-2 text-[10px] text-gray-400">
                      <span className="px-2 py-0.5 rounded-full bg-[#07c160]/10 text-[#07c160] font-bold">
                        {activeCount} 人发言
                      </span>
                      {silentCount > 0 && (
                        <span className="px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-900/20 text-red-400 font-bold">
                          {silentCount} 人潜水
                        </span>
                      )}
                      <button
                        onClick={() => {
                          const header = '排名,成员,微信号,消息数,首次发言,最后发言\n';
                          const esc = (s: string) => `"${(s || '').replace(/"/g, '""')}"`;
                          const rows = sortedMembers.map((m, i) =>
                            [
                              i + 1,
                              esc(m.speaker),
                              esc(m.username || ''),
                              m.count,
                              esc(m.first_message_time || '未发言'),
                              esc(m.last_message_time || '未发言'),
                            ].join(',')
                          ).join('\n');
                          const blob = new Blob(['\uFEFF' + header + rows], { type: 'text/csv;charset=utf-8' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url; a.download = `${group.name}_成员排行.csv`;
                          a.click(); URL.revokeObjectURL(url);
                        }}
                        className="flex items-center gap-1 text-gray-400 hover:text-[#07c160] transition-colors"
                        title="导出成员排行 CSV"
                      >
                        <Download size={12} /> 导出
                      </button>
                    </div>
                  </div>

                  {/* 可点击排序的表头 */}
                  <div className="flex items-center gap-3 pb-2 mb-1 border-b border-gray-200/60 dark:border-white/10 text-[10px] text-gray-400 font-bold select-none">
                    <span className="w-6 text-right">#</span>
                    <span className="flex-1 min-w-0 cursor-pointer hover:text-[#1d1d1f] dark:hover:text-gray-200 transition-colors" onClick={() => toggleSort('name')}>
                      成员 {memberSort === 'name' ? (memberSortAsc ? '↑' : '↓') : ''}
                    </span>
                    <span className="w-16 text-right cursor-pointer hover:text-[#1d1d1f] dark:hover:text-gray-200 transition-colors" onClick={() => toggleSort('count')}>
                      消息数 {memberSort === 'count' ? (memberSortAsc ? '↑' : '↓') : ''}
                    </span>
                    <span className="w-24 text-right cursor-pointer hover:text-[#1d1d1f] dark:hover:text-gray-200 transition-colors" onClick={() => toggleSort('last')}>
                      最后发言 {memberSort === 'last' ? (memberSortAsc ? '↑' : '↓') : ''}
                    </span>
                  </div>

                  {/* 成员列表 */}
                  <div className="space-y-0 max-h-[600px] overflow-y-auto">
                    {displayMembers.map((m, i) => {
                      const contact = findContact(m.speaker);
                      const days = m.last_message_time ? Math.floor((Date.now() - new Date(m.last_message_time).getTime()) / 86400000) : 999;
                      const isSilent = m.count === 0;
                      return (
                        <div key={m.speaker} className={`flex items-center gap-3 py-1.5 hover:bg-white/60 dark:hover:bg-white/5 rounded-lg px-1 transition-colors group ${isSilent ? 'opacity-50' : ''}`}>
                          {/* 排名 */}
                          <span className={`w-6 text-xs font-black text-right flex-shrink-0 ${
                            isSilent ? 'text-gray-200' : i === 0 ? 'text-[#ff9500]' : i === 1 ? 'text-[#8b5cf6]' : i === 2 ? 'text-[#10aeff]' : 'text-gray-300'
                          }`}>{i + 1}</span>

                          {/* 名字 + 进度条 */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span
                                className={`text-sm font-semibold truncate ${contact ? 'text-[#07c160] cursor-pointer hover:underline' : 'text-[#1d1d1f] dk-text'}`}
                                onClick={() => contact && onContactClick(contact)}
                              >
                                <span className={privacyMode ? 'privacy-blur' : ''}>{m.speaker}</span>
                              </span>
                              {contact && (
                                <span className="opacity-0 group-hover:opacity-100 transition-opacity text-[9px] text-[#07c160]">↗</span>
                              )}
                              {isSilent && (
                                <span className="text-[9px] text-red-400 bg-red-50 dark:bg-red-900/20 px-1 py-0.5 rounded">潜水</span>
                              )}
                            </div>
                            {!isSilent && (
                              <div className="h-1 bg-gray-200/60 dark:bg-gray-700 rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all duration-500"
                                  style={{
                                    width: `${Math.max(1, (m.count / maxMember) * 100)}%`,
                                    background: i < 3 ? ['#ff9500', '#8b5cf6', '#10aeff'][i] : '#d1d5db',
                                  }}
                                />
                              </div>
                            )}
                          </div>

                          {/* 消息数 */}
                          <span className={`w-16 text-right flex-shrink-0 text-xs tabular-nums ${
                            isSilent ? 'text-red-300' : i < 3 ? 'font-bold text-[#1d1d1f] dk-text' : 'text-gray-400'
                          }`}>
                            {isSilent ? '0' : m.count.toLocaleString()}
                          </span>

                          {/* 最后发言 */}
                          <span className={`text-[10px] w-24 text-right flex-shrink-0 tabular-nums ${
                            isSilent ? 'text-red-300' : days > 180 ? 'text-red-400 font-bold' : days > 30 ? 'text-orange-400' : 'text-gray-300'
                          }`}>
                            {m.last_message_ts ? <RelativeTime ts={m.last_message_ts} /> : (m.last_message_time ? m.last_message_time.slice(5) : '从未发言')}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              );
            })()}

            {/* 群活跃趋势图（按月聚合 daily_heatmap） */}
            {Object.keys(detail.daily_heatmap).length > 0 && (() => {
              // 聚合为月度数据
              const monthMap = new Map<string, number>();
              for (const [date, count] of Object.entries(detail.daily_heatmap)) {
                const month = date.slice(0, 7); // YYYY-MM
                monthMap.set(month, (monthMap.get(month) ?? 0) + count);
              }
              const monthlyData = Array.from(monthMap.entries())
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([month, count]) => ({
                  month,
                  label: `${month.slice(2, 4)}/${month.slice(5)}`,
                  count,
                }));

              if (monthlyData.length < 2) return null;

              const maxMonth = monthlyData.reduce((best, cur) => cur.count > best.count ? cur : best);
              const minMonth = monthlyData.reduce((best, cur) => cur.count < best.count ? cur : best);

              return (
                <div className="dk-subtle bg-[#f8f9fb] rounded-2xl p-4">
                  <h4 className="text-sm font-black text-gray-500 dark:text-gray-400 uppercase mb-1 tracking-wider flex items-center gap-2">
                    <TrendingUp size={14} /> 群活跃趋势
                  </h4>
                  <p className="text-xs text-gray-400 mb-1">按月统计消息量变化</p>
                  <div className="flex flex-wrap gap-3 mb-3 text-[10px]">
                    <span className="px-2 py-0.5 rounded-full bg-[#07c160]/10 text-[#07c160] font-bold">
                      最活跃 {maxMonth.month}（{maxMonth.count.toLocaleString()} 条）
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-gray-200/60 text-gray-500 font-bold dark:bg-gray-700 dark:text-gray-400">
                      最冷清 {minMonth.month}（{minMonth.count.toLocaleString()} 条）
                    </span>
                  </div>
                  <ResponsiveContainer width="100%" height={120}>
                    <AreaChart data={monthlyData} margin={{ top: 4, right: 4, bottom: 0, left: -30 }}>
                      <defs>
                        <linearGradient id="groupTrendGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#07c160" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="#07c160" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 9, fill: '#bbb' }}
                        tickLine={false}
                        interval={Math.max(0, Math.floor(monthlyData.length / 8) - 1)}
                      />
                      <YAxis tick={false} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{ borderRadius: 8, fontSize: 12 }}
                        formatter={(v: number) => [`${v.toLocaleString()} 条`, '消息数']}
                        labelFormatter={(l: string) => `20${l.replace('/', ' 年 ')} 月`}
                      />
                      <Area
                        type="monotone"
                        dataKey="count"
                        stroke="#07c160"
                        strokeWidth={2}
                        fill="url(#groupTrendGrad)"
                        dot={false}
                        activeDot={{ r: 4, fill: '#07c160' }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              );
            })()}

            {/* 高峰日 TOP 5 */}
            {Object.keys(detail.daily_heatmap).length > 0 && (() => {
              const topDays = Object.entries(detail.daily_heatmap)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 5);

              if (topDays.length === 0) return null;
              const topMax = topDays[0][1];

              return (
                <div className="dk-subtle bg-[#f8f9fb] rounded-2xl p-4">
                  <h4 className="text-sm font-black text-gray-500 dark:text-gray-400 uppercase mb-1 tracking-wider flex items-center gap-2">
                    <Flame size={14} /> 高峰日 TOP {topDays.length}
                  </h4>
                  <p className="text-xs text-gray-400 mb-3">消息量最多的日子，点击查看当天聊天记录</p>
                  <div className="space-y-2">
                    {topDays.map(([date, count], i) => {
                      const weekday = ['日', '一', '二', '三', '四', '五', '六'][new Date(date).getDay()];
                      return (
                        <button
                          key={date}
                          onClick={() => setDayPanel({ date, count })}
                          className="flex items-center gap-3 w-full text-left group rounded-xl p-2 -mx-2 hover:bg-white dark:hover:bg-white/5 transition-colors"
                        >
                          <span className={`w-5 text-xs font-black text-right flex-shrink-0 ${
                            i === 0 ? 'text-red-500' : i === 1 ? 'text-orange-400' : i === 2 ? 'text-yellow-500' : 'text-gray-300'
                          }`}>{i + 1}</span>
                          <div className="flex items-center gap-2 w-36 flex-shrink-0">
                            <Calendar size={12} className="text-gray-300" />
                            <span className="text-sm font-bold dk-text text-[#1d1d1f]">{date}</span>
                            <span className="text-[10px] text-gray-400">周{weekday}</span>
                          </div>
                          <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${(count / topMax) * 100}%`,
                                background: i === 0 ? '#fa5151' : i === 1 ? '#ff9500' : i === 2 ? '#ffc300' : '#10aeff',
                              }}
                            />
                          </div>
                          <span className="text-xs text-gray-400 w-16 text-right flex-shrink-0 font-bold">
                            {count.toLocaleString()} 条
                          </span>
                          <ChevronRight size={12} className="text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* 高频词（默认展开） */}
            {(detail.top_words?.length ?? 0) > 0 && (
              <Section title="高频词汇" subtitle="全部文本消息分词统计，已过滤停用词与表情符号">
                <div className="flex flex-wrap gap-2">
                  {detail.top_words.map((w, i) => {
                    const maxCnt = detail.top_words[0].count;
                    const ratio = w.count / maxCnt;
                    const size = ratio > 0.6 ? 'text-lg' : ratio > 0.3 ? 'text-base' : 'text-sm';
                    return (
                      <span
                        key={w.word}
                        className={`${size} font-bold px-2 py-1 rounded-lg${privacyMode ? ' privacy-blur' : ''}`}
                        style={{ color: MEMBER_COLORS[i % MEMBER_COLORS.length], background: `${MEMBER_COLORS[i % MEMBER_COLORS.length]}18` }}
                      >
                        {w.word}
                        <span className="text-xs font-normal ml-1 opacity-60">{w.count}</span>
                      </span>
                    );
                  })}
                </div>
              </Section>
            )}

            {/* 消息类型分布（默认折叠） */}
            {detail.type_dist && Object.keys(detail.type_dist).length > 0 && (
              <Section title="消息类型分布" subtitle="文本 / 图片 / 表情 / 链接 / 红包等占比" defaultOpen={false}>
                <MessageTypePieChart
                  typeData={detail.type_dist}
                  totalMessages={Object.values(detail.type_dist).reduce((a, b) => a + b, 0)}
                />
              </Section>
            )}

            {/* 24h + 周分布（默认折叠，并排） */}
            <Section title="时间分布" subtitle="24 小时活跃度 + 一周各天的消息总量" defaultOpen={false}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-gray-500 font-semibold mb-1.5">24 小时</div>
                  <ResponsiveContainer width="100%" height={90}>
                    <BarChart data={hourlyData} margin={{ top: 0, right: 0, bottom: 0, left: -30 }}>
                      <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#bbb' }} tickLine={false} interval={3} />
                      <YAxis tick={false} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} formatter={(v) => [`${v} 条`, '']} labelFormatter={(l) => `${l}:00`} />
                      <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={14}>
                        {hourlyData.map((entry, i) => (
                          <Cell key={i} fill={entry.isLateNight ? '#576b95' : '#10aeff'} opacity={0.8} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div>
                  <div className="text-xs text-gray-500 font-semibold mb-1.5">每周</div>
                  <ResponsiveContainer width="100%" height={90}>
                    <BarChart data={weeklyData} margin={{ top: 0, right: 0, bottom: 0, left: -30 }}>
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#999' }} tickLine={false} />
                      <YAxis tick={false} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} formatter={(v) => [`${v} 条`, '']} />
                      <Bar dataKey="value" fill="#07c160" radius={[4, 4, 0, 0]} maxBarSize={28} opacity={0.8} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </Section>

            {/* 日历热力图 */}
            {Object.keys(detail.daily_heatmap).length > 0 && (
              <Section
                title="聊天日历"
                subtitle="每格代表一天，颜色越深表示当天消息越多"
                defaultOpen={false}
                action={peakDay ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); setDayPanel({ date: peakDay[0], count: peakDay[1] }); }}
                    className="flex items-center gap-1.5 text-[10px] font-bold text-[#07c160] bg-[#07c16012] hover:bg-[#07c16022] px-2.5 py-1 rounded-full transition-colors"
                    title="查看最密集那天的聊天记录"
                  >
                    <span>🔥</span>
                    <span>最密集：{peakDay[0]}（{peakDay[1].toLocaleString()} 条）</span>
                  </button>
                ) : undefined}
              >
                <CalendarHeatmap
                  data={detail.daily_heatmap}
                  onDayClick={(date, count) => setDayPanel({ date, count })}
                />
                <div className="flex items-center gap-1 mt-2 text-xs text-gray-400">
                  <span>少</span>
                  {['#ebedf0','#9be9a8','#40c463','#30a14e','#216e39'].map(c => (
                    <span key={c} className="w-3 h-3 rounded-sm inline-block" style={{ background: c }} />
                  ))}
                  <span>多</span>
                </div>
              </Section>
            )}
          </div>
        ) : tab === 'portrait' ? (
          <div className="text-center text-gray-300 py-12">暂无数据</div>
        ) : null}
      </div>{/* end content padding */}
      </div>{/* end inner scroll div */}
      </div>{/* end outer rounded clip div */}

      {dayPanel && (
        <GroupDayChatPanel
          username={group.username}
          date={dayPanel.date}
          dayCount={dayPanel.count}
          groupName={group.name}
          onClose={() => setDayPanel(null)}
        />
      )}

      {contextTarget && (
        <SearchContextModal
          {...contextTarget}
          onClose={() => setContextTarget(null)}
        />
      )}

      {forgeOpen && (
        <ForgeSkillModal
          open={forgeOpen}
          onClose={() => setForgeOpen(false)}
          skillType="group"
          username={group.username}
          displayName={group.name}
          onOpenSettings={onOpenSettings}
        />
      )}

      <ConfirmDialog
        open={blockConfirmOpen}
        title="屏蔽群聊"
        message={`确定屏蔽「${group.name || group.username}」？\n屏蔽后该群聊不会出现在统计和排行里。`}
        hint="如需取消，可前往 设置 → 隐私屏蔽 移除。"
        confirmText="屏蔽"
        danger
        onConfirm={() => { setBlockConfirmOpen(false); onBlock?.(group.username); onClose(); }}
        onCancel={() => setBlockConfirmOpen(false)}
      />
      {showYearReview && (
        <GroupYearReviewModal
          username={group.username}
          fallbackName={group.name}
          onClose={() => setShowYearReview(false)}
        />
      )}
    </div>
  );
};

// ─── 主视图 ───────────────────────────────────────────────────────────────────

interface GroupsViewProps {
  allContacts: ContactStats[];
  onContactClick: (c: ContactStats) => void;
  onGroupClick: (g: GroupInfo) => void;
  blockedGroups?: string[];
  onBlockGroup?: (username: string) => void;
  onOpenSettings?: () => void;
}

type GroupSortKey = 'name' | 'total_messages' | 'member_count' | 'last_message_time' | 'status';
type SortDir = 'asc' | 'desc';

const getGroupStatusTier = (g: GroupInfo): 0 | 1 | 2 | 3 => {
  const days = (Date.now() - new Date(g.last_message_time).getTime()) / 86400000;
  if (days < 7)   return 0;
  if (days < 30)  return 1;
  if (days < 180) return 2;
  return 3;
};

const GROUP_STATUS_BADGES = [
  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-[#e7f8f0] text-[#07c160]">活跃</span>,
  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-[#f0fce8] text-[#7bc934]">温热</span>,
  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-orange-50 text-[#ff9500]">渐冷</span>,
  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-[#eef1f7] text-[#576b95]">沉寂</span>,
];

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export const GroupsView: React.FC<GroupsViewProps> = ({ allContacts, onContactClick, onGroupClick, blockedGroups = [], onBlockGroup, onOpenSettings }) => {
  const { privacyMode } = usePrivacyMode();
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  // removed: selected state — modal now rendered at App.tsx top level via onGroupClick
  const [sortKey, setSortKey] = useState<GroupSortKey>('total_messages');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [compareMode, setCompareMode] = useState(false);
  const [compareSelected, setCompareSelected] = useState<Set<string>>(new Set());
  const [showCompare, setShowCompare] = useState(false);

  useEffect(() => {
    groupsApi.getList().then((data) => {
      setGroups(data || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const filtered = groups.filter(g => {
    if (blockedGroups.some(b => b === g.username || b === g.name)) return false;
    return g.name.toLowerCase().includes(search.toLowerCase()) ||
      g.username.toLowerCase().includes(search.toLowerCase());
  });

  const handleSort = (key: GroupSortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
    setCurrentPage(1);
  };

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case 'name':
        cmp = a.name.localeCompare(b.name, 'zh');
        break;
      case 'total_messages':
        cmp = a.total_messages - b.total_messages;
        break;
      case 'member_count':
        cmp = (a.member_count ?? 0) - (b.member_count ?? 0);
        break;
      case 'last_message_time':
        cmp = (a.last_message_time || '').localeCompare(b.last_message_time || '');
        break;
      case 'status':
        cmp = getGroupStatusTier(a) - getGroupStatusTier(b);
        break;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const totalPages = Math.ceil(sorted.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentGroups = sorted.slice(startIndex, startIndex + itemsPerPage);

  const SortIcon = ({ col }: { col: GroupSortKey }) => {
    if (sortKey !== col) return <span className="opacity-20 ml-1"><ChevronUp size={11} /></span>;
    return sortDir === 'asc'
      ? <ChevronUp size={11} className="ml-1 text-[#07c160]" />
      : <ChevronDown size={11} className="ml-1 text-[#07c160]" />;
  };

  const thClass = "px-3 py-3 text-left text-xs font-black text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-[#07c160] transition-colors whitespace-nowrap";

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <Loader2 size={40} className="text-[#07c160] animate-spin" />
        <div className="text-center">
          <p className="text-sm font-semibold text-gray-500 dk-text">正在加载群聊数据...</p>
          <p className="text-xs text-gray-400 mt-1">群聊较多时首次加载可能需要几秒</p>
        </div>
      </div>
    );
  }

  const totalMembers = groups.reduce((s, g) => s + (g.member_count ?? 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="dk-text text-3xl sm:text-5xl font-black tracking-tight text-[#1d1d1f] mb-1">群聊画像</h1>
          <p className="text-gray-400 text-sm">{groups.length} 个群聊</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { if (compareMode) { setCompareMode(false); setCompareSelected(new Set()); } else { setCompareMode(true); } }}
            className={`flex items-center gap-1.5 px-3 py-2.5 rounded-2xl text-sm font-bold transition-all whitespace-nowrap ${
              compareMode
                ? 'bg-[#07c160] text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-[#e7f8f0] hover:text-[#07c160]'
            }`}
          >
            <TrendingUp size={14} />
            {compareMode ? '退出对比' : '对比模式'}
          </button>
          <div className="relative w-full sm:w-64">
            <input
              type="text"
              placeholder="搜索群聊..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
              className="dk-input w-full pl-4 pr-4 py-2.5 bg-white border border-gray-200 rounded-2xl text-sm focus:outline-none focus:border-[#07c160]"
            />
          </div>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-3 gap-4">
        <div className="dk-card bg-white dk-border border border-gray-100 rounded-2xl p-5">
          <Users size={20} className="text-[#10aeff] mb-2" strokeWidth={2.5} />
          <div className="dk-text text-2xl sm:text-3xl font-black text-[#1d1d1f]">{groups.length}</div>
          <div className="dk-text-muted text-xs text-gray-500 mt-1">群聊总数</div>
        </div>
        <div className="dk-card bg-white dk-border border border-gray-100 rounded-2xl p-5">
          <MessageSquare size={20} className="text-[#07c160] mb-2" strokeWidth={2.5} />
          <div className="dk-text text-2xl sm:text-3xl font-black text-[#1d1d1f]">
            {(groups.reduce((s, g) => s + g.total_messages, 0) / 10000).toFixed(1)}万
          </div>
          <div className="dk-text-muted text-xs text-gray-500 mt-1">群消息总量</div>
        </div>
        <div className="dk-card bg-white dk-border border border-gray-100 rounded-2xl p-5">
          <Users size={20} className="text-[#ff9500] mb-2" strokeWidth={2.5} />
          <div className="dk-text text-2xl sm:text-3xl font-black text-[#1d1d1f]">
            {totalMembers > 10000 ? `${(totalMembers / 10000).toFixed(1)}万` : totalMembers.toLocaleString()}
          </div>
          <div className="dk-text-muted text-xs text-gray-500 mt-1">发言人数</div>
        </div>
      </div>

      {/* 最活跃群聊 Top 3 */}
      {groups.length > 0 && (() => {
        const top3 = [...groups].sort((a, b) => b.total_messages - a.total_messages).slice(0, 3);
        const maxMsg = top3[0]?.total_messages || 1;
        const activeCount = groups.filter(g => getGroupStatusTier(g) === 0).length;
        const dormantCount = groups.filter(g => getGroupStatusTier(g) === 3).length;
        const medals = ['🥇', '🥈', '🥉'];
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Top 3 */}
            <div className="dk-card bg-white dk-border border border-gray-100 rounded-2xl p-5">
              <div className="flex items-center gap-1.5 mb-3">
                <Crown size={16} className="text-[#ff9500]" />
                <span className="text-sm font-bold text-[#1d1d1f] dk-text">最活跃群聊</span>
              </div>
              <div className="space-y-2.5">
                {top3.map((g, i) => (
                  <div
                    key={g.username}
                    className="flex items-center gap-3 cursor-pointer hover:bg-[#f8f9fb] dark:hover:bg-white/5 rounded-xl px-2 py-1.5 -mx-2 transition-colors"
                    onClick={() => onGroupClick(g)}
                  >
                    <span className="text-base flex-shrink-0">{medals[i]}</span>
                    {g.small_head_url ? (
                      <img loading="lazy" src={avatarSrc(g.small_head_url)} alt="" className="w-8 h-8 rounded-lg object-cover flex-shrink-0"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    ) : (
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#10aeff] to-[#0e8dd6] flex items-center justify-center text-white flex-shrink-0">
                        <Users size={14} />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-bold text-[#1d1d1f] dk-text truncate${privacyMode ? ' privacy-blur' : ''}`}>{g.name}</div>
                      <div className="h-1.5 bg-gray-100 dark:bg-white/10 rounded-full mt-1 overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${(g.total_messages / maxMsg) * 100}%`,
                            background: i === 0 ? '#07c160' : i === 1 ? '#10aeff' : '#ff9500',
                          }}
                        />
                      </div>
                    </div>
                    <span className="text-xs font-bold text-gray-400 flex-shrink-0 tabular-nums">{g.total_messages.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* 群状态分布 */}
            <div className="dk-card bg-white dk-border border border-gray-100 rounded-2xl p-5">
              <div className="flex items-center gap-1.5 mb-3">
                <BarChart2 size={16} className="text-[#10aeff]" />
                <span className="text-sm font-bold text-[#1d1d1f] dk-text">群活跃分布</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: '活跃', desc: '7天内', count: activeCount, color: '#07c160', bg: 'bg-[#e7f8f0]' },
                  { label: '温热', desc: '7-30天', count: groups.filter(g => getGroupStatusTier(g) === 1).length, color: '#7bc934', bg: 'bg-[#f0fce8]' },
                  { label: '渐冷', desc: '1-6月', count: groups.filter(g => getGroupStatusTier(g) === 2).length, color: '#ff9500', bg: 'bg-orange-50' },
                  { label: '沉寂', desc: '半年+', count: dormantCount, color: '#576b95', bg: 'bg-[#eef1f7]' },
                ].map(s => (
                  <div key={s.label} className={`${s.bg} rounded-xl px-3 py-2.5`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold" style={{ color: s.color }}>{s.label}</span>
                      <span className="text-lg font-black text-[#1d1d1f] dk-text">{s.count}</span>
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{s.desc}</div>
                    <div className="h-1 bg-white/50 dark:bg-white/10 rounded-full mt-1.5 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${groups.length > 0 ? (s.count / groups.length) * 100 : 0}%`, background: s.color }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* 群列表 */}
      <div className="dk-card bg-white dk-border border border-gray-100 rounded-2xl sm:rounded-3xl overflow-hidden">
        {/* 桌面表格 */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="dk-thead bg-[#f8f9fb] dk-border border-b border-gray-100">
                <th className={thClass} onClick={() => handleSort('name')}>
                  <div className="flex items-center">群名<SortIcon col="name" /></div>
                </th>
                <th className={thClass} onClick={() => handleSort('member_count')}>
                  <div className="flex items-center gap-1"><Users size={14} />发言人数<SortIcon col="member_count" /></div>
                </th>
                <th className={thClass} onClick={() => handleSort('total_messages')}>
                  <div className="flex items-center gap-1"><MessageCircle size={14} />消息数<SortIcon col="total_messages" /></div>
                </th>
                <th className={thClass} onClick={() => handleSort('last_message_time')}>
                  <div className="flex items-center gap-1"><Clock size={14} />最后联系<SortIcon col="last_message_time" /></div>
                </th>
                <th className={thClass} onClick={() => handleSort('status')}>
                  <div className="flex items-center gap-1">状态<SortIcon col="status" /></div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/5">
              {currentGroups.map((group) => (
                <tr
                  key={group.username}
                  onClick={() => {
                    if (compareMode) {
                      setCompareSelected(prev => {
                        const next = new Set(prev);
                        if (next.has(group.username)) next.delete(group.username);
                        else if (next.size < 6) next.add(group.username);
                        return next;
                      });
                    } else {
                      onGroupClick(group);
                    }
                  }}
                  className={`dk-row-hover hover:bg-[#f8f9fb] dark:hover:bg-white/5 cursor-pointer transition-colors duration-150 ${
                    compareMode && compareSelected.has(group.username) ? 'bg-[#e7f8f0] dark:bg-[#07c160]/10' : ''
                  }`}
                >
                  <td className="px-3 py-3.5 text-sm">
                    <div className="flex items-center gap-3">
                      {compareMode && (
                        <input
                          type="checkbox"
                          checked={compareSelected.has(group.username)}
                          readOnly
                          className="w-4 h-4 accent-[#07c160] flex-shrink-0"
                        />
                      )}
                      {group.small_head_url ? (
                        <img loading="lazy" src={avatarSrc(group.small_head_url)} alt="" className="w-9 h-9 rounded-xl object-cover flex-shrink-0"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      ) : (
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#10aeff] to-[#0e8dd6] flex items-center justify-center text-white text-sm font-black flex-shrink-0">
                          <Users size={16} strokeWidth={2} />
                        </div>
                      )}
                      <div className={`font-bold text-[#1d1d1f] dk-text truncate${privacyMode ? ' privacy-blur' : ''}`}>{group.name}</div>
                    </div>
                  </td>
                  <td className="px-3 py-3.5 text-sm">
                    {(group.member_count ?? 0) > 0 ? (
                      <div className="flex flex-col items-start gap-0.5">
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400">
                          <Users size={11} />{group.member_count}
                        </span>
                        {(group.my_rank ?? 0) > 0 && group.total_messages > 0 && (
                          <span className="text-[10px] text-gray-400 px-1">
                            我 #{group.my_rank}
                            {group.my_messages ? ` · ${((group.my_messages / group.total_messages) * 100).toFixed(1)}%` : ''}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-sm text-gray-300">-</span>
                    )}
                  </td>
                  <td className="px-3 py-3.5 text-sm">
                    <div className="flex flex-col items-start gap-0.5">
                      <span className="font-bold dk-text text-[#1d1d1f]">{group.total_messages.toLocaleString()}</span>
                      {((group.recent_30d_messages ?? 0) > 0 || (group.recent_trend_pct ?? 0) !== 0) && (
                        <span className="flex items-center gap-1 text-[10px]">
                          {(group.recent_30d_messages ?? 0) > 0 && (
                            <span className="text-gray-400">30天 {group.recent_30d_messages}</span>
                          )}
                          {(group.recent_trend_pct !== undefined && group.recent_trend_pct !== 0) && (
                            <span className={`font-bold ${
                              group.recent_trend_pct >= 999 ? 'text-[#10aeff]' :
                              group.recent_trend_pct > 20 ? 'text-[#07c160]' :
                              group.recent_trend_pct < -20 ? 'text-[#fa5151]' :
                              'text-gray-400'
                            }`}>
                              {group.recent_trend_pct >= 999 ? '新群' :
                               group.recent_trend_pct > 0 ? `↑${group.recent_trend_pct}%` :
                               `↓${Math.abs(group.recent_trend_pct)}%`}
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3.5 text-sm">
                    <div className="flex flex-col items-start gap-0.5">
                      <RelativeTime ts={group.last_message_ts} placeholder={group.last_message_time || '-'} />
                      {(group.my_last_message_ts ?? 0) > 0 && group.my_last_message_ts !== group.last_message_ts && (
                        <span className="text-[10px] text-gray-400">
                          我：<RelativeTime ts={group.my_last_message_ts} />
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3.5 text-sm">
                    <div className="flex flex-col gap-1.5 items-start">
                      {GROUP_STATUS_BADGES[getGroupStatusTier(group)]}
                      <AIAnalysisBadge username={group.username} isGroup />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 手机卡片列表 */}
        <div className="sm:hidden divide-y divide-gray-100 dark:divide-white/5">
          {currentGroups.map((group) => (
            <div
              key={group.username}
              onClick={() => onGroupClick(group)}
              className="dk-row-hover flex items-center justify-between px-4 py-4 active:bg-[#f8f9fb] dark:active:bg-white/5 cursor-pointer"
            >
              <div className="flex items-center gap-3 min-w-0">
                {group.small_head_url ? (
                  <img loading="lazy" src={avatarSrc(group.small_head_url)} alt="" className="w-10 h-10 rounded-xl object-cover flex-shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                ) : (
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#10aeff] to-[#0e8dd6] flex items-center justify-center text-white flex-shrink-0">
                    <Users size={18} strokeWidth={2} />
                  </div>
                )}
                <div className="min-w-0">
                  <div className={`font-bold text-[#1d1d1f] dk-text truncate${privacyMode ? ' privacy-blur' : ''}`}>{group.name}</div>
                  <div className="text-xs text-gray-400 mt-0.5 truncate">
                    {(group.member_count ?? 0) > 0 && <span>{group.member_count} 人 · </span>}
                    {group.total_messages.toLocaleString()} 条
                    {(group.recent_30d_messages ?? 0) > 0 && <span> · 30天 {group.recent_30d_messages}</span>}
                    {(group.my_rank ?? 0) > 0 && group.total_messages > 0 && (
                      <span className="text-[#07c160]"> · 我 #{group.my_rank}</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 ml-3 flex-shrink-0">
                <span className="text-sm font-bold text-[#1d1d1f] dk-text">{group.total_messages.toLocaleString()}</span>
                {(group.recent_trend_pct !== undefined && group.recent_trend_pct !== 0 && group.recent_trend_pct < 999) && (
                  <span className={`text-[10px] font-bold ${
                    group.recent_trend_pct > 20 ? 'text-[#07c160]' :
                    group.recent_trend_pct < -20 ? 'text-[#fa5151]' : 'text-gray-400'
                  }`}>
                    {group.recent_trend_pct > 0 ? `↑${group.recent_trend_pct}%` : `↓${Math.abs(group.recent_trend_pct)}%`}
                  </span>
                )}
                {GROUP_STATUS_BADGES[getGroupStatusTier(group)]}
                <AIAnalysisBadge username={group.username} isGroup />
              </div>
            </div>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-16 text-gray-300 font-semibold">无匹配群聊</div>
        )}

        {/* Pagination */}
        {sorted.length > 0 && (
          <div className="dk-thead dk-border px-4 sm:px-8 py-4 sm:py-5 bg-[#f8f9fb] border-t border-gray-100 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-xs sm:text-sm text-gray-600 font-medium">
                {startIndex + 1}–{Math.min(startIndex + itemsPerPage, sorted.length)} / {sorted.length}
              </span>
              <div className="hidden sm:flex items-center gap-1">
                {PAGE_SIZE_OPTIONS.map(size => (
                  <button
                    key={size}
                    onClick={() => { setItemsPerPage(size); setCurrentPage(1); }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                      itemsPerPage === size
                        ? 'bg-[#07c160] text-white'
                        : 'text-gray-400 hover:bg-white dark:hover:bg-white/5 hover:text-gray-600'
                    }`}
                  >
                    {size}
                  </button>
                ))}
                <span className="text-xs text-gray-300 ml-1">条/页</span>
              </div>
            </div>

            <div className="flex gap-1 sm:gap-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 sm:px-4 py-2 rounded-xl font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white dark:hover:bg-white/5"
              >
                上一页
              </button>
              <div className="hidden sm:flex items-center gap-1">
                {(() => {
                  const pages: (number | '...')[] = [];
                  const delta = 2;
                  const left = currentPage - delta;
                  const right = currentPage + delta;
                  let last = 0;
                  for (let p = 1; p <= totalPages; p++) {
                    if (p === 1 || p === totalPages || (p >= left && p <= right)) {
                      if (last && p - last > 1) pages.push('...');
                      pages.push(p);
                      last = p;
                    }
                  }
                  return pages.map((p, idx) =>
                    p === '...' ? (
                      <span key={`ellipsis-${idx}`} className="w-8 text-center text-gray-400 text-sm">…</span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => setCurrentPage(p as number)}
                        className={`w-10 h-10 rounded-xl font-bold text-sm transition-all ${
                          currentPage === p ? 'bg-[#07c160] text-white shadow-lg shadow-green-100/50' : 'hover:bg-white dark:hover:bg-white/5 hover:shadow-sm'
                        }`}
                      >
                        {p}
                      </button>
                    )
                  );
                })()}
              </div>
              <span className="sm:hidden flex items-center text-sm text-gray-500 px-2">{currentPage}/{totalPages}</span>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 sm:px-4 py-2 rounded-xl font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white dark:hover:bg-white/5"
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 对比模式浮动栏 */}
      {compareMode && compareSelected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40
          bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700
          shadow-2xl rounded-2xl px-5 py-3 flex items-center gap-4">
          <span className="text-sm font-bold dk-text">
            已选 <span className="text-[#07c160]">{compareSelected.size}</span> 个群
            <span className="text-gray-400 font-normal ml-1">（最多 6 个）</span>
          </span>
          <button
            onClick={() => { if (compareSelected.size >= 2) setShowCompare(true); }}
            disabled={compareSelected.size < 2}
            className="px-4 py-2 bg-[#07c160] text-white rounded-xl text-sm font-bold
              disabled:opacity-40 hover:bg-[#06ad56] transition-colors"
          >
            开始对比
          </button>
          <button
            onClick={() => { setCompareMode(false); setCompareSelected(new Set()); }}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <X size={18} />
          </button>
        </div>
      )}

      {/* 对比面板 */}
      {showCompare && (() => {
        const selected = groups.filter(g => compareSelected.has(g.username));
        return selected.length >= 2 ? (
          <GroupComparePanel groups={selected} onClose={() => setShowCompare(false)} />
        ) : null;
      })()}
    </div>
  );
};
