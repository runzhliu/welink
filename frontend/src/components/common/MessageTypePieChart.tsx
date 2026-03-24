/**
 * 消息类型分布甜甜圈图 — 私聊与群聊通用
 */

import React from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

const TYPE_COLORS: Record<string, string> = {
  '文本': '#07c160',
  '图片': '#10aeff',
  '语音': '#ff9500',
  '表情': '#fa5151',
  '视频': '#576b95',
  '其他': '#d1d1d6',
};

interface Props {
  // 可传百分比（私聊）或条数（群聊）
  typeData: Record<string, number>;
  totalMessages?: number;  // 传入时自动计算百分比；不传则视 typeData 值为百分比
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
    <div className="bg-[#f8f9fb] rounded-2xl p-4">
      <h4 className="text-sm font-black text-gray-500 uppercase mb-1 tracking-wider">消息类型分布</h4>
      <p className="text-xs text-gray-400 mb-3">各类型消息占比</p>
      <div className="w-[100px] h-[100px] mx-auto mb-3">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={28}
              outerRadius={46}
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
      <div className="space-y-1.5">
        {data.map((entry) => (
          <div key={entry.name} className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: TYPE_COLORS[entry.name] ?? '#d1d1d6' }}
            />
            <span className="text-xs text-gray-600 font-semibold flex-1 whitespace-nowrap">{entry.name}</span>
            {entry.count > 0 && (
              <span className="text-[10px] text-gray-400 whitespace-nowrap">{entry.count.toLocaleString()}</span>
            )}
            <span className="text-xs font-black text-gray-700 w-7 text-right flex-shrink-0">{entry.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
};
