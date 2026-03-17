/**
 * 情感分析图表
 */

import React from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import type { SentimentResult } from '../../types';

interface Props {
  data: SentimentResult;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const score = payload[0].value as number;
  const count = payload[0].payload.count as number;
  const label2 = score >= 0.6 ? '😊 积极' : score <= 0.4 ? '😔 消极' : '😐 中性';
  const color = score >= 0.6 ? '#07c160' : score <= 0.4 ? '#f56c6c' : '#909399';
  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-lg px-4 py-3 text-sm">
      <p className="font-black text-[#1d1d1f] mb-1">{label}</p>
      <p style={{ color }} className="font-bold">{label2} · {Math.round(score * 100)}分</p>
      <p className="text-gray-400 text-xs mt-0.5">参与统计 {count} 条消息</p>
    </div>
  );
};

export const SentimentChart: React.FC<Props> = ({ data }) => {
  const { monthly, overall, positive, negative, neutral } = data;
  const total = positive + negative + neutral;

  const overallLabel = overall >= 0.6 ? '整体积极' : overall <= 0.4 ? '整体消极' : '整体中性';
  const overallColor = overall >= 0.6 ? '#07c160' : overall <= 0.4 ? '#f56c6c' : '#909399';
  const overallEmoji = overall >= 0.6 ? '😊' : overall <= 0.4 ? '😔' : '😐';

  // X 轴只显示年份变化节点，避免拥挤
  const tickFormatter = (month: string) => {
    if (month.endsWith('-01')) return month.slice(0, 4);
    if (monthly.indexOf(monthly.find(m => m.month === month)!) === 0) return month.slice(0, 7);
    return month.slice(5); // "03"
  };

  return (
    <div>
      <p className="text-xs text-gray-400 mb-6">
        基于关键词对文本消息逐条情感打分，按月聚合均值；0.5 为中性基线，越高越积极
      </p>

      {/* 整体指标卡片 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        <div className="bg-white border border-gray-100 rounded-2xl p-4 text-center">
          <p className="text-2xl mb-1">{overallEmoji}</p>
          <p className="text-lg font-black" style={{ color: overallColor }}>
            {Math.round(overall * 100)}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">{overallLabel}</p>
        </div>
        <div className="bg-[#f0fdf4] rounded-2xl p-4 text-center">
          <p className="text-2xl mb-1">😊</p>
          <p className="text-lg font-black text-[#07c160]">
            {total > 0 ? Math.round(positive / total * 100) : 0}%
          </p>
          <p className="text-xs text-gray-400 mt-0.5">积极消息</p>
        </div>
        <div className="bg-[#fff7f7] rounded-2xl p-4 text-center">
          <p className="text-2xl mb-1">😔</p>
          <p className="text-lg font-black text-[#f56c6c]">
            {total > 0 ? Math.round(negative / total * 100) : 0}%
          </p>
          <p className="text-xs text-gray-400 mt-0.5">消极消息</p>
        </div>
        <div className="bg-gray-50 rounded-2xl p-4 text-center">
          <p className="text-2xl mb-1">😐</p>
          <p className="text-lg font-black text-gray-500">
            {total > 0 ? Math.round(neutral / total * 100) : 0}%
          </p>
          <p className="text-xs text-gray-400 mt-0.5">中性消息</p>
        </div>
      </div>

      {/* 月度折线图 */}
      {monthly.length > 1 ? (
        <div>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">
            情感波动曲线 · 月度趋势
          </p>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={monthly} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="month"
                tickFormatter={tickFormatter}
                tick={{ fontSize: 11, fill: '#9ca3af' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={[0, 1]}
                ticks={[0, 0.25, 0.5, 0.75, 1]}
                tickFormatter={(v) => `${Math.round(v * 100)}`}
                tick={{ fontSize: 11, fill: '#9ca3af' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine y={0.5} stroke="#e5e7eb" strokeDasharray="4 4" />
              <Line
                type="monotone"
                dataKey="score"
                stroke="#07c160"
                strokeWidth={2.5}
                dot={(props: any) => {
                  const { cx, cy, payload } = props;
                  const color = payload.score >= 0.6 ? '#07c160' : payload.score <= 0.4 ? '#f56c6c' : '#d1d5db';
                  return <circle key={`dot-${payload.month}`} cx={cx} cy={cy} r={3} fill={color} stroke="white" strokeWidth={1.5} />;
                }}
                activeDot={{ r: 5, stroke: '#07c160', strokeWidth: 2, fill: 'white' }}
              />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-4 mt-3 justify-center text-xs text-gray-400">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#07c160] inline-block" />积极（&gt;60）</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-200 inline-block" />中性（40–60）</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#f56c6c] inline-block" />消极（&lt;40）</span>
          </div>
        </div>
      ) : (
        <div className="text-center text-gray-300 py-8 text-sm">
          消息数量不足，无法生成月度趋势
        </div>
      )}
    </div>
  );
};
