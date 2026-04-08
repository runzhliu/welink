/**
 * 个人自画像 — 汇总"我"方向的数据
 */

import React, { useEffect, useState } from 'react';
import { Loader2, User, Clock, MessageSquare, Calendar, Zap, Users } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { SelfPortrait } from '../../types';
import { contactsApi } from '../../services/api';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

interface Props {
  blockedDisplayNames?: Set<string>;
}

export const SelfPortraitCard: React.FC<Props> = ({ blockedDisplayNames }) => {
  const { privacyMode } = usePrivacyMode();
  const [data, setData] = useState<SelfPortrait | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    contactsApi.getSelfPortrait().then(res => {
      if (!cancelled) { setData(res); setLoading(false); }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // 如果最常联系的人被屏蔽，隐藏该字段
  const displayMostContacted = data && (!blockedDisplayNames || !blockedDisplayNames.has(data.most_contacted_name))
    ? data.most_contacted_name
    : '';

  if (loading) {
    return (
      <div className="bg-white dk-card rounded-3xl border border-gray-100 dk-border p-6">
        <div className="flex items-center gap-2 mb-4">
          <User size={18} className="text-[#07c160]" />
          <h3 className="text-lg font-black text-[#1d1d1f] dk-text">个人自画像</h3>
        </div>
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <Loader2 size={24} className="text-[#07c160] animate-spin" />
          <div className="text-center">
            <p className="text-xs text-gray-400">正在聚合所有联系人的发送数据…</p>
            <p className="text-[10px] text-gray-300 mt-1">需要遍历全部消息统计你的发言指纹，请耐心等待</p>
          </div>
        </div>
      </div>
    );
  }

  if (!data || data.total_sent === 0) {
    return null;
  }

  const hourlyData = data.hourly_dist.map((v, h) => ({
    label: `${h}`,
    value: v,
    isLateNight: h < 5,
  }));

  return (
    <div className="bg-white dk-card rounded-3xl border border-gray-100 dk-border p-6">
      <div className="flex items-center gap-2 mb-5">
        <User size={18} className="text-[#07c160]" />
        <h3 className="text-lg font-black text-[#1d1d1f] dk-text">个人自画像</h3>
      </div>

      {/* KPI 4 宫格 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <div className="bg-[#07c160]/5 rounded-2xl p-3 text-center">
          <MessageSquare size={14} className="mx-auto text-[#07c160] mb-1" />
          <div className="text-xl font-black text-[#07c160]">{data.total_sent.toLocaleString()}</div>
          <div className="text-[10px] text-gray-400">发出消息</div>
        </div>
        <div className="bg-[#10aeff]/5 rounded-2xl p-3 text-center">
          <Zap size={14} className="mx-auto text-[#10aeff] mb-1" />
          <div className="text-xl font-black text-[#10aeff]">{Math.round(data.avg_msg_len * 10) / 10}</div>
          <div className="text-[10px] text-gray-400">平均字数</div>
        </div>
        <div className="bg-[#ff9500]/5 rounded-2xl p-3 text-center">
          <Clock size={14} className="mx-auto text-[#ff9500] mb-1" />
          <div className="text-xl font-black text-[#ff9500]">{data.top_active_hour}:00</div>
          <div className="text-[10px] text-gray-400">最活跃时段</div>
        </div>
        <div className="bg-[#8b5cf6]/5 rounded-2xl p-3 text-center">
          <Users size={14} className="mx-auto text-[#8b5cf6] mb-1" />
          <div className="text-xl font-black text-[#8b5cf6]">{data.total_contacts}</div>
          <div className="text-[10px] text-gray-400">联系过的人</div>
        </div>
      </div>

      {/* 高光描述 */}
      <div className="bg-[#f8f9fb] dark:bg-white/5 rounded-2xl p-4 mb-4 space-y-1 text-sm">
        <div className="flex items-center gap-2">
          <Calendar size={12} className="text-gray-400 flex-shrink-0" />
          <span className="text-gray-500 dk-text">
            你最爱在 <b className="text-[#1d1d1f] dk-text">{WEEKDAYS[data.top_active_weekday]}</b> 发消息
          </span>
        </div>
        {displayMostContacted && (
          <div className="flex items-center gap-2">
            <User size={12} className="text-gray-400 flex-shrink-0" />
            <span className="text-gray-500 dk-text">
              最常联系的人是{' '}
              <b className={`text-[#07c160] ${privacyMode ? 'privacy-blur' : ''}`}>{displayMostContacted}</b>
              <span className="text-gray-400 font-normal ml-1">（给 TA 发过 {data.most_contacted_count.toLocaleString()} 条）</span>
            </span>
          </div>
        )}
      </div>

      {/* 我的小时分布 */}
      <div>
        <div className="text-xs text-gray-400 mb-1">我的 24 小时发送分布</div>
        <ResponsiveContainer width="100%" height={90}>
          <BarChart data={hourlyData} margin={{ top: 0, right: 0, bottom: 0, left: -30 }}>
            <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#bbb' }} tickLine={false} interval={3} />
            <YAxis tick={false} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ borderRadius: 8, fontSize: 12 }}
              formatter={(v: number) => [`${v} 条`, '']}
              labelFormatter={(l: string) => `${l}:00`}
            />
            <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={12}>
              {hourlyData.map((e, i) => (
                <Cell key={i} fill={e.isLateNight ? '#576b95' : '#07c160'} opacity={0.8} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
