/**
 * 季度视图 — 3 个月一页横向滑动（原默认视图）
 */

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Hourglass } from 'lucide-react';
import {
  WEEKDAYS, MONTH_NAMES, EMPTY_CELL_CLASS,
  heatColor, isoDate, daysInMonth, firstWeekday, dateKey,
  type CalendarViewProps,
} from './calendarUtils';

// ─── 单月网格 ────────────────────────────────────────────────────────────────

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
  const cells: (number | null)[] = [
    ...Array(offset).fill(null),
    ...Array.from({ length: total }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const todayStr = isoDate(new Date());

  return (
    <div className="flex-1 min-w-0">
      <div className="text-sm font-black text-[#1d1d1f] dark:text-white mb-2 text-center">
        {MONTH_NAMES[month]}
      </div>
      <div className="grid grid-cols-7 gap-px">
        {WEEKDAYS.map(d => (
          <div key={d} className="text-center text-[10px] font-bold text-gray-400 py-1">{d}</div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`e-${i}`} className="h-7" />;
          const ds = dateKey(year, month, day);
          const count = heatmap[ds] || 0;
          const isSelected = ds === selectedDate;
          const isToday = ds === todayStr;
          const color = heatColor(count, maxVal);
          return (
            <button
              key={ds}
              type="button"
              onClick={() => onDayClick(ds)}
              aria-label={`${ds}，${count} 条消息${isToday ? '，今天' : ''}`}
              aria-pressed={isSelected}
              title={`${ds}  ${count} 条`}
              className={`
                h-7 rounded text-[11px] font-semibold transition-all duration-100
                flex items-center justify-center
                focus:outline-none focus-visible:ring-2 focus-visible:ring-[#07c160]
                ${color ? '' : EMPTY_CELL_CLASS}
                ${isSelected ? 'ring-2 ring-[#07c160] ring-offset-1 z-10' : 'hover:opacity-75'}
                ${isToday && !isSelected ? 'ring-1 ring-gray-400' : ''}
              `}
              style={color ? { backgroundColor: color } : undefined}
            >
              <span className={count > 0 ? 'text-gray-800 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'}>{day}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

// ─── Quarterly 主体 ──────────────────────────────────────────────────────────

export const QuarterlyView: React.FC<CalendarViewProps> = ({ heatmap, selectedDate, onDayClick, onRangeChange }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [currentGroupIdx, setCurrentGroupIdx] = useState(0);

  // 从 heatmap 推出所有月份
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

  const monthGroups = useMemo(() => {
    const groups: { year: number; month: number }[][] = [];
    for (let i = 0; i < allMonths.length; i += 3) {
      groups.push(allMonths.slice(i, i + 3));
    }
    return groups;
  }, [allMonths]);

  // 默认滚到最后一组（最新）
  useEffect(() => {
    if (!monthGroups.length) return;
    const lastIdx = monthGroups.length - 1;
    setCurrentGroupIdx(lastIdx);
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollLeft = el.scrollWidth;
    });
  }, [monthGroups.length]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !monthGroups.length) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    setCurrentGroupIdx(Math.max(0, Math.min(idx, monthGroups.length - 1)));
  }, [monthGroups.length]);

  const goPrev = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: el.scrollLeft - el.clientWidth, behavior: 'smooth' });
  }, []);
  const goNext = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: el.scrollLeft + el.clientWidth, behavior: 'smooth' });
  }, []);

  const currentGroup = monthGroups[currentGroupIdx] || [];

  const [rangeStart, rangeEnd] = useMemo(() => {
    if (!currentGroup.length) return ['', ''];
    const first = currentGroup[0];
    const last = currentGroup[currentGroup.length - 1];
    return [
      dateKey(first.year, first.month, 1),
      dateKey(last.year, last.month, daysInMonth(last.year, last.month)),
    ];
  }, [currentGroup]);

  const maxVal = useMemo(() => {
    let max = 1;
    for (const [d, c] of Object.entries(heatmap)) {
      if (d >= rangeStart && d <= rangeEnd && c > max) max = c;
    }
    return max;
  }, [heatmap, rangeStart, rangeEnd]);

  const navLabel = useMemo(() => {
    if (!currentGroup.length) return '';
    const first = currentGroup[0];
    const last = currentGroup[currentGroup.length - 1];
    if (first.year === last.year) {
      return `${first.year}年 ${MONTH_NAMES[first.month]} — ${MONTH_NAMES[last.month]}`;
    }
    return `${first.year}年${MONTH_NAMES[first.month]} — ${last.year}年${MONTH_NAMES[last.month]}`;
  }, [currentGroup]);

  // 上报范围给父组件（用于折线图标题/范围）
  useEffect(() => {
    if (!rangeStart || !onRangeChange) return;
    onRangeChange({ label: navLabel, from: rangeStart, to: rangeEnd });
  }, [navLabel, rangeStart, rangeEnd, onRangeChange]);

  // 被选中的日期若不在当前组，自动翻页到对应组（比如「去年今天」跳转）
  useEffect(() => {
    if (!selectedDate || !monthGroups.length) return;
    const [y, m] = selectedDate.split('-').map(Number);
    const targetIdx = monthGroups.findIndex(g => g.some(mm => mm.year === y && mm.month === m - 1));
    if (targetIdx >= 0 && targetIdx !== currentGroupIdx) {
      setCurrentGroupIdx(targetIdx);
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el) el.scrollTo({ left: targetIdx * el.clientWidth, behavior: 'smooth' });
      });
    }
  }, [selectedDate]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="dk-card bg-white dark:bg-[#1c1c1e] border border-gray-100 dark:border-white/10 rounded-3xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={goPrev}
          disabled={currentGroupIdx === 0}
          aria-label="上一组月份"
          className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 transition-colors disabled:opacity-20"
        >
          <ChevronLeft size={18} className="text-gray-500" />
        </button>
        <div className="flex items-center gap-2">
          <Hourglass size={15} className="text-[#07c160]" strokeWidth={2.5} />
          <span className="font-black text-base text-[#1d1d1f] dark:text-white">{navLabel}</span>
        </div>
        <button
          type="button"
          onClick={goNext}
          disabled={currentGroupIdx >= monthGroups.length - 1}
          aria-label="下一组月份"
          className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 transition-colors disabled:opacity-20"
        >
          <ChevronRight size={18} className="text-gray-500" />
        </button>
      </div>

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
                  onDayClick={onDayClick}
                />
              ))}
              {group.length < 3 && Array.from({ length: 3 - group.length }).map((_, k) => (
                <div key={`empty-${k}`} className="flex-1" />
              ))}
            </div>
          ))}
        </div>
      </div>

      {monthGroups.length > 1 && (
        <div className="flex gap-1 flex-wrap mt-4">
          {monthGroups.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => scrollRef.current?.scrollTo({ left: i * (scrollRef.current.clientWidth), behavior: 'smooth' })}
              aria-label={`跳到第 ${i + 1} 组月份`}
              aria-current={i === currentGroupIdx ? 'true' : undefined}
              className={`rounded-full transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#07c160] ${i === currentGroupIdx ? 'w-4 h-1.5 bg-[#07c160]' : 'w-1.5 h-1.5 bg-gray-200 dark:bg-white/20'}`}
            />
          ))}
        </div>
      )}
    </div>
  );
};
