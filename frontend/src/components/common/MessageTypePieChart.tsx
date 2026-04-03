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
      <div className="flex items-center justify-center gap-6">
        {/* 饼图 */}
        <div className="flex-shrink-0" style={{ width: 140, height: 140 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={36}
                outerRadius={60}
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
        {/* 图例 */}
        <div className="space-y-1.5">
          {data.map((entry) => (
            <div key={entry.name} className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: TYPE_COLORS[entry.name] ?? '#d1d1d6' }}
              />
              <span className="text-xs text-gray-600 dark:text-gray-300 font-semibold whitespace-nowrap">{entry.name}</span>
              <span className="flex-1 border-b border-dotted border-gray-200 dark:border-gray-700 mx-1" />
              {entry.count > 0 && (
                <span className="text-[10px] text-gray-400 whitespace-nowrap">{entry.count.toLocaleString()}</span>
              )}
              <span className="text-xs font-black text-gray-700 dark:text-gray-200 w-7 text-right flex-shrink-0">{entry.pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
