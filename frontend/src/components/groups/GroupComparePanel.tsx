/**
 * 群聊活跃度对比面板
 */

import React, { useMemo } from 'react';
import { X, TrendingUp } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { GroupInfo } from '../../types';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';

interface Props {
  groups: GroupInfo[];
  onClose: () => void;
}

const COLORS = ['#07c160', '#10aeff', '#ff9500', '#fa5151', '#8b5cf6', '#06b6d4'];

export const GroupComparePanel: React.FC<Props> = ({ groups, onClose }) => {
  const { privacyMode } = usePrivacyMode();

  const barData = useMemo(() => {
    return groups.map((g, i) => ({
      name: g.name.length > 8 ? g.name.slice(0, 8) + '...' : g.name,
      fullName: g.name,
      messages: g.total_messages,
      members: g.member_count,
      color: COLORS[i % COLORS.length],
    }));
  }, [groups]);

  // 计算每个群的日均消息
  const detailRows = useMemo(() => {
    return groups.map((g, i) => {
      const first = g.first_message_time ? new Date(g.first_message_time) : null;
      const last = g.last_message_time ? new Date(g.last_message_time) : null;
      const days = first && last ? Math.max(1, Math.ceil((last.getTime() - first.getTime()) / 86400000)) : 1;
      const dailyAvg = Math.round(Number(g.total_messages) / days);
      const perMember = g.member_count > 0 ? Math.round(Number(g.total_messages) / g.member_count) : 0;
      return {
        ...g,
        color: COLORS[i % COLORS.length],
        days,
        dailyAvg,
        perMember,
      };
    });
  }, [groups]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white dark:bg-[#1d1d1f] rounded-3xl shadow-2xl w-[90vw] max-w-3xl max-h-[85vh] overflow-y-auto p-6 sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-black text-[#1d1d1f] dk-text flex items-center gap-2">
            <TrendingUp size={20} className="text-[#07c160]" />
            群聊活跃度对比
          </h2>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
            <X size={18} className="text-gray-400" />
          </button>
        </div>

        {/* 消息量对比柱状图 */}
        <div className="mb-6">
          <div className="text-xs text-gray-400 mb-2">总消息量</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={barData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#999' }} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#bbb' }} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ borderRadius: 8, fontSize: 12 }}
                formatter={(v: number) => [`${v.toLocaleString()} 条`, '消息量']}
                labelFormatter={(l: string) => {
                  const item = barData.find(d => d.name === l);
                  return item?.fullName ?? l;
                }}
              />
              <Bar dataKey="messages" radius={[6, 6, 0, 0]} maxBarSize={60}>
                {barData.map((entry, i) => (
                  <rect key={i} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* 详细数据表格 */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] text-gray-400 font-bold border-b border-gray-100 dk-border">
                <th className="text-left py-2 pr-3">群名</th>
                <th className="text-right py-2 px-2">总消息</th>
                <th className="text-right py-2 px-2">成员数</th>
                <th className="text-right py-2 px-2">日均消息</th>
                <th className="text-right py-2 px-2">人均消息</th>
                <th className="text-right py-2 px-2">活跃天数</th>
                <th className="text-right py-2 pl-2">最近活跃</th>
              </tr>
            </thead>
            <tbody>
              {detailRows.map((g) => (
                <tr key={g.username} className="border-b border-gray-50 dk-border last:border-0 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: g.color }} />
                      <span className={`font-bold text-[#1d1d1f] dk-text truncate max-w-[200px]${privacyMode ? ' privacy-blur' : ''}`}>
                        {g.name}
                      </span>
                    </div>
                  </td>
                  <td className="text-right py-2.5 px-2 font-bold tabular-nums">{g.total_messages.toLocaleString()}</td>
                  <td className="text-right py-2.5 px-2 tabular-nums text-gray-500">{g.member_count}</td>
                  <td className="text-right py-2.5 px-2 tabular-nums text-gray-500">{g.dailyAvg.toLocaleString()}</td>
                  <td className="text-right py-2.5 px-2 tabular-nums text-gray-500">{g.perMember.toLocaleString()}</td>
                  <td className="text-right py-2.5 px-2 tabular-nums text-gray-500">{g.days.toLocaleString()}</td>
                  <td className="text-right py-2.5 pl-2 text-[10px] text-gray-400">{g.last_message_time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
