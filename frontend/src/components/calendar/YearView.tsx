/**
 * 年度视图 — GitHub 贡献图风，52 周 × 7 天横向一长条。
 *   - 列 = 周，行 = 周一 → 周日
 *   - 月标签显示在每个月第一周之上
 *   - 年份可切换（prev/next）
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Hourglass } from 'lucide-react';
import {
  MONTH_NAMES, EMPTY_CELL_CLASS,
  heatColor, isoDate,
  type CalendarViewProps,
} from './calendarUtils';

const WEEKDAY_LABELS = ['一', '三', '五']; // 只显示 1/3/5 行，节省空间（GitHub 同款）

export const YearView: React.FC<CalendarViewProps> = ({ heatmap, selectedDate, onDayClick, onRangeChange }) => {
  // 默认 = 当前年；若 selectedDate 存在则以 selectedDate 的年为准
  const [year, setYear] = useState(() => {
    if (selectedDate) return parseInt(selectedDate.slice(0, 4));
    return new Date().getFullYear();
  });

  useEffect(() => {
    if (!selectedDate) return;
    const y = parseInt(selectedDate.slice(0, 4));
    if (y !== year) setYear(y);
  }, [selectedDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // 数据中包含哪些年（用于禁用 prev/next）
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    Object.keys(heatmap).forEach(d => years.add(parseInt(d.slice(0, 4))));
    const list = [...years].sort((a, b) => a - b);
    // 即便 heatmap 是空的，也保留当前年作为可选
    if (list.length === 0) list.push(new Date().getFullYear());
    return list;
  }, [heatmap]);

  // 构造 52-53 列 × 7 行的扁平数组（每列一周，从周一到周日）
  // 从 Jan 1 所在周的周一开始，到 Dec 31 所在周的周日结束
  interface Cell { date: Date; dateStr: string | null; count: number; inYear: boolean; }

  const { weeks, monthPositions, maxVal } = useMemo(() => {
    const start = new Date(year, 0, 1);
    // 调整到 Monday（getDay：0=周日, 1=周一 … 6=周六）
    const jan1Weekday = (start.getDay() + 6) % 7;
    const gridStart = new Date(start);
    gridStart.setDate(start.getDate() - jan1Weekday);

    const end = new Date(year, 11, 31);
    const dec31Weekday = (end.getDay() + 6) % 7;
    const gridEnd = new Date(end);
    gridEnd.setDate(end.getDate() + (6 - dec31Weekday));

    const allCells: Cell[] = [];
    const cur = new Date(gridStart);
    while (cur <= gridEnd) {
      const inYear = cur.getFullYear() === year;
      const ds = inYear ? isoDate(cur) : null;
      allCells.push({
        date: new Date(cur),
        dateStr: ds,
        count: ds ? (heatmap[ds] || 0) : 0,
        inYear,
      });
      cur.setDate(cur.getDate() + 1);
    }

    // 7 格一组切成周列
    const cols: Cell[][] = [];
    for (let i = 0; i < allCells.length; i += 7) {
      cols.push(allCells.slice(i, i + 7));
    }

    // 每个月的第一次出现 → 标签位
    const labels: { colIdx: number; month: number }[] = [];
    let lastMonth = -1;
    cols.forEach((col, ci) => {
      const firstInYear = col.find(c => c.inYear);
      if (!firstInYear) return;
      const m = firstInYear.date.getMonth();
      if (m !== lastMonth) {
        labels.push({ colIdx: ci, month: m });
        lastMonth = m;
      }
    });

    let max = 1;
    for (const c of allCells) if (c.count > max) max = c.count;

    return { weeks: cols, monthPositions: labels, maxVal: max };
  }, [year, heatmap]);

  useEffect(() => {
    onRangeChange?.({
      label: `${year}年`,
      from: `${year}-01-01`,
      to: `${year}-12-31`,
    });
  }, [year, onRangeChange]);

  const minYear = availableYears[0];
  const maxYear = availableYears[availableYears.length - 1];

  const yearTotal = useMemo(() => {
    let sum = 0;
    for (const week of weeks) for (const c of week) if (c.inYear) sum += c.count;
    return sum;
  }, [weeks]);

  const todayStr = isoDate(new Date());

  return (
    <div className="dk-card bg-white dark:bg-[#1c1c1e] border border-gray-100 dark:border-white/10 rounded-3xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={() => setYear(y => y - 1)}
          disabled={year <= minYear}
          aria-label="上一年"
          className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 transition-colors disabled:opacity-20"
        >
          <ChevronLeft size={18} className="text-gray-500" />
        </button>
        <div className="flex items-center gap-2">
          <Hourglass size={15} className="text-[#07c160]" strokeWidth={2.5} />
          <span className="font-black text-base text-[#1d1d1f] dark:text-white">{year}年</span>
          <span className="text-[11px] text-gray-400 font-semibold">· {yearTotal.toLocaleString()} 条</span>
        </div>
        <button
          type="button"
          onClick={() => setYear(y => y + 1)}
          disabled={year >= maxYear}
          aria-label="下一年"
          className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 transition-colors disabled:opacity-20"
        >
          <ChevronRight size={18} className="text-gray-500" />
        </button>
      </div>

      {/* 横向可滚容器（小屏放不下时可左右滑） */}
      <div className="overflow-x-auto pb-1">
        <div className="inline-flex flex-col gap-1 min-w-full">
          {/* 月份标签行 */}
          <div className="flex pl-6 relative h-4">
            {weeks.map((_, ci) => {
              const label = monthPositions.find(p => p.colIdx === ci);
              return (
                <div key={ci} className="w-[13px] flex-shrink-0 relative">
                  {label && (
                    <span className="absolute left-0 top-0 text-[10px] font-bold text-gray-400 whitespace-nowrap">
                      {MONTH_NAMES[label.month]}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* 主体：左侧 7 行 weekday 标签 + 7 × N 格子 */}
          <div className="flex gap-1">
            {/* Weekday 标签列（只显示 1/3/5） */}
            <div className="flex flex-col gap-[2px] w-5 flex-shrink-0 pt-[1px]">
              {[0, 1, 2, 3, 4, 5, 6].map(i => (
                <div key={i} className="h-[11px] text-[9px] font-bold text-gray-400 leading-[11px]">
                  {(i === 0 || i === 2 || i === 4) ? WEEKDAY_LABELS[i / 2] : ''}
                </div>
              ))}
            </div>

            {/* 周列 */}
            <div className="inline-flex gap-[2px]">
              {weeks.map((col, ci) => (
                <div key={ci} className="flex flex-col gap-[2px]">
                  {col.map((cell, di) => {
                    if (!cell.inYear) {
                      return <div key={`${ci}-${di}`} className="w-[11px] h-[11px]" />;
                    }
                    const color = heatColor(cell.count, maxVal);
                    const isSelected = cell.dateStr === selectedDate;
                    const isToday = cell.dateStr === todayStr;
                    return (
                      <button
                        key={`${ci}-${di}`}
                        type="button"
                        onClick={() => cell.dateStr && onDayClick(cell.dateStr)}
                        aria-label={`${cell.dateStr}，${cell.count} 条`}
                        aria-pressed={isSelected}
                        title={`${cell.dateStr}  ${cell.count} 条`}
                        className={`
                          w-[11px] h-[11px] rounded-[2px] transition-all duration-100
                          focus:outline-none focus-visible:ring-2 focus-visible:ring-[#07c160] focus-visible:ring-offset-1
                          ${color ? '' : EMPTY_CELL_CLASS}
                          ${isSelected ? 'ring-2 ring-[#07c160] ring-offset-1 z-10' : 'hover:opacity-60'}
                          ${isToday && !isSelected ? 'ring-1 ring-gray-400' : ''}
                        `}
                        style={color ? { backgroundColor: color } : undefined}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
