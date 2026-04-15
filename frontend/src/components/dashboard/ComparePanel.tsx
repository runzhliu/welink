/**
 * 联系人对比面板 — 多人私聊画像并排对比
 */

import React, { useMemo } from 'react';
import { X, MessageCircle, Clock, Gift, Zap, Moon, Type } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Legend } from 'recharts';
import type { ContactStats } from '../../types';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';
import { avatarSrc } from '../../utils/avatar';

interface Props {
  contacts: ContactStats[];
  onClose: () => void;
}

const COLORS = ['#07c160', '#10aeff', '#ff9500', '#fa5151', '#576b95', '#8b5cf6'];

function displayName(c: ContactStats) {
  return c.remark || c.nickname || c.username;
}

export const ComparePanel: React.FC<Props> = ({ contacts, onClose }) => {
  const { privacyMode } = usePrivacyMode();

  // ─── Bar chart data builders ──────────────────────────────────
  const barData = useMemo(() => {
    const metrics: { key: string; label: string; getValue: (c: ContactStats) => number }[] = [
      { key: 'total', label: '消息总数', getValue: c => c.total_messages },
      { key: 'their', label: '对方消息', getValue: c => c.their_messages ?? 0 },
      { key: 'my', label: '我的消息', getValue: c => c.my_messages ?? 0 },
      { key: 'their_chars', label: '对方字数', getValue: c => c.their_chars ?? 0 },
      { key: 'my_chars', label: '我的字数', getValue: c => c.my_chars ?? 0 },
      { key: 'peak', label: '峰值月消息', getValue: c => c.peak_monthly ?? 0 },
      { key: 'recent', label: '近一月消息', getValue: c => c.recent_monthly ?? 0 },
      { key: 'avg_len', label: '均消息长(字)', getValue: c => c.avg_msg_len ?? 0 },
      { key: 'money', label: '红包/转账', getValue: c => c.money_count ?? 0 },
      { key: 'recall', label: '撤回次数', getValue: c => c.recall_count ?? 0 },
    ];

    return metrics.map(m => {
      const row: Record<string, string | number> = { metric: m.label };
      contacts.forEach((c, i) => {
        row[`c${i}`] = m.getValue(c);
      });
      return row;
    });
  }, [contacts]);

  // ─── Radar data (normalized 0-100) ────────────────────────────
  const radarData = useMemo(() => {
    const dims = [
      { label: '消息量', getValue: (c: ContactStats) => c.total_messages },
      { label: '峰值月', getValue: (c: ContactStats) => c.peak_monthly ?? 0 },
      { label: '近一月', getValue: (c: ContactStats) => c.recent_monthly ?? 0 },
      { label: '均消息长', getValue: (c: ContactStats) => c.avg_msg_len ?? 0 },
      { label: '红包/转账', getValue: (c: ContactStats) => c.money_count ?? 0 },
      { label: '共同群聊', getValue: (c: ContactStats) => c.shared_groups_count ?? 0 },
    ];

    return dims.map(d => {
      const vals = contacts.map(c => d.getValue(c));
      const max = Math.max(...vals, 1);
      const row: Record<string, string | number> = { dim: d.label };
      contacts.forEach((_, i) => {
        row[`c${i}`] = Math.round((vals[i] / max) * 100);
      });
      return row;
    });
  }, [contacts]);

  // ─── Type distribution comparison ─────────────────────────────
  const typeData = useMemo(() => {
    const allTypes = new Set<string>();
    contacts.forEach(c => {
      if (c.type_cnt) Object.keys(c.type_cnt).forEach(t => allTypes.add(t));
    });
    return Array.from(allTypes)
      .map(type => {
        const row: Record<string, string | number> = { type };
        contacts.forEach((c, i) => {
          row[`c${i}`] = c.type_cnt?.[type] ?? 0;
        });
        return row;
      })
      .sort((a, b) => {
        const sumA = contacts.reduce((s, _, i) => s + ((a[`c${i}`] as number) || 0), 0);
        const sumB = contacts.reduce((s, _, i) => s + ((b[`c${i}`] as number) || 0), 0);
        return sumB - sumA;
      });
  }, [contacts]);

  // ─── Days since first message ─────────────────────────────────
  const daysKnown = useMemo(() =>
    contacts.map(c => {
      if (!c.first_message_time || c.first_message_time === '-') return 0;
      return Math.floor((Date.now() - new Date(c.first_message_time).getTime()) / 86400000);
    }),
    [contacts]
  );

  return (
    <div className="fixed inset-0 bg-[#1d1d1f]/90 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={onClose}>
      <div className="dk-card bg-white rounded-[32px] w-full max-w-5xl max-h-[90vh] overflow-hidden shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="overflow-y-auto max-h-[90vh] p-6 sm:p-10">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="dk-text text-2xl sm:text-3xl font-black text-[#1d1d1f]">联系人对比</h2>
              <p className="text-sm text-gray-400 mt-1">对比 {contacts.length} 位联系人的聊天数据</p>
            </div>
            <button onClick={onClose} className="text-gray-300 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
              <X size={28} />
            </button>
          </div>

          {/* Avatar row */}
          <div className="flex flex-wrap gap-4 mb-8">
            {contacts.map((c, i) => (
              <div key={c.username} className="flex items-center gap-2 px-3 py-2 rounded-xl"
                style={{ backgroundColor: `${COLORS[i % COLORS.length]}15` }}>
                <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0">
                  {(c.small_head_url || c.big_head_url) ? (
                    <img loading="lazy" src={avatarSrc(c.small_head_url || c.big_head_url)} alt="" className="w-full h-full object-cover"
                      onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-white text-xs font-bold"
                      style={{ backgroundColor: COLORS[i % COLORS.length] }}>
                      {displayName(c).charAt(0)}
                    </div>
                  )}
                </div>
                <div>
                  <span className={`text-sm font-bold${privacyMode ? ' privacy-blur' : ''}`}
                    style={{ color: COLORS[i % COLORS.length] }}>
                    {displayName(c)}
                  </span>
                  <div className="text-[10px] text-gray-400">
                    {c.total_messages.toLocaleString()} 条 · {daysKnown[i]} 天
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Radar chart */}
          <div className="dk-subtle bg-[#f8f9fb] rounded-2xl p-5 mb-6">
            <h3 className="text-sm font-black text-gray-500 uppercase tracking-wider mb-4">综合雷达图</h3>
            <ResponsiveContainer width="100%" height={280}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="#e5e7eb" />
                <PolarAngleAxis dataKey="dim" tick={{ fontSize: 11, fill: '#888' }} />
                <PolarRadiusAxis tick={false} axisLine={false} domain={[0, 100]} />
                {contacts.map((c, i) => (
                  <Radar
                    key={c.username}
                    name={privacyMode ? `联系人${i + 1}` : displayName(c)}
                    dataKey={`c${i}`}
                    stroke={COLORS[i % COLORS.length]}
                    fill={COLORS[i % COLORS.length]}
                    fillOpacity={0.15}
                    strokeWidth={2}
                  />
                ))}
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          {/* Key metrics bar charts */}
          <div className="dk-subtle bg-[#f8f9fb] rounded-2xl p-5 mb-6">
            <h3 className="text-sm font-black text-gray-500 uppercase tracking-wider mb-4">关键指标对比</h3>
            <ResponsiveContainer width="100%" height={barData.length * 40 + 40}>
              <BarChart data={barData} layout="vertical" margin={{ left: 80, right: 20, top: 5, bottom: 5 }}>
                <XAxis type="number" tick={{ fontSize: 10, fill: '#aaa' }} />
                <YAxis type="category" dataKey="metric" tick={{ fontSize: 11, fill: '#666' }} width={75} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, fontSize: 12 }}
                  formatter={(v: number, name: string) => {
                    const idx = parseInt(name.replace('c', ''));
                    const label = privacyMode ? `联系人${idx + 1}` : displayName(contacts[idx]);
                    return [v.toLocaleString(), label];
                  }}
                />
                {contacts.map((_, i) => (
                  <Bar key={i} dataKey={`c${i}`} fill={COLORS[i % COLORS.length]} radius={[0, 4, 4, 0]} maxBarSize={16} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Type distribution */}
          {typeData.length > 0 && (
            <div className="dk-subtle bg-[#f8f9fb] rounded-2xl p-5 mb-6">
              <h3 className="text-sm font-black text-gray-500 uppercase tracking-wider mb-4">消息类型分布对比</h3>
              <ResponsiveContainer width="100%" height={typeData.length * 36 + 40}>
                <BarChart data={typeData} layout="vertical" margin={{ left: 60, right: 20, top: 5, bottom: 5 }}>
                  <XAxis type="number" tick={{ fontSize: 10, fill: '#aaa' }} />
                  <YAxis type="category" dataKey="type" tick={{ fontSize: 11, fill: '#666' }} width={55} />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number, name: string) => {
                      const idx = parseInt(name.replace('c', ''));
                      const label = privacyMode ? `联系人${idx + 1}` : displayName(contacts[idx]);
                      return [v.toLocaleString(), label];
                    }}
                  />
                  {contacts.map((_, i) => (
                    <Bar key={i} dataKey={`c${i}`} fill={COLORS[i % COLORS.length]} radius={[0, 4, 4, 0]} maxBarSize={14} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Quick stats comparison table */}
          <div className="dk-subtle bg-[#f8f9fb] rounded-2xl p-5">
            <h3 className="text-sm font-black text-gray-500 uppercase tracking-wider mb-4">数据明细</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left py-2 px-3 text-xs font-bold text-gray-400">指标</th>
                    {contacts.map((c, i) => (
                      <th key={c.username} className="text-right py-2 px-3 text-xs font-bold" style={{ color: COLORS[i % COLORS.length] }}>
                        <span className={privacyMode ? 'privacy-blur' : ''}>{displayName(c)}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {[
                    { label: '认识天数', values: daysKnown.map(d => `${d.toLocaleString()} 天`) },
                    { label: '消息总数', values: contacts.map(c => c.total_messages.toLocaleString()) },
                    { label: '对方消息', values: contacts.map(c => (c.their_messages ?? 0).toLocaleString()) },
                    { label: '我的消息', values: contacts.map(c => (c.my_messages ?? 0).toLocaleString()) },
                    { label: '对方字数', values: contacts.map(c => (c.their_chars ?? 0).toLocaleString()) },
                    { label: '我的字数', values: contacts.map(c => (c.my_chars ?? 0).toLocaleString()) },
                    { label: '均消息长度', values: contacts.map(c => `${(c.avg_msg_len ?? 0).toFixed(1)} 字`) },
                    { label: '峰值月消息', values: contacts.map(c => `${(c.peak_monthly ?? 0).toLocaleString()}${c.peak_period ? ` (${c.peak_period})` : ''}`) },
                    { label: '近一月消息', values: contacts.map(c => (c.recent_monthly ?? 0).toLocaleString()) },
                    { label: '红包/转账', values: contacts.map(c => (c.money_count ?? 0).toLocaleString()) },
                    { label: '撤回次数', values: contacts.map(c => (c.recall_count ?? 0).toLocaleString()) },
                    { label: '共同群聊', values: contacts.map(c => (c.shared_groups_count ?? 0).toLocaleString()) },
                    { label: '初识日期', values: contacts.map(c => c.first_message_time || '-') },
                    { label: '最近消息', values: contacts.map(c => c.last_message_time || '-') },
                  ].map(row => (
                    <tr key={row.label}>
                      <td className="py-2 px-3 text-gray-500 font-medium">{row.label}</td>
                      {row.values.map((v, i) => (
                        <td key={i} className="py-2 px-3 text-right font-bold dk-text">{v}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
