/**
 * 每日社交广度曲线
 */

import React, { useEffect, useState, useMemo } from 'react';
import { Loader2, Users } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import type { SocialBreadthPoint } from '../../types';
import { contactsApi } from '../../services/api';

export const SocialBreadthCard: React.FC = () => {
  const [data, setData] = useState<SocialBreadthPoint[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    contactsApi.getSocialBreadth().then(res => {
      if (!cancelled) { setData(res); setLoading(false); }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const summary = useMemo(() => {
    if (!data || data.length === 0) return null;
    const peakDay = data.reduce((best, cur) => cur.unique_contacts > best.unique_contacts ? cur : best);
    const avg = data.reduce((s, d) => s + d.unique_contacts, 0) / data.length;
    return { peakDay, avg };
  }, [data]);

  if (loading) {
    return (
      <div className="bg-white dk-card rounded-3xl border border-gray-100 dk-border p-6">
        <div className="flex items-center gap-2 mb-4">
          <Users size={18} className="text-[#10aeff]" />
          <h3 className="text-lg font-black text-[#1d1d1f] dk-text">每日社交广度</h3>
        </div>
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <Loader2 size={24} className="text-[#10aeff] animate-spin" />
          <div className="text-center">
            <p className="text-xs text-gray-400">正在扫描每日社交广度…</p>
            <p className="text-[10px] text-gray-300 mt-1">按天聚合所有联系人的消息，消息量大时需要一些时间</p>
          </div>
        </div>
      </div>
    );
  }

  if (!data || data.length === 0) return null;

  return (
    <div className="bg-white dk-card rounded-3xl border border-gray-100 dk-border p-6">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Users size={18} className="text-[#10aeff]" />
          <h3 className="text-lg font-black text-[#1d1d1f] dk-text">每日社交广度</h3>
        </div>
      </div>
      <p className="text-xs text-gray-400 mb-3">每天联系了多少个不同的人（不是消息数）</p>

      {summary && (
        <div className="flex flex-wrap gap-2 mb-4 text-[10px]">
          <span className="px-2 py-0.5 rounded-full bg-[#10aeff]/10 text-[#10aeff] font-bold">
            日均 {summary.avg.toFixed(1)} 人
          </span>
          <span className="px-2 py-0.5 rounded-full bg-[#07c160]/10 text-[#07c160] font-bold">
            最广 {summary.peakDay.date.slice(5)} · {summary.peakDay.unique_contacts} 人
          </span>
        </div>
      )}

      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -30 }}>
          <defs>
            <linearGradient id="breadthGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10aeff" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#10aeff" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 9, fill: '#bbb' }}
            tickLine={false}
            tickFormatter={(d: string) => d.slice(5)}
            interval={Math.max(0, Math.floor(data.length / 10) - 1)}
          />
          <YAxis tick={{ fontSize: 9, fill: '#bbb' }} tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={{ borderRadius: 8, fontSize: 12 }}
            formatter={(v: number, name: string) => [`${v} ${name === 'unique_contacts' ? '人' : '条'}`, name === 'unique_contacts' ? '交流对象' : '消息']}
          />
          <Area
            type="monotone"
            dataKey="unique_contacts"
            stroke="#10aeff"
            strokeWidth={2}
            fill="url(#breadthGrad)"
            dot={false}
            activeDot={{ r: 4 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};
