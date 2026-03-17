/**
 * 小时热力图组件
 */

import React, { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';
import type { GlobalStats } from '../../types';

interface HourlyHeatmapProps {
  data: GlobalStats | null;
}

export const HourlyHeatmap: React.FC<HourlyHeatmapProps> = ({ data }) => {
  const chartData = useMemo(() => {
    if (!data?.hourly_heatmap) return [];
    return (data.hourly_heatmap as number[]).map((v, h) => ({
      h: `${h.toString().padStart(2, '0')}:00`,
      hour: h,
      value: v,
    }));
  }, [data]);

  if (!chartData.length) {
    return (
      <div className="dk-card bg-white dk-border p-8 rounded-3xl border border-gray-100 h-96 flex items-center justify-center">
        <p className="text-gray-300 font-semibold">暂无数据</p>
      </div>
    );
  }

  return (
    <div className="dk-card bg-white dk-border p-8 rounded-3xl border border-gray-100">
      <h3 className="dk-text text-xl font-black text-[#1d1d1f] mb-6">
        24 小时活跃度分布
      </h3>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={chartData}>
          <defs>
            <linearGradient id="blueGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10aeff" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#10aeff" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey="h"
            tick={{ fontSize: 11, fill: '#999' }}
            tickLine={false}
            interval={2}
          />
          <YAxis
            tick={{ fontSize: 12, fill: '#999' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => v >= 10000 ? `${(v/1000).toFixed(0)}k` : v}
            domain={[0, 'dataMax']}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#fff',
              border: '1px solid #e5e5e5',
              borderRadius: '12px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            }}
            labelFormatter={(value) => `时段: ${value}`}
            formatter={(value: number) => [value.toLocaleString() + ' 条', '消息数']}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="#10aeff"
            strokeWidth={3}
            fill="url(#blueGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};
