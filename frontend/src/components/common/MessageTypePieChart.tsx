/**
 * 消息类型分布甜甜圈图 — 私聊与群聊通用，左右布局（饼图居中 + 图例右侧）
 */

import React from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

const TYPE_COLORS: Record<string, string> = {
  '文本': '#07c160',
  '图片': '#10aeff',
  '语音': '#ff9500',
  '表情': '#fa5151',
  '视频': '#576b95',
  '引用': '#8b5cf6',
  '小程序': '#06b6d4',
  '链接/文件': '#f59e0b',
  '红包': '#ef4444',
  '转账': '#f97316',
  '位置': '#14b8a6',
  '名片': '#6366f1',
  '通话': '#ec4899',
  '视频号': '#8b5cf6',
  '其他': '#d1d1d6',
};

interface Props {
  typeData: Record<string, number>;
  totalMessages?: number;
}

// 188_895 → "188k"；4_532 → "4.5k"；< 1000 保留原值
function formatCompact(n: number): string {
  if (n < 1000) return n.toLocaleString();
  if (n < 10_000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  if (n < 1_000_000) return Math.round(n / 1000) + 'k';
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
}

export const MessageTypePieChart: React.FC<Props> = ({ typeData, totalMessages }) => {
  const data = Object.entries(typeData)
    .map(([name, val]) => ({
      name,
      count: totalMessages != null ? val : 0,
      pct: totalMessages != null
        ? Math.round(val / totalMessages * 100)
        : Math.round(val as number),
    }))
    .filter((d) => d.pct > 0)
    .sort((a, b) => b.pct - a.pct);

  if (data.length === 0) return null;

  return (
    <div className="bg-[#f8f9fb] dk-subtle rounded-2xl p-4">
      <h4 className="text-sm font-black text-gray-500 dark:text-gray-400 uppercase mb-1 tracking-wider">消息类型分布</h4>
      <p className="text-xs text-gray-400 mb-3">各类型消息占比</p>
      {/* 饼图居中 + 图例右侧 */}
      <div className="flex items-center justify-center gap-4">
        {/* 饼图 */}
        <div className="flex-shrink-0" style={{ width: 120, height: 120 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={30}
                outerRadius={52}
                dataKey="pct"
                stroke="none"
              >
                {data.map((entry) => (
                  <Cell key={entry.name} fill={TYPE_COLORS[entry.name] ?? '#d1d1d6'} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ borderRadius: 8, fontSize: 11, border: '1px solid #eee' }}
                formatter={(v: number, name: string) => [
                  `${v}%${totalMessages != null ? ` (${Math.round(v / 100 * totalMessages).toLocaleString()})` : ''}`,
                  name,
                ]}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        {/* 图例：name 占主位不截断，count + % 右侧紧凑显示 */}
        <div className="flex-1 min-w-0 space-y-1">
          {data.map((entry) => (
            <div key={entry.name} className="flex items-center gap-2 text-[11px]" title={entry.count > 0 ? `${entry.name} · ${entry.count.toLocaleString()} 条 · ${entry.pct}%` : `${entry.name} · ${entry.pct}%`}>
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: TYPE_COLORS[entry.name] ?? '#d1d1d6' }}
              />
              <span className="text-gray-600 dark:text-gray-300 font-semibold flex-1 min-w-0 truncate">{entry.name}</span>
              {entry.count > 0 && (
                <span className="text-gray-400 flex-shrink-0 tabular-nums">{formatCompact(entry.count)}</span>
              )}
              <span className="font-black text-gray-700 dark:text-gray-200 flex-shrink-0 w-8 text-right tabular-nums">{entry.pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
