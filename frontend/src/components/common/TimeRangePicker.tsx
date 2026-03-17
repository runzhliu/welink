/**
 * 全局时间范围选择器
 */

import React, { useState } from 'react';
import { Calendar } from 'lucide-react';
import type { TimeRange } from '../../types';

const PRESETS: { label: string; months: number | null }[] = [
  { label: '全部', months: null },
  { label: '近1月', months: 1 },
  { label: '近3月', months: 3 },
  { label: '近6月', months: 6 },
  { label: '近1年', months: 12 },
];

function presetToRange(months: number | null): TimeRange {
  if (months === null) return { from: null, to: null, label: '全部' };
  const now = Math.floor(Date.now() / 1000);
  const from = now - months * 30 * 86400;
  return { from, to: now, label: `近${months >= 12 ? '1年' : `${months}月`}` };
}

interface Props {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
}

export const TimeRangePicker: React.FC<Props> = ({ value, onChange }) => {
  const [showCustom, setShowCustom] = useState(false);
  const [customYear, setCustomYear] = useState(() => new Date().getFullYear().toString());
  const [customMonth, setCustomMonth] = useState(() => String(new Date().getMonth() + 1).padStart(2, '0'));

  const applyCustomMonth = () => {
    const y = parseInt(customYear);
    const m = parseInt(customMonth);
    if (!y || !m) return;
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 1);
    const label = `${y}-${String(m).padStart(2, '0')}`;
    onChange({
      from: Math.floor(start.getTime() / 1000),
      to: Math.floor(end.getTime() / 1000) - 1,
      label,
    });
    setShowCustom(false);
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-gray-400 font-semibold mr-1">时间范围</span>
      {PRESETS.map((p) => {
        const range = presetToRange(p.months);
        const active = value.label === range.label;
        return (
          <button
            key={p.label}
            onClick={() => { onChange(range); setShowCustom(false); }}
            className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${
              active
                ? 'bg-[#07c160] text-white shadow-sm'
                : 'bg-gray-100 dark:bg-white/10 text-gray-500 dk-text hover:bg-gray-200 dark:hover:bg-white/20'
            }`}
          >
            {p.label}
          </button>
        );
      })}
      <button
        onClick={() => setShowCustom((v) => !v)}
        className={`px-3 py-1 rounded-xl text-xs font-bold flex items-center gap-1 transition-all ${
          showCustom || (!PRESETS.some(p => presetToRange(p.months).label === value.label))
            ? 'bg-[#07c160] text-white shadow-sm'
            : 'bg-gray-100 dark:bg-white/10 text-gray-500 dk-text hover:bg-gray-200 dark:hover:bg-white/20'
        }`}
      >
        <Calendar size={11} />
        自定义月份
      </button>
      {showCustom && (
        <div className="flex items-center gap-2 bg-white dk-card dk-border border border-gray-200 rounded-2xl px-3 py-2 shadow-lg">
          <input
            type="number"
            value={customYear}
            onChange={(e) => setCustomYear(e.target.value)}
            className="w-16 text-sm text-center border border-gray-200 rounded-lg px-1 py-0.5 focus:outline-none focus:border-[#07c160] dk-input"
            placeholder="年"
            min="2000"
            max="2100"
          />
          <span className="text-gray-400 text-sm">年</span>
          <input
            type="number"
            value={customMonth}
            onChange={(e) => setCustomMonth(e.target.value)}
            className="w-12 text-sm text-center border border-gray-200 rounded-lg px-1 py-0.5 focus:outline-none focus:border-[#07c160] dk-input"
            placeholder="月"
            min="1"
            max="12"
          />
          <span className="text-gray-400 text-sm">月</span>
          <button
            onClick={applyCustomMonth}
            className="px-3 py-1 bg-[#07c160] text-white text-xs font-bold rounded-lg"
          >
            确定
          </button>
        </div>
      )}
      {value.label !== '全部' && (
        <span className="text-xs text-[#07c160] font-semibold">· {value.label}</span>
      )}
    </div>
  );
};
