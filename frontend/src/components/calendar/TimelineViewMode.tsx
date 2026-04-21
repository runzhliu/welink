/**
 * 认识时间线 —— 作为时光机第 4 种视图存在，按月展开认识的人。
 *
 * 与原 TimelineView（独立 tab）的区别：
 *   - 无标题/副标题（外层 ChatCalendarPage 已有 h1）
 *   - 不创建自己的 overflow 容器，依赖外层左栏的滚动
 *   - 回到顶部按钮用 IntersectionObserver 侦测可见性，scrollIntoView 到顶
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Users, Play, Pause, ChevronUp } from 'lucide-react';
import type { ContactStats } from '../../types';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';
import { avatarSrc } from '../../utils/avatar';

interface Props {
  contacts: ContactStats[];
  onContactClick?: (contact: ContactStats) => void;
}

interface MonthNode {
  month: string;               // YYYY-MM
  label: string;               // "N 月"
  year: string;                // "YYYY"
  contacts: ContactStats[];
  cumulative: number;
}

export const TimelineViewMode: React.FC<Props> = ({ contacts, onContactClick }) => {
  const { privacyMode } = usePrivacyMode();
  const topRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [playing, setPlaying] = useState(false);
  const [playIdx, setPlayIdx] = useState(-1);
  const [showBackTop, setShowBackTop] = useState(false);

  const validContacts = useMemo(() =>
    contacts
      .filter(c => c.first_message_time && c.first_message_time !== '-' && c.total_messages > 0)
      .sort((a, b) => a.first_message_time.localeCompare(b.first_message_time)),
    [contacts],
  );

  const { nodes, years } = useMemo(() => {
    if (validContacts.length === 0) return { nodes: [] as MonthNode[], years: [] as string[] };
    const min = validContacts[0].first_message_time.slice(0, 7);
    const max = validContacts[validContacts.length - 1].first_message_time.slice(0, 7);

    const byMonth = new Map<string, ContactStats[]>();
    for (const c of validContacts) {
      const m = c.first_message_time.slice(0, 7);
      if (!byMonth.has(m)) byMonth.set(m, []);
      byMonth.get(m)!.push(c);
    }

    const result: MonthNode[] = [];
    let cur = min;
    let cumulative = 0;
    while (cur <= max) {
      const [y, m] = cur.split('-').map(Number);
      const monthContacts = byMonth.get(cur) ?? [];
      cumulative += monthContacts.length;
      monthContacts.sort((a, b) => b.total_messages - a.total_messages);
      result.push({
        month: cur,
        label: `${m} 月`,
        year: String(y),
        contacts: monthContacts,
        cumulative,
      });
      cur = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    }

    const yearSet = Array.from(new Set(result.map(n => n.year)));
    return { nodes: result, years: yearSet };
  }, [validContacts]);

  const activeNodes = useMemo(() => nodes.filter(n => n.contacts.length > 0), [nodes]);

  // 播放动画
  useEffect(() => {
    if (!playing) return;
    const first = activeNodes[0];
    if (first) {
      setPlayIdx(0);
      nodeRefs.current.get(first.month)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    const id = setInterval(() => {
      setPlayIdx(prev => {
        const next = prev + 1;
        if (next >= activeNodes.length) {
          setPlaying(false);
          clearInterval(id);
          return prev;
        }
        nodeRefs.current.get(activeNodes[next].month)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return next;
      });
    }, 1200);
    return () => clearInterval(id);
  }, [playing, activeNodes]);

  // 顶部 sentinel 可见性 → 回到顶部按钮
  useEffect(() => {
    if (!topRef.current) return;
    const obs = new IntersectionObserver(
      entries => setShowBackTop(!entries[0].isIntersecting),
      { threshold: 0 },
    );
    obs.observe(topRef.current);
    return () => obs.disconnect();
  }, []);

  const handlePlay = useCallback(() => {
    if (playing) { setPlaying(false); return; }
    setPlayIdx(-1);
    setPlaying(true);
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [playing]);

  const scrollToYear = useCallback((year: string) => {
    const node = nodes.find(n => n.year === year && n.contacts.length > 0)
      ?? nodes.find(n => n.year === year);
    if (node) {
      nodeRefs.current.get(node.month)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [nodes]);

  const setNodeRef = useCallback((month: string, el: HTMLDivElement | null) => {
    if (el) nodeRefs.current.set(month, el);
    else nodeRefs.current.delete(month);
  }, []);

  // 头像大小按消息量缩放（对数，44-72px）
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

  const groupedByYear = years.map(year => ({
    year,
    months: nodes.filter(n => n.year === year),
  }));

  return (
    <div className="relative">
      {/* 顶部 sentinel + 控制栏 */}
      <div ref={topRef} />
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <p className="text-gray-400 text-sm">
          共认识了
          <span className="font-bold text-[#1d1d1f] dk-text mx-1">{validContacts.length}</span>
          位联系人
        </p>
        <button
          type="button"
          onClick={handlePlay}
          aria-label={playing ? '暂停' : '播放回忆'}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all
            bg-[#07c160] text-white hover:bg-[#06ad56] shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#07c160] focus-visible:ring-offset-1"
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
          {playing ? '暂停' : '播放回忆'}
        </button>
      </div>

      {/* 年份快速跳转 */}
      <div className="flex flex-wrap gap-1.5 mb-5">
        {years.map(year => {
          const count = nodes.filter(n => n.year === year).reduce((s, n) => s + n.contacts.length, 0);
          return (
            <button
              key={year}
              type="button"
              onClick={() => scrollToYear(year)}
              aria-label={`跳到 ${year} 年`}
              className="px-2.5 py-1 rounded-full text-xs font-bold transition-all
                bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-gray-400
                hover:bg-[#e7f8f0] hover:text-[#07c160] dark:hover:bg-[#07c160]/20
                focus:outline-none focus-visible:ring-2 focus-visible:ring-[#07c160]"
            >
              {year}
              {count > 0 && <span className="ml-1 text-gray-300 dark:text-gray-600">+{count}</span>}
            </button>
          );
        })}
      </div>

      {/* 年份 → 月份 → 联系人 */}
      {groupedByYear.map(({ year, months }) => (
        <div key={year} className="relative">
          <div className="sticky top-0 z-10 flex items-center gap-3 py-3 bg-[var(--bg-page)] dark:bg-[#0f0f10]">
            <div className="text-2xl font-black text-[#07c160]">{year}</div>
            <div className="flex-1 h-px bg-[#07c160]/20" />
            <div className="text-xs text-gray-400">
              +{months.reduce((s, n) => s + n.contacts.length, 0)} 人
            </div>
          </div>

          <div className="relative ml-4 border-l-2 border-gray-200 dark:border-white/10 pl-6 pb-4">
            {months.map(node => {
              const isEmpty = node.contacts.length === 0;
              const isPlayHighlight = playing && activeNodes[playIdx]?.month === node.month;

              if (isEmpty) {
                return (
                  <div
                    key={node.month}
                    ref={el => setNodeRef(node.month, el)}
                    className="relative py-1"
                  >
                    <div className="absolute -left-[31px] top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-gray-200 dark:bg-white/10" />
                    <span className="text-[10px] text-gray-300 dark:text-gray-600">{node.label}</span>
                  </div>
                );
              }

              const dotSize = Math.min(16, 8 + node.contacts.length * 2);
              return (
                <div
                  key={node.month}
                  ref={el => setNodeRef(node.month, el)}
                  className={`relative py-4 transition-all duration-500 ${isPlayHighlight ? 'scale-[1.01]' : ''}`}
                >
                  <div
                    className={`absolute -left-[31px] top-6 -translate-y-1/2 rounded-full transition-all duration-300 bg-[#07c160] ${
                      isPlayHighlight ? 'shadow-lg shadow-green-200 dark:shadow-green-900' : ''
                    }`}
                    style={{
                      width: dotSize,
                      height: dotSize,
                      marginLeft: -(dotSize - 10) / 2,
                      marginTop: -(dotSize - 10) / 2,
                    }}
                  />

                  <div className={`dk-card bg-white dark:bg-[#1c1c1e] border border-gray-100 dark:border-white/10 rounded-2xl p-4 shadow-sm transition-all duration-300 ${
                    isPlayHighlight ? 'ring-2 ring-[#07c160]/40 shadow-md' : ''
                  }`}>
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

                    <div className="space-y-2.5">
                      {node.contacts.map(contact => {
                        const name = contact.remark || contact.nickname || contact.username;
                        const avatarUrl = contact.small_head_url || contact.big_head_url;
                        const size = avatarSize(contact.total_messages);
                        const firstMsg = contact.first_msg;
                        return (
                          <button
                            key={contact.username}
                            type="button"
                            onClick={() => onContactClick?.(contact)}
                            aria-label={`打开 ${name}`}
                            className="flex items-center gap-3 w-full text-left group rounded-xl p-2 -mx-2
                              hover:bg-gray-50 dark:hover:bg-white/5 transition-colors focus:outline-none focus-visible:bg-gray-50 dark:focus-visible:bg-white/5"
                          >
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

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className={`text-sm font-bold text-[#1d1d1f] dk-text truncate ${privacyMode ? 'privacy-blur' : ''}`}>
                                  {name}
                                </span>
                                <span className="text-[10px] text-gray-300 dark:text-gray-600 flex-shrink-0">
                                  {contact.first_message_time.slice(5, 10)}
                                </span>
                              </div>
                              {firstMsg && (
                                <p className={`text-xs text-gray-400 mt-0.5 truncate ${privacyMode ? 'privacy-blur' : ''}`}>
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

                            <div className="flex-shrink-0 w-16 h-1.5 bg-gray-100 dark:bg-white/10 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-[#07c160] rounded-full"
                                style={{ width: `${Math.min(100, Math.max(5, Math.log10(contact.total_messages + 1) / Math.log10(50000) * 100))}%` }}
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
      <div className="ml-4 pl-6 pb-8 border-l-2 border-gray-200 dark:border-white/10">
        <div className="absolute -left-0.5 bottom-8 w-4 h-4 rounded-full bg-[#07c160] border-4 border-white dark:border-[#0f0f10]" />
        <div className="text-center py-6 text-sm text-gray-400">
          故事还在继续...
        </div>
      </div>

      {/* 回到顶部 */}
      {showBackTop && (
        <button
          type="button"
          onClick={() => topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          aria-label="回到顶部"
          className="fixed bottom-6 right-6 w-10 h-10 rounded-full bg-white dark:bg-[#2c2c2e]
            shadow-lg border border-gray-100 dark:border-white/10
            flex items-center justify-center text-gray-400 hover:text-[#07c160] transition-colors z-20"
        >
          <ChevronUp size={20} />
        </button>
      )}
    </div>
  );
};
