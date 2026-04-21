/**
 * 单月视图 — iOS 日历风，格子大，带消息数展示。
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Hourglass } from 'lucide-react';
import {
  WEEKDAYS, MONTH_NAMES, EMPTY_CELL_CLASS,
  heatColor, isoDate, daysInMonth, firstWeekday, dateKey,
  type CalendarViewProps,
} from './calendarUtils';

export const MonthView: React.FC<CalendarViewProps> = ({ heatmap, selectedDate, onDayClick, onRangeChange }) => {
  // 默认当前月；若 selectedDate 存在则跳到该月
  const [ym, setYm] = useState(() => {
    if (selectedDate) {
      const [y, m] = selectedDate.split('-').map(Number);
      return { year: y, month: m - 1 };
    }
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  // 外部切换 selectedDate 到其他月份时，跳过去
  useEffect(() => {
    if (!selectedDate) return;
    const [y, m] = selectedDate.split('-').map(Number);
    if (y !== ym.year || m - 1 !== ym.month) setYm({ year: y, month: m - 1 });
  }, [selectedDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = daysInMonth(ym.year, ym.month);
  const offset = firstWeekday(ym.year, ym.month);
  const cells: (number | null)[] = [
    ...Array(offset).fill(null),
    ...Array.from({ length: total }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const todayStr = isoDate(new Date());

  // 当前月最大值（颜色归一化）
  const maxVal = useMemo(() => {
    let max = 1;
    for (let d = 1; d <= total; d++) {
      const ds = dateKey(ym.year, ym.month, d);
      const c = heatmap[ds] || 0;
      if (c > max) max = c;
    }
    return max;
  }, [heatmap, ym, total]);

  const label = `${ym.year}年 ${MONTH_NAMES[ym.month]}`;

  useEffect(() => {
    onRangeChange?.({
      label,
      from: dateKey(ym.year, ym.month, 1),
      to: dateKey(ym.year, ym.month, total),
    });
  }, [label, ym, total, onRangeChange]);

  const prevMonth = () =>
    setYm(p => p.month === 0 ? { year: p.year - 1, month: 11 } : { year: p.year, month: p.month - 1 });
  const nextMonth = () =>
    setYm(p => p.month === 11 ? { year: p.year + 1, month: 0 } : { year: p.year, month: p.month + 1 });

  const monthTotal = useMemo(() => {
    let sum = 0;
    for (let d = 1; d <= total; d++) sum += heatmap[dateKey(ym.year, ym.month, d)] || 0;
    return sum;
  }, [heatmap, ym, total]);

  return (
    <div className="dk-card bg-white dark:bg-[#1c1c1e] border border-gray-100 dark:border-white/10 rounded-3xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={prevMonth}
          aria-label="上一月"
          className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
        >
          <ChevronLeft size={18} className="text-gray-500" />
        </button>
        <div className="flex items-center gap-2">
          <Hourglass size={15} className="text-[#07c160]" strokeWidth={2.5} />
          <span className="font-black text-base text-[#1d1d1f] dark:text-white">{label}</span>
          <span className="text-[11px] text-gray-400 font-semibold">· {monthTotal.toLocaleString()} 条</span>
        </div>
        <button
          type="button"
          onClick={nextMonth}
          aria-label="下一月"
          className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
        >
          <ChevronRight size={18} className="text-gray-500" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1.5 mb-1.5">
        {WEEKDAYS.map(d => (
          <div key={d} className="text-center text-[11px] font-bold text-gray-400 pb-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((day, i) => {
          if (day === null) return <div key={`e-${i}`} className="aspect-square" />;
          const ds = dateKey(ym.year, ym.month, day);
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
              className={`
                aspect-square rounded-2xl flex flex-col items-center justify-center gap-0.5 relative
                transition-all duration-150
                focus:outline-none focus-visible:ring-2 focus-visible:ring-[#07c160]
                ${color ? '' : EMPTY_CELL_CLASS}
                ${isSelected ? 'ring-2 ring-[#07c160] ring-offset-1 z-10 scale-105' : 'hover:scale-105 hover:shadow-sm'}
                ${isToday && !isSelected ? 'ring-1 ring-gray-400 dark:ring-gray-500' : ''}
              `}
              style={color ? { backgroundColor: color } : undefined}
            >
              <span className={`text-sm sm:text-base font-black ${count > 0 ? 'text-gray-800 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'}`}>
                {day}
              </span>
              {count > 0 && (
                <span className="text-[9px] sm:text-[10px] font-bold text-gray-700 dark:text-gray-200/80 leading-none">
                  {count > 999 ? '999+' : count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
