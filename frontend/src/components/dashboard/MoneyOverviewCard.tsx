/**
 * 红包/转账全局总览
 */

import React, { useEffect, useState, useMemo } from 'react';
import { Loader2, Gift, ArrowUpRight, ArrowDownLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { MoneyOverview } from '../../types';
import { contactsApi } from '../../services/api';
import { avatarSrc } from '../../utils/avatar';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';

interface Props {
  blockedUsers?: string[];
  blockedDisplayNames?: Set<string>;
  onContactClick?: (username: string) => void;
}

export const MoneyOverviewCard: React.FC<Props> = ({ blockedUsers = [], blockedDisplayNames, onContactClick }) => {
  const { privacyMode } = usePrivacyMode();
  const [rawData, setRawData] = useState<MoneyOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    contactsApi.getMoneyOverview().then(res => {
      if (!cancelled) { setRawData(res); setLoading(false); }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // 屏蔽过滤
  const data = useMemo(() => {
    if (!rawData) return null;
    const blockedUsernames = new Set(blockedUsers);
    const blockedNames = blockedDisplayNames ?? new Set<string>();
    if (blockedUsernames.size === 0 && blockedNames.size === 0) return rawData;
    return {
      ...rawData,
      contacts: rawData.contacts.filter(c =>
        !blockedUsernames.has(c.username) && !blockedNames.has(c.name)
      ),
    };
  }, [rawData, blockedUsers, blockedDisplayNames]);

  if (loading) {
    return (
      <div className="bg-white dk-card rounded-3xl border border-gray-100 dk-border p-6">
        <div className="flex items-center gap-2 mb-4">
          <Gift size={18} className="text-red-500" />
          <h3 className="text-lg font-black text-[#1d1d1f] dk-text">红包 / 转账总览</h3>
        </div>
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <Loader2 size={24} className="text-red-500 animate-spin" />
          <div className="text-center">
            <p className="text-xs text-gray-400">正在统计全部红包和转账记录…</p>
            <p className="text-[10px] text-gray-300 mt-1">遍历所有联系人的消息识别 wcpay 支付类型，结果会缓存</p>
          </div>
        </div>
      </div>
    );
  }

  if (!data || (data.total_red_packet === 0 && data.total_transfer === 0)) {
    return (
      <div className="bg-white dk-card rounded-3xl border border-gray-100 dk-border p-6">
        <div className="flex items-center gap-2 mb-4">
          <Gift size={18} className="text-red-500" />
          <h3 className="text-lg font-black text-[#1d1d1f] dk-text">红包 / 转账总览</h3>
        </div>
        <div className="text-center text-gray-300 py-8">暂无红包或转账记录</div>
      </div>
    );
  }

  // 月度趋势数据
  const trendData = Object.entries(data.monthly_trend)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, [sent, recv]]) => ({
      month,
      label: `${month.slice(2, 4)}/${month.slice(5)}`,
      sent,
      recv,
    }));

  const displayContacts = expanded ? data.contacts : data.contacts.slice(0, 10);

  return (
    <div className="bg-white dk-card rounded-3xl border border-gray-100 dk-border p-6">
      <div className="flex items-center gap-2 mb-5">
        <Gift size={18} className="text-red-500" />
        <h3 className="text-lg font-black text-[#1d1d1f] dk-text">红包 / 转账总览</h3>
      </div>

      {/* KPI 卡片 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="bg-red-50 dark:bg-red-500/10 rounded-2xl p-3 text-center">
          <div className="text-2xl font-black text-red-500">{data.total_red_packet}</div>
          <div className="text-[10px] text-red-400">红包总数</div>
        </div>
        <div className="bg-orange-50 dark:bg-orange-500/10 rounded-2xl p-3 text-center">
          <div className="text-2xl font-black text-orange-500">{data.total_transfer}</div>
          <div className="text-[10px] text-orange-400">转账总数</div>
        </div>
        <div className="bg-blue-50 dark:bg-blue-500/10 rounded-2xl p-3 text-center">
          <div className="flex items-center justify-center gap-1">
            <ArrowUpRight size={14} className="text-blue-500" />
            <span className="text-2xl font-black text-blue-500">{data.total_sent}</span>
          </div>
          <div className="text-[10px] text-blue-400">我发出</div>
        </div>
        <div className="bg-green-50 dark:bg-green-500/10 rounded-2xl p-3 text-center">
          <div className="flex items-center justify-center gap-1">
            <ArrowDownLeft size={14} className="text-[#07c160]" />
            <span className="text-2xl font-black text-[#07c160]">{data.total_recv}</span>
          </div>
          <div className="text-[10px] text-[#07c160]">我收到</div>
        </div>
      </div>

      {/* 月度趋势 */}
      {trendData.length > 1 && (
        <div className="mb-6">
          <div className="text-xs text-gray-400 mb-2">月度收发趋势</div>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={trendData} margin={{ top: 0, right: 0, bottom: 0, left: -30 }}>
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#bbb' }} tickLine={false}
                interval={Math.max(0, Math.floor(trendData.length / 10) - 1)} />
              <YAxis tick={false} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ borderRadius: 8, fontSize: 12 }}
                formatter={(v: number, name: string) => [`${v} 次`, name === 'sent' ? '我发出' : '我收到']}
                labelFormatter={(l: string) => `20${l.replace('/', ' 年 ')} 月`}
              />
              <Legend
                formatter={(value: string) => value === 'sent' ? '我发出' : '我收到'}
                wrapperStyle={{ fontSize: 10 }}
              />
              <Bar dataKey="sent" fill="#576b95" radius={[3, 3, 0, 0]} maxBarSize={10} />
              <Bar dataKey="recv" fill="#07c160" radius={[3, 3, 0, 0]} maxBarSize={10} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 联系人排行 */}
      {data.contacts.length > 0 && (
        <div>
          <div className="text-xs text-gray-400 mb-3">联系人红包/转账排行</div>
          <div className="space-y-2">
            {displayContacts.map((c, i) => (
              <div
              key={c.username}
              onClick={() => onContactClick?.(c.username)}
              className={`flex items-center gap-3 px-3 py-2 bg-[#f8f9fb] dark:bg-white/5 rounded-xl ${onContactClick ? 'cursor-pointer hover:bg-[#e7f8f0] dark:hover:bg-[#07c160]/10' : ''} transition-colors`}
            >
                <span className={`text-xs font-black w-5 text-center flex-shrink-0 ${
                  i === 0 ? 'text-[#ff9500]' : i === 1 ? 'text-[#8b5cf6]' : i === 2 ? 'text-[#10aeff]' : 'text-gray-300'
                }`}>{i + 1}</span>
                <img loading="lazy" src={avatarSrc(c.avatar)} className="w-7 h-7 rounded-full flex-shrink-0" alt="" />
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-bold text-[#1d1d1f] dk-text truncate${privacyMode ? ' privacy-blur' : ''}`}>
                    {c.name}
                  </div>
                  <div className="flex gap-2 mt-0.5 text-[10px] text-gray-400">
                    {c.sent_red_packet > 0 && <span>发红包 {c.sent_red_packet}</span>}
                    {c.recv_red_packet > 0 && <span className="text-red-400">收红包 {c.recv_red_packet}</span>}
                    {c.sent_transfer > 0 && <span>发转账 {c.sent_transfer}</span>}
                    {c.recv_transfer > 0 && <span className="text-[#07c160]">收转账 {c.recv_transfer}</span>}
                  </div>
                </div>
                <span className="text-sm font-black text-[#1d1d1f] dk-text flex-shrink-0">{c.total}</span>
              </div>
            ))}
          </div>
          {data.contacts.length > 10 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="w-full mt-2 flex items-center justify-center gap-1 text-xs text-gray-400 hover:text-[#07c160] transition-colors py-2"
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {expanded ? '收起' : `查看全部 ${data.contacts.length} 人`}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
