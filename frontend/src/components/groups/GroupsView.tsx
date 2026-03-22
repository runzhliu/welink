/**
 * 群聊画像视图
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Users, MessageSquare, ChevronRight, Loader2, X, BarChart2, EyeOff, Search } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { GroupInfo, GroupDetail, ContactStats, GroupChatMessage } from '../../types';
import { groupsApi } from '../../services/api';
import { CalendarHeatmap } from '../contact/CalendarHeatmap';
import { GroupDayChatPanel } from './GroupDayChatPanel';
import { MessageTypePieChart } from '../common/MessageTypePieChart';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';
import {
  MEMBER_RANK_LIMIT_KEY, MEMBER_NAME_WIDTH_KEY,
  DEFAULT_RANK_LIMIT, DEFAULT_NAME_WIDTH,
} from '../common/SettingsPage';

// ─── 群详情弹窗 ───────────────────────────────────────────────────────────────

// 后端 weekly_dist[0]=周日, ...[6]=周六；显示改为周一~周日
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEK_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const MEMBER_COLORS = ['#07c160', '#10aeff', '#ff9500', '#fa5151', '#576b95', '#40c463'];

interface GroupDetailModalProps {
  group: GroupInfo;
  onClose: () => void;
  allContacts: ContactStats[];
  onContactClick: (c: ContactStats) => void;
  onBlock?: (username: string) => void;
}

export const GroupDetailModal: React.FC<GroupDetailModalProps> = ({ group, onClose, allContacts, onContactClick, onBlock }) => {
  const { privacyMode } = usePrivacyMode();

  // 根据显示名（remark/nickname）查找联系人
  const findContact = (displayName: string): ContactStats | null => {
    return allContacts.find(c =>
      (c.remark && c.remark === displayName) ||
      (c.nickname && c.nickname === displayName) ||
      c.username === displayName
    ) ?? null;
  };
  const [tab, setTab] = useState<'portrait' | 'search'>('portrait');
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [dayPanel, setDayPanel] = useState<{ date: string; count: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GroupChatMessage[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchDone, setSearchDone] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

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

  const handleSearch = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setSearchLoading(true);
    setSearchDone(false);
    try {
      const results = await groupsApi.searchMessages(group.username, q.trim());
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

  const maxMember = detail?.member_rank?.[0]?.count ?? 1;

  const peakDay = useMemo(() => {
    if (!detail) return null;
    const entries = Object.entries(detail.daily_heatmap);
    if (entries.length === 0) return null;
    return entries.reduce((best, cur) => cur[1] > best[1] ? cur : best);
  }, [detail]);

  return (
    <div
      className="fixed inset-0 bg-[#1d1d1f]/90 backdrop-blur-md z-50 flex items-end sm:items-center justify-center sm:p-8 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="dk-card bg-white rounded-t-[32px] sm:rounded-[48px] w-full sm:max-w-4xl overflow-y-auto max-h-[calc(100dvh-5rem)] sm:max-h-[92vh] shadow-2xl relative p-4 sm:p-8 lg:p-12"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute top-5 right-5 flex items-center gap-2">
          {onBlock && (
            <button
              onClick={() => { onBlock(group.username); onClose(); }}
              className="p-2 rounded-xl text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors duration-200"
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
            <img src={group.small_head_url} alt="" className="w-14 h-14 rounded-2xl object-cover flex-shrink-0"
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
              {group.first_message_time && (
                <>
                  <span className="text-gray-300">·</span>
                  <span>始于 {group.first_message_time}</span>
                </>
              )}
              <span className="text-gray-300">·</span>
              <span>最近 {group.last_message_time}</span>
            </p>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-2 mb-6 border-b border-gray-100">
          {(['portrait', 'search'] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                if (t === 'search') setTimeout(() => searchInputRef.current?.focus(), 50);
              }}
              className={`px-5 py-2 rounded-t-xl text-sm font-bold transition border-b-2 -mb-px ${
                tab === t ? 'text-[#07c160] border-[#07c160]' : 'text-gray-400 border-transparent hover:text-gray-600'
              }`}
            >
              {t === 'portrait' ? '群聊画像' : '搜索记录'}
            </button>
          ))}
        </div>

        {tab === 'search' && (
          <div>
            <form onSubmit={(e) => { e.preventDefault(); handleSearch(searchQuery); }} className="flex gap-2 mb-6">
              <div className="flex-1 relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" strokeWidth={2.5} />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索群聊内容..."
                  className="w-full pl-9 pr-4 py-2.5 rounded-2xl border border-gray-200 text-sm focus:outline-none focus:border-[#07c160] transition-colors bg-gray-50"
                />
              </div>
              <button
                type="submit"
                disabled={!searchQuery.trim() || searchLoading}
                className="px-5 py-2.5 bg-[#07c160] text-white rounded-2xl text-sm font-bold disabled:opacity-40 hover:bg-[#06ad56] transition-colors"
              >
                搜索
              </button>
            </form>

            {searchLoading ? (
              <div className="flex items-center justify-center h-40">
                <Loader2 size={28} className="text-[#07c160] animate-spin" />
              </div>
            ) : searchDone && searchResults.length === 0 ? (
              <div className="text-center text-gray-300 py-12 text-sm">未找到相关消息</div>
            ) : searchResults.length > 0 ? (
              <div>
                <p className="text-xs text-gray-400 mb-4">找到 {searchResults.length} 条消息{searchResults.length >= 200 ? '（最多显示 200 条）' : ''}</p>
                <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                  {searchResults.map((msg, i) => (
                    <div key={i} className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0">
                      <div className="w-7 h-7 rounded-full bg-[#576b95] flex items-center justify-center text-white text-[9px] font-black flex-shrink-0 mt-0.5">
                        {msg.speaker.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 mb-0.5">
                          <span className="text-xs font-bold text-gray-600">{msg.speaker}</span>
                          <span className="text-[10px] text-gray-300">{msg.date} {msg.time}</span>
                        </div>
                        <div className="text-sm text-[#1d1d1f] leading-relaxed break-words whitespace-pre-wrap bg-[#f0f0f0] rounded-2xl rounded-tl-sm px-3 py-2">
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
          <div className="flex items-center justify-center h-64">
            <Loader2 size={32} className="text-[#07c160] animate-spin" />
          </div>
        ) : tab === 'portrait' && detail ? (
          <div className="space-y-6">
            {/* 成员发言排行 */}
            {(detail.member_rank?.length ?? 0) > 0 && (
              <div className="dk-subtle bg-[#f8f9fb] rounded-2xl p-4">
                <div className="flex items-center justify-between mb-1">
                  <h4 className="text-sm font-black text-gray-500 uppercase tracking-wider flex items-center gap-2">
                    <BarChart2 size={14} /> 成员发言排行 Top {Math.min(detail.member_rank.length, rankLimit)}
                  </h4>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-gray-400">显示</span>
                    <input
                      type="number"
                      min={1}
                      max={detail.member_rank.length}
                      value={rankLimit}
                      onChange={(e) => {
                        const v = Math.min(500, Math.max(1, Number(e.target.value) || DEFAULT_RANK_LIMIT));
                        setRankLimit(v);
                        localStorage.setItem(MEMBER_RANK_LIMIT_KEY, String(v));
                      }}
                      className="w-14 text-xs border border-gray-200 rounded-lg px-2 py-0.5 text-center focus:outline-none focus:border-[#07c160] bg-white"
                      title="修改显示人数（最多 500）"
                    />
                    <span className="text-[10px] text-gray-400">/ {detail.member_rank.length} 人</span>
                  </div>
                </div>
                <p className="text-xs text-gray-400 mb-4">
                  按总消息条数排序 · 拖动名字列右侧边缘可调整列宽
                </p>
                <div className="space-y-2">
                  {detail.member_rank.slice(0, rankLimit).map((m, i) => {
                    const contact = findContact(m.speaker);
                    return (
                    <div key={m.speaker} className="flex items-center gap-3">
                      <span className={`w-5 text-xs font-black text-right flex-shrink-0 ${
                        i === 0 ? 'text-yellow-500' : i === 1 ? 'text-gray-400' : i === 2 ? 'text-orange-400' : 'text-gray-300'
                      }`}>{i + 1}</span>
                      {/* 名字列：宽度可拖拽 */}
                      <div className="relative flex items-center gap-1.5 flex-shrink-0 min-w-0" style={{ width: nameWidth }}>
                        <span
                          className={`text-sm font-semibold dk-text truncate ${contact ? 'text-[#07c160] cursor-pointer hover:underline' : 'text-[#1d1d1f]'}`}
                          onClick={() => contact && onContactClick(contact)}
                          title={contact ? '点击查看个人统计' : '非好友'}
                        ><span className={privacyMode ? 'privacy-blur' : ''}>{m.speaker}</span></span>
                        {contact
                          ? <span className="flex-shrink-0 text-[9px] font-bold text-[#07c160] bg-[#07c16018] px-1 py-0.5 rounded cursor-pointer" onClick={() => onContactClick(contact)}>好友↗</span>
                          : <span className="flex-shrink-0 text-[9px] text-gray-300">非好友</span>
                        }
                        {/* 拖拽把手 */}
                        <div
                          className="absolute right-0 top-1/2 -translate-y-1/2 h-4 w-1.5 cursor-col-resize rounded-full bg-gray-300 hover:bg-[#07c160] transition-colors opacity-60 hover:opacity-100"
                          onMouseDown={onDragStart}
                          title="拖拽调整名字列宽度"
                        />
                      </div>
                      <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${(m.count / maxMember) * 100}%`,
                            background: MEMBER_COLORS[i % MEMBER_COLORS.length],
                          }}
                        />
                      </div>
                      <span className="text-xs text-gray-400 w-12 text-right flex-shrink-0">
                        {m.count.toLocaleString()}
                      </span>
                    </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 高频词 */}
            {(detail.top_words?.length ?? 0) > 0 && (
              <div className="dk-subtle bg-[#f8f9fb] rounded-2xl p-4">
                <h4 className="text-sm font-black text-gray-500 uppercase mb-1 tracking-wider">高频词汇</h4>
                <p className="text-xs text-gray-400 mb-3">全部文本消息分词统计，已过滤停用词与表情符号</p>
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
              </div>
            )}

            {/* 消息类型分布 */}
            {detail.type_dist && Object.keys(detail.type_dist).length > 0 && (
              <MessageTypePieChart
                typeData={detail.type_dist}
                totalMessages={Object.values(detail.type_dist).reduce((a, b) => a + b, 0)}
              />
            )}

            {/* 24h 分布 */}
            <div className="dk-subtle bg-[#f8f9fb] rounded-2xl p-4">
              <h4 className="text-sm font-black text-gray-500 uppercase mb-1 tracking-wider">24 小时活跃分布</h4>
              <p className="text-xs text-gray-400 mb-3">按消息发送时间（北京时间）统计各小时消息量，深色为深夜 0–5 点</p>
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

            {/* 周分布 */}
            <div className="dk-subtle bg-[#f8f9fb] rounded-2xl p-4">
              <h4 className="text-sm font-black text-gray-500 uppercase mb-1 tracking-wider">每周活跃分布</h4>
              <p className="text-xs text-gray-400 mb-3">统计该群在一周各天的消息总量分布</p>
              <ResponsiveContainer width="100%" height={80}>
                <BarChart data={weeklyData} margin={{ top: 0, right: 0, bottom: 0, left: -30 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#999' }} tickLine={false} />
                  <YAxis tick={false} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} formatter={(v) => [`${v} 条`, '']} />
                  <Bar dataKey="value" fill="#07c160" radius={[4, 4, 0, 0]} maxBarSize={28} opacity={0.8} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* 日历热力图 */}
            {Object.keys(detail.daily_heatmap).length > 0 && (
              <div className="dk-subtle bg-[#f8f9fb] rounded-2xl p-4">
                <div className="flex items-center justify-between mb-1">
                  <h4 className="text-sm font-black text-gray-500 uppercase tracking-wider">聊天日历</h4>
                  {peakDay && (
                    <button
                      onClick={() => setDayPanel({ date: peakDay[0], count: peakDay[1] })}
                      className="flex items-center gap-1.5 text-[10px] font-bold text-[#07c160] bg-[#07c16012] hover:bg-[#07c16022] px-2.5 py-1 rounded-full transition-colors"
                      title="查看最密集那天的聊天记录"
                    >
                      <span>🔥</span>
                      <span>最密集：{peakDay[0]}（{peakDay[1].toLocaleString()} 条）</span>
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-400 mb-3">每格代表一天，颜色越深表示当天消息越多，点击可查看具体数量</p>
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
              </div>
            )}
          </div>
        ) : tab === 'portrait' ? (
          <div className="text-center text-gray-300 py-12">暂无数据</div>
        ) : null}
      </div>

      {dayPanel && (
        <GroupDayChatPanel
          username={group.username}
          date={dayPanel.date}
          dayCount={dayPanel.count}
          groupName={group.name}
          onClose={() => setDayPanel(null)}
        />
      )}
    </div>
  );
};

// ─── 主视图 ───────────────────────────────────────────────────────────────────

interface GroupsViewProps {
  allContacts: ContactStats[];
  onContactClick: (c: ContactStats) => void;
  blockedGroups?: string[];
  onBlockGroup?: (username: string) => void;
}

export const GroupsView: React.FC<GroupsViewProps> = ({ allContacts, onContactClick, blockedGroups = [], onBlockGroup }) => {
  const { privacyMode } = usePrivacyMode();
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<GroupInfo | null>(null);

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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 size={40} className="text-[#07c160] animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="dk-text text-3xl sm:text-5xl font-black tracking-tight text-[#1d1d1f] mb-1">群聊画像</h1>
          <p className="text-gray-400 text-sm">{groups.length} 个群聊</p>
        </div>
        <div className="relative w-full sm:w-64">
          <input
            type="text"
            placeholder="搜索群聊..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="dk-input w-full pl-4 pr-4 py-2.5 bg-white border border-gray-200 rounded-2xl text-sm focus:outline-none focus:border-[#07c160]"
          />
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 gap-4">
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
      </div>

      {/* 群列表 */}
      <div className="dk-card bg-white dk-border border border-gray-100 rounded-2xl overflow-hidden">
        <div className="dk-thead bg-[#f8f9fb] dk-border border-b border-gray-100 px-5 py-3 hidden sm:grid grid-cols-[auto_1fr_auto_auto_auto] gap-4 text-xs font-black text-gray-500 uppercase">
          <div />
          <div>群名</div>
          <div className="text-right w-24">消息数</div>
          <div className="text-right w-28">最后消息</div>
          <div className="w-6" />
        </div>

        <div className="divide-y dk-divide divide-gray-100">
          {filtered.map((group) => (
            <div
              key={group.username}
              onClick={() => setSelected(group)}
              className="dk-row-hover flex items-center gap-4 px-5 py-4 hover:bg-[#f8f9fb] cursor-pointer transition-colors"
            >
              {group.small_head_url ? (
                <img src={group.small_head_url} alt="" className="w-10 h-10 rounded-xl object-cover flex-shrink-0"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              ) : (
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#10aeff] to-[#0e8dd6] flex items-center justify-center text-white flex-shrink-0">
                  <Users size={18} strokeWidth={2} />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className={`dk-text font-bold text-[#1d1d1f] truncate${privacyMode ? ' privacy-blur' : ''}`}>{group.name}</div>
                <div className="text-xs text-gray-400 mt-0.5 sm:hidden">{group.total_messages.toLocaleString()} 条 · {group.last_message_time}</div>
              </div>
              <div className="hidden sm:block text-right w-24">
                <span className="font-bold dk-text text-[#1d1d1f]">{group.total_messages.toLocaleString()}</span>
              </div>
              <div className="hidden sm:block text-right w-36 text-xs text-gray-400 leading-5">
                {group.first_message_time && <div>始于 {group.first_message_time}</div>}
                <div>最近 {group.last_message_time}</div>
              </div>
              <ChevronRight size={16} className="text-gray-300 flex-shrink-0" />
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="text-center py-16 text-gray-300 font-semibold">无匹配群聊</div>
          )}
        </div>
      </div>

      {selected && (
        <GroupDetailModal
          group={selected}
          onClose={() => setSelected(null)}
          allContacts={allContacts}
          onContactClick={(c) => { setSelected(null); onContactClick(c); }}
          onBlock={onBlockGroup ? (u) => { onBlockGroup(u); setSelected(null); } : undefined}
        />
      )}
    </div>
  );
};
