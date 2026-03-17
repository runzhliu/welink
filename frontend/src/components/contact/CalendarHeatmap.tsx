/**
 * GitHub 风格聊天日历热力图
 */

import React, { useMemo, useState, useRef } from 'react';

interface CalendarHeatmapProps {
  data: Record<string, number>; // "2023-01-15" -> count
  onDayClick?: (date: string, count: number) => void;
}

const COLORS = ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'];

function getColor(val: number): string {
  if (val === 0) return COLORS[0];
  if (val <= 5)  return COLORS[1];
  if (val <= 20) return COLORS[2];
  if (val <= 60) return COLORS[3];
  return COLORS[4];
}

interface TooltipState {
  date: string;
  count: number;
  x: number;
  y: number;
}

export const CalendarHeatmap: React.FC<CalendarHeatmapProps> = ({ data, onDayClick }) => {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const { weeks, months } = useMemo(() => {
    if (!Object.keys(data).length) return { weeks: [], months: [] };

    const dates = Object.keys(data).sort();
    const start = new Date(dates[0]);
    const end = new Date(dates[dates.length - 1]);

    // 从最早日期往前对齐到周一（getDay(): 0=周日,1=周一,...）
    const startDay = new Date(start);
    const dow = startDay.getDay();
    const offsetToMonday = dow === 0 ? 6 : dow - 1;
    startDay.setDate(startDay.getDate() - offsetToMonday);

    // 构建每一格 {date, count}
    const cells: { date: string; count: number }[] = [];
    const cur = new Date(startDay);
    while (cur <= end) {
      const key = cur.toISOString().slice(0, 10);
      cells.push({ date: key, count: data[key] || 0 });
      cur.setDate(cur.getDate() + 1);
    }

    // 分组成 week 列
    const weeks: { date: string; count: number }[][] = [];
    for (let i = 0; i < cells.length; i += 7) {
      weeks.push(cells.slice(i, i + 7));
    }

    // 月份标签
    const months: { label: string; col: number }[] = [];
    let lastMonth = -1;
    let lastYear = -1;
    let lastLabelCol = -999;
    weeks.forEach((week, col) => {
      const d = new Date(week[0].date);
      const m = d.getMonth();
      const y = d.getFullYear();
      if (m !== lastMonth) {
        const isYearLabel = m === 0 || y !== lastYear;
        const label = isYearLabel ? `${y}年` : `${m + 1}月`;
        const minGap = isYearLabel ? 3 : (months.length > 0 && months[months.length-1].label.endsWith('年') ? 5 : 2);
        if (col - lastLabelCol >= minGap) {
          months.push({ label, col });
          lastLabelCol = col;
        }
        lastMonth = m;
        lastYear = y;
      }
    });

    return { weeks, months };
  }, [data]);

  if (!weeks.length) return null;

  const CELL = 11;
  const GAP = 2;
  const STEP = CELL + GAP;
  const LABEL_H = 16;
  const DAY_W = 24;
  const svgW = weeks.length * STEP + DAY_W;
  const svgH = 7 * STEP + LABEL_H;

  const handleCellClick = (cell: { date: string; count: number }, col: number, row: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (cell.count === 0) return;
    if (onDayClick) {
      onDayClick(cell.date, cell.count);
      return;
    }
    const cellX = DAY_W + col * STEP;
    const cellY = LABEL_H + row * STEP;
    setTooltip(t => t?.date === cell.date ? null : { date: cell.date, count: cell.count, x: cellX, y: cellY });
  };

  return (
    <div className="overflow-x-auto" onClick={() => setTooltip(null)}>
      <svg ref={svgRef} width={svgW} height={svgH} style={{ display: 'block' }}>
        {/* 月份标签 */}
        {months.map(({ label, col }) => (
          <text key={`${label}-${col}`} x={DAY_W + col * STEP} y={10} fontSize={10} fill="#999">
            {label}
          </text>
        ))}
        {/* 星期标签（周一~周日，row 0=周一） */}
        {(['一','三','五','日'] as const).map((d, i) => {
          const row = i === 0 ? 0 : i === 1 ? 2 : i === 2 ? 4 : 6;
          return (
            <text key={d} x={0} y={LABEL_H + row * STEP + CELL - 1} fontSize={9} fill="#bbb">{d}</text>
          );
        })}
        {/* 格子 */}
        {weeks.map((week, col) =>
          week.map((cell, row) => (
            <rect
              key={cell.date}
              x={DAY_W + col * STEP}
              y={LABEL_H + row * STEP}
              width={CELL}
              height={CELL}
              rx={2}
              fill={getColor(cell.count)}
              style={{ cursor: 'pointer' }}
              onClick={(e) => handleCellClick(cell, col, row, e)}
            />
          ))
        )}
        {/* 点击 tooltip */}
        {tooltip && (() => {
          const TIP_W = 100;
          const TIP_H = 36;
          const tx = Math.min(Math.max(tooltip.x - TIP_W / 2 + CELL / 2, 0), svgW - TIP_W - 2);
          // 上方空间不足时显示在格子下方
          const showBelow = tooltip.y - TIP_H - 4 < LABEL_H;
          const ty = showBelow ? tooltip.y + CELL + 4 : tooltip.y - TIP_H - 4;
          return (
            <g>
              <rect x={tx} y={ty} width={TIP_W} height={TIP_H} rx={6} fill="#1d1d1f" opacity={0.92} />
              <text x={tx + TIP_W / 2} y={ty + 13} fontSize={10} fill="#fff" textAnchor="middle">{tooltip.date}</text>
              <text x={tx + TIP_W / 2} y={ty + 27} fontSize={11} fill="#9be9a8" textAnchor="middle" fontWeight="bold">
                {tooltip.count} 条消息
              </text>
            </g>
          );
        })()}
      </svg>
    </div>
  );
};
