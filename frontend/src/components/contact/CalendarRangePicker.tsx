/**
 * 日历热力图 + 拖拽范围选择
 * 在 CalendarHeatmap 基础上增加：按住拖拽选择起止日期
 */

import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';

interface Props {
  data: Record<string, number>; // "2024-03-15" → count
  from: string;
  to: string;
  onRangeChange: (from: string, to: string) => void;
}

const COLORS = ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'];
function getColor(val: number): string {
  if (val === 0) return COLORS[0];
  if (val <= 5)  return COLORS[1];
  if (val <= 20) return COLORS[2];
  if (val <= 60) return COLORS[3];
  return COLORS[4];
}

const CELL = 11;
const GAP  = 2;
const STEP = CELL + GAP;
const LABEL_H = 16;
const DAY_W   = 24;

export const CalendarRangePicker: React.FC<Props> = ({ data, from, to, onRangeChange }) => {
  // 拖拽状态
  const [dragStart, setDragStart] = useState<string | null>(null);
  const [dragEnd,   setDragEnd]   = useState<string | null>(null);
  const isDragging = dragStart !== null;

  // 计算当前预览范围
  const previewFrom = useMemo(() => {
    if (!isDragging) return from;
    if (!dragStart || !dragEnd) return from;
    return dragStart < dragEnd ? dragStart : dragEnd;
  }, [isDragging, dragStart, dragEnd, from]);

  const previewTo = useMemo(() => {
    if (!isDragging) return to;
    if (!dragStart || !dragEnd) return to;
    return dragStart > dragEnd ? dragStart : dragEnd;
  }, [isDragging, dragStart, dragEnd, to]);

  const { weeks, months, allDates } = useMemo(() => {
    const keys = Object.keys(data).sort();
    if (!keys.length) return { weeks: [], months: [], allDates: [] };

    const start = new Date(keys[0]);
    const end   = new Date(keys[keys.length - 1]);

    const startDay = new Date(start);
    const dow = startDay.getDay();
    startDay.setDate(startDay.getDate() - (dow === 0 ? 6 : dow - 1));

    const cells: { date: string; count: number }[] = [];
    const cur = new Date(startDay);
    while (cur <= end) {
      const key = cur.toISOString().slice(0, 10);
      cells.push({ date: key, count: data[key] ?? 0 });
      cur.setDate(cur.getDate() + 1);
    }

    const weeks: { date: string; count: number }[][] = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

    const months: { label: string; col: number }[] = [];
    let lastMonth = -1, lastYear = -1, lastLabelCol = -999;
    weeks.forEach((week, col) => {
      const d = new Date(week[0].date);
      const m = d.getMonth(), y = d.getFullYear();
      if (m !== lastMonth) {
        const isYear = m === 0 || y !== lastYear;
        const label = isYear ? `${y}年` : `${m + 1}月`;
        const minGap = isYear ? 3 : 2;
        if (col - lastLabelCol >= minGap) {
          months.push({ label, col });
          lastLabelCol = col;
        }
        lastMonth = m; lastYear = y;
      }
    });

    return { weeks, months, allDates: cells.map(c => c.date) };
  }, [data]);

  const svgRef = useRef<SVGSVGElement>(null);
  const svgW = weeks.length * STEP + DAY_W;
  const svgH = 7 * STEP + LABEL_H;

  // 从 SVG 坐标找最近的 cell date
  const dateFromPoint = useCallback((clientX: number, clientY: number): string | null => {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = svgW / rect.width;
    const scaleY = svgH / rect.height;
    const svgX = (clientX - rect.left) * scaleX;
    const svgY = (clientY - rect.top)  * scaleY;
    const col = Math.floor((svgX - DAY_W) / STEP);
    const row = Math.floor((svgY - LABEL_H) / STEP);
    if (col < 0 || col >= weeks.length || row < 0 || row > 6) return null;
    return weeks[col]?.[row]?.date ?? null;
  }, [weeks, svgW, svgH]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const d = dateFromPoint(e.clientX, e.clientY);
    if (!d) return;
    setDragStart(d);
    setDragEnd(d);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const d = dateFromPoint(e.clientX, e.clientY);
    if (d) setDragEnd(d);
  };

  const handleMouseUp = () => {
    if (!isDragging || !dragStart || !dragEnd) return;
    const f = dragStart < dragEnd ? dragStart : dragEnd;
    const t = dragStart > dragEnd ? dragStart : dragEnd;
    onRangeChange(f, t);
    setDragStart(null);
    setDragEnd(null);
  };

  // 鼠标离开 SVG 时结束拖拽
  const handleMouseLeave = () => {
    if (!isDragging) return;
    handleMouseUp();
  };

  // 全局 mouseup 兜底
  useEffect(() => {
    if (!isDragging) return;
    const up = () => handleMouseUp();
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  });

  if (!weeks.length) return (
    <div className="text-xs text-gray-300 text-center py-4">暂无聊天记录数据</div>
  );

  // 判断格子是否在选区内
  const inRange = (date: string) => date >= previewFrom && date <= previewTo;
  const isEdge  = (date: string) => date === previewFrom || date === previewTo;

  return (
    <div className="overflow-x-auto select-none">
      {/* 说明 */}
      <p className="text-[10px] text-gray-400 mb-2">按住拖拽选择范围，颜色越深消息越多</p>
      <svg
        ref={svgRef}
        width={svgW}
        height={svgH}
        style={{ display: 'block', cursor: isDragging ? 'col-resize' : 'crosshair' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        {/* 月份标签 */}
        {months.map(({ label, col }) => (
          <text key={`${label}-${col}`} x={DAY_W + col * STEP} y={10} fontSize={10} fill="#999">
            {label}
          </text>
        ))}
        {/* 星期标签 */}
        {(['一','三','五','日'] as const).map((d, i) => {
          const row = i === 0 ? 0 : i === 1 ? 2 : i === 2 ? 4 : 6;
          return <text key={d} x={0} y={LABEL_H + row * STEP + CELL - 1} fontSize={9} fill="#bbb">{d}</text>;
        })}
        {/* 格子 */}
        {weeks.map((week, col) =>
          week.map((cell, row) => {
            const selected = inRange(cell.date);
            const edge = isEdge(cell.date);
            return (
              <g key={cell.date}>
                <rect
                  x={DAY_W + col * STEP}
                  y={LABEL_H + row * STEP}
                  width={CELL}
                  height={CELL}
                  rx={2}
                  fill={getColor(cell.count)}
                />
                {selected && (
                  <rect
                    x={DAY_W + col * STEP}
                    y={LABEL_H + row * STEP}
                    width={CELL}
                    height={CELL}
                    rx={2}
                    fill={edge ? '#07c160' : '#07c16055'}
                    stroke={edge ? '#06ad56' : 'none'}
                    strokeWidth={1}
                  />
                )}
              </g>
            );
          })
        )}
        {/* 选区起止日期标签 */}
        {(previewFrom || previewTo) && (() => {
          const fromIdx = allDates.indexOf(previewFrom);
          const toIdx   = allDates.indexOf(previewTo);
          if (fromIdx < 0 || toIdx < 0) return null;
          const fromCol = Math.floor(fromIdx / 7);
          const toCol   = Math.floor(toIdx   / 7);
          const labelY  = svgH - 1;
          return (
            <g>
              <text x={DAY_W + fromCol * STEP + CELL / 2} y={labelY} fontSize={8} fill="#07c160" textAnchor="middle">{previewFrom.slice(5)}</text>
              {previewFrom !== previewTo && (
                <text x={DAY_W + toCol * STEP + CELL / 2} y={labelY} fontSize={8} fill="#07c160" textAnchor="middle">{previewTo.slice(5)}</text>
              )}
            </g>
          );
        })()}
      </svg>
    </div>
  );
};
