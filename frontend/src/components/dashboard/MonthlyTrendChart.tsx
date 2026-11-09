/**
 * 月度趋势图组件（私聊 + 群聊，支持切换视图）
 */

import React, { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { GlobalStats } from '../../types';

type ViewMode = 'all' | 'private' | 'group';

interface MonthlyTrendChartProps {
  data: GlobalStats | null;
}

const ModeButton: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
      active ? 'bg-[#1d1d1f] text-white' : 'text-gray-400 hover:text-gray-600'
    }`}
  >
    {children}
  </button>
);

const CustomTooltip = ({ active, payload, label, mode }: any) => {
  if (!active || !payload?.length) return null;
  const priv = payload.find((p: any) => p.dataKey === 'private')?.value ?? 0;
  const grp  = payload.find((p: any) => p.dataKey === 'group')?.value  ?? 0;
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 12, padding: '10px 14px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', minWidth: 148 }}>
      <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: '#1d1d1f' }}>{label}</p>
      {mode !== 'group' && <p style={{ fontSize: 12, color: '#07c160', margin: '2px 0' }}>私聊：{priv.toLocaleString()} 条</p>}
      {mode !== 'private' && grp > 0 && <p style={{ fontSize: 12, color: '#10aeff', margin: '2px 0' }}>群聊：{grp.toLocaleString()} 条</p>}
      {mode === 'all' && grp > 0 && (
        <p style={{ fontSize: 12, color: '#999', margin: '4px 0 0', borderTop: '1px solid #f0f0f0', paddingTop: 4 }}>
          合计：{(priv + grp).toLocaleString()} 条
        </p>
      )}
    </div>
  );
};

export const MonthlyTrendChart: React.FC<MonthlyTrendChartProps> = ({ data }) => {
  const [mode, setMode] = useState<ViewMode>('all');

  const hasGroups = useMemo(() =>
    Object.values(data?.group_monthly_trend ?? {}).some((v) => v > 0),
  [data]);

  const chartData = useMemo(() => {
    if (!data?.monthly_trend) return [];
    const allMonths = new Set([
      ...Object.keys(data.monthly_trend),
      ...Object.keys(data.group_monthly_trend ?? {}),
    ]);
    return Array.from(allMonths).sort().map((month) => ({
      name: month,
      private: data.monthly_trend[month] ?? 0,
      group: data.group_monthly_trend?.[month] ?? 0,
    }));
  }, [data]);

  if (!chartData.length) {
    return (
      <div className="dk-card bg-white dk-border p-8 rounded-3xl border border-gray-100 h-96 flex items-center justify-center">
        <p className="text-gray-300 font-semibold">暂无数据</p>
      </div>
    );
  }

  const showPrivate = mode !== 'group';
  const showGroup   = mode !== 'private' && hasGroups;
  const stacked     = showPrivate && showGroup;

  return (
    <div className="dk-card bg-white dk-border p-8 rounded-3xl border border-gray-100">
      <div className="flex items-center justify-between mb-6">
        <h3 className="dk-text text-xl font-black text-[#1d1d1f]">月度消息趋势</h3>
        {hasGroups && (
          <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
            <ModeButton active={mode === 'all'}     onClick={() => setMode('all')}>全部</ModeButton>
            <ModeButton active={mode === 'private'} onClick={() => setMode('private')}>私聊</ModeButton>
            <ModeButton active={mode === 'group'}   onClick={() => setMode('group')}>群聊</ModeButton>
          </div>
        )}
      </div>
      <div className="h-[200px] sm:h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} barCategoryGap="20%">
          <defs>
            <linearGradient id="mtPrivateGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#07c160" /><stop offset="100%" stopColor="#06ad56" />
            </linearGradient>
            <linearGradient id="mtGroupGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10aeff" /><stop offset="100%" stopColor="#0e8dd6" />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#999' }} tickLine={false} />
          <YAxis tick={{ fontSize: 12, fill: '#999' }} tickLine={false} axisLine={false}
            tickFormatter={(v) => v >= 10000 ? `${(v / 1000).toFixed(0)}k` : v} />
          <Tooltip content={<CustomTooltip mode={mode} />} cursor={{ fill: '#f8f9fb' }} />
          {showPrivate && (
            <Bar dataKey="private" stackId="a" fill="url(#mtPrivateGrad)"
              radius={stacked ? [0, 0, 0, 0] : [8, 8, 0, 0]} maxBarSize={28} />
          )}
          {showGroup && (
            <Bar dataKey="group" stackId="a" fill="url(#mtGroupGrad)"
              radius={[8, 8, 0, 0]} maxBarSize={28} />
          )}
        </BarChart>
      </ResponsiveContainer>
      </div>
    </div>
  );
};
