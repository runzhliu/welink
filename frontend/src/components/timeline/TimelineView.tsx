/**
 * 认识时间线 — 垂直河流时间线，按月展开认识的人
 */

import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { Users, Play, Pause, ChevronUp } from 'lucide-react';
import type { ContactStats } from '../../types';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';
import { avatarSrc } from '../../utils/avatar';

interface Props {
  contacts: ContactStats[];
  onContactClick?: (contact: ContactStats) => void;
}

/** 月份节点数据 */
interface MonthNode {
  month: string;               // YYYY-MM
  label: string;               // "N 月"
  year: string;                // "YYYY"
  contacts: ContactStats[];    // 当月新认识的人
  cumulative: number;          // 截止该月累计人数
}

export const TimelineView: React.FC<Props> = ({ contacts, onContactClick }) => {
  const { privacyMode } = usePrivacyMode();
  const scrollRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [playing, setPlaying] = useState(false);
  const [playIdx, setPlayIdx] = useState(-1);
  const [showBackTop, setShowBackTop] = useState(false);

  // 过滤有效联系人
  const validContacts = useMemo(() =>
    contacts
      .filter(c => c.first_message_time && c.first_message_time !== '-' && c.total_messages > 0)
      .sort((a, b) => a.first_message_time.localeCompare(b.first_message_time)),
    [contacts]
  );

  // 按月分组，生成完整月份序列（含空月）
  const { nodes, years } = useMemo(() => {
    if (validContacts.length === 0) return { nodes: [] as MonthNode[], years: [] as string[] };

    const min = validContacts[0].first_message_time.slice(0, 7);
    const max = validContacts[validContacts.length - 1].first_message_time.slice(0, 7);

    // 按月分组
    const byMonth = new Map<string, ContactStats[]>();
    for (const c of validContacts) {
      const m = c.first_message_time.slice(0, 7);
      if (!byMonth.has(m)) byMonth.set(m, []);
      byMonth.get(m)!.push(c);
    }

    // 生成所有月份
    const result: MonthNode[] = [];
    let cur = min;
    let cumulative = 0;
    while (cur <= max) {
      const [y, m] = cur.split('-').map(Number);
      const monthContacts = byMonth.get(cur) ?? [];
      cumulative += monthContacts.length;
      // 按消息量降序排列当月联系人
      monthContacts.sort((a, b) => b.total_messages - a.total_messages);
      result.push({
        month: cur,
        label: `${m} 月`,
        year: String(y),
        contacts: monthContacts,
        cumulative,
      });
      const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
      cur = next;
    }

    const yearSet = Array.from(new Set(result.map(n => n.year)));
    return { nodes: result, years: yearSet };
  }, [validContacts]);

  // 有内容的月份节点（用于播放跳转）
  const activeNodes = useMemo(() =>
    nodes.filter(n => n.contacts.length > 0),
    [nodes]
  );

  // 播放动画：单一 interval 驱动，每 1.2s 推进一步
  useEffect(() => {
    if (!playing) return;

    // 首帧立即跳到第 0 个
    const first = activeNodes[0];
    if (first) {
      setPlayIdx(0);
      const el = nodeRefs.current.get(first.month);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    const id = setInterval(() => {
      setPlayIdx(prev => {
        const next = prev + 1;
        if (next >= activeNodes.length) {
          setPlaying(false);
          clearInterval(id);
          return prev;
        }
        const node = activeNodes[next];
        const el = nodeRefs.current.get(node.month);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return next;
      });
    }, 1200);

    return () => clearInterval(id);
  }, [playing, activeNodes]);

  // 回到顶部按钮
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const onScroll = () => setShowBackTop(container.scrollTop > 400);
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, []);

  const handlePlay = useCallback(() => {
    if (playing) {
      setPlaying(false);
      return;
    }
    setPlayIdx(-1);
    setPlaying(true);
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [playing]);

  const scrollToYear = useCallback((year: string) => {
    const node = nodes.find(n => n.year === year && n.contacts.length > 0)
      ?? nodes.find(n => n.year === year);
    if (node) {
      const el = nodeRefs.current.get(node.month);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [nodes]);

  const setNodeRef = useCallback((month: string, el: HTMLDivElement | null) => {
    if (el) nodeRefs.current.set(month, el);
    else nodeRefs.current.delete(month);
  }, []);

  // 头像大小根据消息量缩放 (48~80px)
  const avatarSize = useCallback((totalMessages: number) => {
    const min = 44, max = 72;
    const msgMin = 10, msgMax = 5000;
    const clamped = Math.max(msgMin, Math.min(msgMax, totalMessages));
    const ratio = Math.log(clamped / msgMin) / Math.log(msgMax / msgMin);
    return Math.round(min + ratio * (max - min));
  }, []);

  if (validContacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-gray-300 dark:text-gray-600">
        <Users size={48} className="mb-4" />
        <p className="font-semibold">暂无聊天记录</p>
      </div>
    );
  }

  // 按年分组渲染（空月折叠）
  const groupedByYear = years.map(year => ({
    year,
    months: nodes.filter(n => n.year === year),
  }));

  return (
    <div className="max-w-3xl relative">
      {/* 标题 + 控制栏 */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="dk-text text-3xl sm:text-5xl font-black tracking-tight text-[#1d1d1f] mb-1">认识时间线</h1>
            <p className="text-gray-400 text-sm">
              你的社交旅程，共认识了
              <span className="font-bold text-[#1d1d1f] dk-text mx-1">{validContacts.length}</span>
              位联系人
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* 播放按钮 */}
            <button
              onClick={handlePlay}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all
                bg-[#07c160] text-white hover:bg-[#06ad56] shadow-sm"
            >
              {playing ? <Pause size={14} /> : <Play size={14} />}
              {playing ? '暂停' : '播放回忆'}
            </button>
          </div>
        </div>

        {/* 年份快速跳转 */}
        <div className="flex flex-wrap gap-1.5 mt-4">
          {years.map(year => {
            const count = nodes.filter(n => n.year === year).reduce((s, n) => s + n.contacts.length, 0);
            return (
              <button
                key={year}
                onClick={() => scrollToYear(year)}
                className="px-2.5 py-1 rounded-full text-xs font-bold transition-all
                  bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400
                  hover:bg-[#e7f8f0] hover:text-[#07c160] dark:hover:bg-[#07c160]/20"
              >
                {year}
                {count > 0 && <span className="ml-1 text-gray-300 dark:text-gray-600">+{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* 垂直时间线 */}
      <div ref={scrollRef} className="relative overflow-y-auto" style={{ maxHeight: 'calc(100vh - 220px)' }}>
        {groupedByYear.map(({ year, months }) => (
          <div key={year} className="relative">
            {/* 年份标记 */}
            <div className="sticky top-0 z-10 flex items-center gap-3 py-3 bg-[var(--bg-page)]">
              <div className="text-2xl font-black text-[#07c160]">{year}</div>
              <div className="flex-1 h-px bg-[#07c160]/20" />
              <div className="text-xs text-gray-400">
                +{months.reduce((s, n) => s + n.contacts.length, 0)} 人
              </div>
            </div>

            {/* 月份列表 */}
            <div className="relative ml-4 border-l-2 border-gray-200 dark:border-gray-700 pl-6 pb-4">
              {months.map(node => {
                const isEmpty = node.contacts.length === 0;
                const isPlayHighlight = playing && activeNodes[playIdx]?.month === node.month;

                if (isEmpty) {
                  // 空月份折叠为小圆点
                  return (
                    <div
                      key={node.month}
                      ref={el => setNodeRef(node.month, el)}
                      className="relative py-1"
                    >
                      <div className="absolute -left-[31px] top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-gray-200 dark:bg-gray-700" />
                      <span className="text-[10px] text-gray-300 dark:text-gray-600">{node.label}</span>
                    </div>
                  );
                }

                return (
                  <div
                    key={node.month}
                    ref={el => setNodeRef(node.month, el)}
                    className={`relative py-4 transition-all duration-500 ${
                      isPlayHighlight ? 'scale-[1.01]' : ''
                    }`}
                  >
                    {/* 时间线节点圆点 — 大小按人数 */}
                    <div
                      className={`absolute -left-[31px] top-6 -translate-y-1/2 rounded-full transition-all duration-300 ${
                        isPlayHighlight
                          ? 'bg-[#07c160] shadow-lg shadow-green-200 dark:shadow-green-900'
                          : 'bg-[#07c160]'
                      }`}
                      style={{
                        width: Math.min(16, 8 + node.contacts.length * 2),
                        height: Math.min(16, 8 + node.contacts.length * 2),
                        marginLeft: -(Math.min(16, 8 + node.contacts.length * 2) - 10) / 2,
                        marginTop: -(Math.min(16, 8 + node.contacts.length * 2) - 10) / 2,
                      }}
                    />

                    {/* 月份卡片 */}
                    <div className={`dk-card bg-white dk-border border border-gray-100 rounded-2xl p-4 shadow-sm transition-all duration-300 ${
                      isPlayHighlight ? 'ring-2 ring-[#07c160]/40 shadow-md' : ''
                    }`}>
                      {/* 月份标题行 */}
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-black text-[#1d1d1f] dk-text">{node.label}</span>
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[#e7f8f0] dark:bg-[#07c160]/20 text-[#07c160]">
                            +{node.contacts.length} 人
                          </span>
                        </div>
                        <span className="text-[10px] text-gray-300 dark:text-gray-600">
                          累计 {node.cumulative} 人
                        </span>
                      </div>

                      {/* 联系人列表 */}
                      <div className="space-y-2.5">
                        {node.contacts.map(contact => {
                          const name = contact.remark || contact.nickname || contact.username;
                          const avatarUrl = contact.small_head_url || contact.big_head_url;
                          const size = avatarSize(contact.total_messages);
                          const firstMsg = contact.first_msg;

                          return (
                            <button
                              key={contact.username}
                              onClick={() => onContactClick?.(contact)}
                              className="flex items-center gap-3 w-full text-left group rounded-xl p-2 -mx-2
                                hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                            >
                              {/* 头像 */}
                              <div
                                className="rounded-2xl overflow-hidden flex-shrink-0 shadow-sm
                                  group-hover:ring-2 group-hover:ring-[#07c160]/40 group-hover:ring-offset-1
                                  transition-all duration-200"
                                style={{ width: size, height: size }}
                              >
                                {avatarUrl ? (
                                  <img
                                    src={avatarSrc(avatarUrl)}
                                    alt={name}
                                    className="w-full h-full object-cover"
                                    onError={e => {
                                      const el = e.target as HTMLImageElement;
                                      el.style.display = 'none';
                                      el.parentElement!.classList.add('bg-gradient-to-br', 'from-[#07c160]', 'to-[#06ad56]');
                                    }}
                                  />
                                ) : (
                                  <div className="w-full h-full bg-gradient-to-br from-[#07c160] to-[#06ad56] flex items-center justify-center text-white font-black"
                                    style={{ fontSize: size * 0.36 }}>
                                    {[...name][0]}
                                  </div>
                                )}
                              </div>

                              {/* 信息 */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className={`text-sm font-bold text-[#1d1d1f] dk-text truncate ${
                                    privacyMode ? 'privacy-blur' : ''
                                  }`}>
                                    {name}
                                  </span>
                                  <span className="text-[10px] text-gray-300 dark:text-gray-600 flex-shrink-0">
                                    {contact.first_message_time.slice(5, 10)}
                                  </span>
                                </div>
                                {firstMsg && (
                                  <p className={`text-xs text-gray-400 mt-0.5 truncate ${
                                    privacyMode ? 'privacy-blur' : ''
                                  }`}>
                                    {firstMsg}
                                  </p>
                                )}
                                <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-300 dark:text-gray-600">
                                  <span>共 {contact.total_messages.toLocaleString()} 条消息</span>
                                  {contact.last_message_time && contact.last_message_time !== '-' && (
                                    <span>最近 {contact.last_message_time.slice(0, 10)}</span>
                                  )}
                                </div>
                              </div>

                              {/* 消息量指示条 */}
                              <div className="flex-shrink-0 w-16 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-[#07c160] rounded-full"
                                  style={{
                                    width: `${Math.min(100, Math.max(5, Math.log10(contact.total_messages + 1) / Math.log10(50000) * 100))}%`,
                                  }}
                                />
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* 终点标记 */}
        <div className="ml-4 pl-6 pb-8 border-l-2 border-gray-200 dark:border-gray-700">
          <div className="absolute -left-0.5 bottom-8 w-4 h-4 rounded-full bg-[#07c160] border-4 border-white dark:border-[var(--bg-page)]" />
          <div className="text-center py-6 text-sm text-gray-400">
            故事还在继续...
          </div>
        </div>
      </div>

      {/* 回到顶部 */}
      {showBackTop && (
        <button
          onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-6 right-6 w-10 h-10 rounded-full bg-white dark:bg-gray-800
            shadow-lg border border-gray-100 dark:border-gray-700
            flex items-center justify-center text-gray-400 hover:text-[#07c160] transition-colors z-20"
        >
          <ChevronUp size={20} />
        </button>
      )}
    </div>
  );
};
