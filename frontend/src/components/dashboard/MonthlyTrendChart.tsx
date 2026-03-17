/**
 * 月度趋势图组件
 */

import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { GlobalStats } from '../../types';

interface MonthlyTrendChartProps {
  data: GlobalStats | null;
}

export const MonthlyTrendChart: React.FC<MonthlyTrendChartProps> = ({ data }) => {
  const chartData = useMemo(() => {
    if (!data?.monthly_trend) return [];
    return Object.entries(data.monthly_trend)
      .map(([name, value]) => ({ name, value: value as number }))
      .sort((a, b) => a.name.localeCompare(b.name));
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
        月度消息趋势
      </h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 12, fill: '#999' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 12, fill: '#999' }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#fff',
              border: '1px solid #e5e5e5',
              borderRadius: '12px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            }}
            cursor={{ fill: '#f8f9fb' }}
          />
          <Bar
            dataKey="value"
            fill="url(#greenGradient)"
            radius={[8, 8, 0, 0]}
            maxBarSize={60}
          />
          <defs>
            <linearGradient id="greenGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#07c160" />
              <stop offset="100%" stopColor="#06ad56" />
            </linearGradient>
          </defs>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};
