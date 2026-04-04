/**
 * 联系人深度分析面板 - 小时/周/日历/指纹
 */

import React, { useState, useMemo } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid, Legend } from 'recharts';
import { Moon, Gift, MessageSquare, Zap, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import type { ContactDetail } from '../../types';
import { CalendarHeatmap } from './CalendarHeatmap';
import { DayChatPanel } from './DayChatPanel';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';

interface Props {
  detail: ContactDetail;
  totalMessages: number;
  username: string;
  contactName: string;
}

// 后端 weekly_dist[0]=周日, [1]=周一, ..., [6]=周六（Go time.Weekday）
// 显示顺序改为周一~周日：取 index [1,2,3,4,5,6,0]
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEK_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const HOUR_COLOR = '#10aeff';
const WEEK_COLOR = '#07c160';

type TrendMode = 'total' | 'their' | 'mine';

const ModeBtn: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
      active ? 'bg-[#1d1d1f] text-white' : 'text-gray-400 hover:text-gray-600'
    }`}
  >
    {children}
  </button>
);

export const ContactDetailCharts: React.FC<Props> = ({ detail, totalMessages, username, contactName }) => {
  const { privacyMode } = usePrivacyMode();
  const [dayPanel, setDayPanel] = useState<{ date: string; count: number } | null>(null);
  const [trendMode, setTrendMode] = useState<TrendMode>('total');
  const hourlyData = (detail.hourly_dist ?? []).map((v, h) => ({
    label: `${h.toString().padStart(2, '0')}`,
    value: v,
    isLateNight: h < 5,
  }));

  const weeklyData = WEEK_ORDER.map((i, idx) => ({
    label: WEEK_LABELS[idx],
    value: (detail.weekly_dist ?? [])[i] ?? 0,
  }));

  const monthlyChartData = useMemo(() => {
    const months = new Set([
      ...Object.keys(detail.their_monthly_trend ?? {}),
      ...Object.keys(detail.my_monthly_trend ?? {}),
    ]);
    return Array.from(months).sort().map((m) => ({
      month: m,
      their: detail.their_monthly_trend?.[m] ?? 0,
      mine: detail.my_monthly_trend?.[m] ?? 0,
      total: (detail.their_monthly_trend?.[m] ?? 0) + (detail.my_monthly_trend?.[m] ?? 0),
    }));
  }, [detail]);

  const peakDay = useMemo(() => {
    const entries = Object.entries(detail.daily_heatmap);
    if (entries.length === 0) return null;
    return entries.reduce((best, cur) => cur[1] > best[1] ? cur : best);
  }, [detail.daily_heatmap]);

  const initiationRatio = detail.total_sessions > 0
    ? Math.round(detail.initiation_count / detail.total_sessions * 100)
    : 0;

  const lateNightRatio = totalMessages > 0
    ? Math.round(detail.late_night_count / totalMessages * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* 社交指纹卡片行 */}
      <p className="text-xs text-gray-400 -mb-3">与该联系人的互动特征统计</p>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-[#1d1d1f] text-white rounded-2xl p-4 flex flex-col gap-2">
          <Moon size={18} className="text-blue-400" />
          <div className="text-2xl font-black">{detail.late_night_count.toLocaleString()}</div>
          <div className="text-xs text-gray-400">深夜消息 (0–5点)</div>
          <div className="text-xs text-blue-400 font-bold">{lateNightRatio}% 占比</div>
        </div>
        <div className="bg-[#07c160] text-white rounded-2xl p-4 flex flex-col gap-2">
          <Zap size={18} className="text-green-100" />
          <div className="text-2xl font-black">{initiationRatio}%</div>
          <div className="text-xs text-green-100">主动发起对话</div>
          <div className="text-xs text-green-200">{detail.initiation_count} 次 / {detail.total_sessions} 段，以你发出第一条消息为准</div>
        </div>
        <div className="bg-gradient-to-br from-red-400 to-red-500 text-white rounded-2xl p-4 flex flex-col gap-2">
          <Gift size={18} className="text-red-100" />
          <div className="text-2xl font-black">{detail.red_packet_count ?? 0}</div>
          <div className="text-xs text-red-100">红包</div>
          <div className="text-xs text-red-200">双方合计次数</div>
        </div>
        <div className="bg-gradient-to-br from-orange-400 to-orange-500 text-white rounded-2xl p-4 flex flex-col gap-2">
          <Gift size={18} className="text-orange-100" />
          <div className="text-2xl font-black">{detail.transfer_count ?? 0}</div>
          <div className="text-xs text-orange-100">转账</div>
          <div className="text-xs text-orange-200">双方合计次数</div>
        </div>
        <div className="bg-[#576b95] text-white rounded-2xl p-4 flex flex-col gap-2">
          <MessageSquare size={18} className="text-purple-200" />
          <div className="text-2xl font-black">{detail.total_sessions}</div>
          <div className="text-xs text-purple-200">对话段落</div>
          <div className="text-xs text-purple-300">消息间隔 &gt; 6h 视为新段落</div>
        </div>
      </div>

      {/* 红包/转账时间线 */}
      {(detail.money_timeline?.length ?? 0) > 0 && (
        <div className="bg-[#f8f9fb] dk-subtle rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-2">
              <Gift size={14} /> 红包/转账记录
            </h4>
            <span className="text-xs text-gray-400">
              红包 {detail.red_packet_count ?? 0} · 转账 {detail.transfer_count ?? 0}
            </span>
          </div>
          <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
            {detail.money_timeline!.map((evt, i) => (
              <div key={i} className="flex items-center gap-3 text-xs">
                <span className="text-gray-400 w-32 flex-shrink-0 font-mono">{evt.time}</span>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold ${
                  evt.kind === '红包'
                    ? 'bg-red-50 text-red-500 dark:bg-red-500/15 dark:text-red-400'
                    : 'bg-orange-50 text-orange-600 dark:bg-orange-500/15 dark:text-orange-400'
                }`}>
                  {evt.kind}
                </span>
                {evt.is_mine ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-bold dark:bg-gray-800 dark:text-gray-400">
                    <ArrowUpRight size={10} />我发出
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 text-[#07c160] font-bold dark:bg-green-500/15 dark:text-green-400">
                    <ArrowDownLeft size={10} />我收到
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 小时 + 周分布 并排 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-[#f8f9fb] dk-subtle rounded-2xl p-4">
          <h4 className="text-sm font-black text-gray-600 dark:text-gray-400 uppercase mb-1 tracking-wider">24 小时分布</h4>
          <p className="text-xs text-gray-400 mb-3">按消息发送时间统计，深色为深夜 0–5 点</p>
          <ResponsiveContainer width="100%" height={90}>
            <BarChart data={hourlyData} margin={{ top: 0, right: 0, bottom: 0, left: -30 }}>
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#bbb' }} tickLine={false} interval={3} />
              <YAxis tick={false} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ borderRadius: 8, fontSize: 12, border: '1px solid #eee' }}
                formatter={(v) => [`${v} 条`, '']}
                labelFormatter={(l) => `${l}:00`}
              />
              <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={14}>
                {hourlyData.map((entry, i) => (
                  <Cell key={i} fill={entry.isLateNight ? '#576b95' : HOUR_COLOR} opacity={entry.isLateNight ? 0.9 : 0.75} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="flex gap-3 mt-1 text-xs text-gray-400">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-[#576b95] inline-block" />深夜</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-[#10aeff] inline-block" />白天</span>
          </div>
        </div>

        <div className="bg-[#f8f9fb] dk-subtle rounded-2xl p-4">
          <h4 className="text-sm font-black text-gray-600 dark:text-gray-400 uppercase mb-1 tracking-wider">每周活跃分布</h4>
          <p className="text-xs text-gray-400 mb-3">一周各天的消息总量分布</p>
          <ResponsiveContainer width="100%" height={90}>
            <BarChart data={weeklyData} margin={{ top: 0, right: 0, bottom: 0, left: -30 }}>
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#999' }} tickLine={false} />
              <YAxis tick={false} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ borderRadius: 8, fontSize: 12, border: '1px solid #eee' }}
                formatter={(v) => [`${v} 条`, '']}
              />
              <Bar dataKey="value" fill={WEEK_COLOR} radius={[4, 4, 0, 0]} maxBarSize={28} opacity={0.8} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 日历热力图 */}
      {Object.keys(detail.daily_heatmap).length > 0 && (
        <div className="bg-[#f8f9fb] rounded-2xl p-4">
          <div className="flex items-center justify-between mb-1">
            <h4 className="text-sm font-black text-gray-600 uppercase tracking-wider">聊天日历</h4>
            {peakDay && (
              <button
                onClick={() => setDayPanel({ date: peakDay[0], count: peakDay[1] })}
                className="flex items-center gap-1.5 text-[10px] font-bold text-[#07c160] bg-[#07c16012] hover:bg-[#07c16022] px-2.5 py-1 rounded-full transition-colors"
                title="查看最密集那天的聊天记录"
              >
                <span>🔥</span>
                <span>最密集：{peakDay[0]}（{peakDay[1].toLocaleString()} 条）</span>
              </button>
            )}
          </div>
          <p className="text-xs text-gray-400 mb-3">每格代表一天，颜色越深表示当天消息越多，点击可查看具体数量</p>
          <CalendarHeatmap
            data={detail.daily_heatmap}
            onDayClick={(date, count) => setDayPanel({ date, count })}
          />
          <div className="flex items-center gap-1 mt-2 text-xs text-gray-400">
            <span>少</span>
            {['#ebedf0','#9be9a8','#40c463','#30a14e','#216e39'].map(c => (
              <span key={c} className="w-3 h-3 rounded-sm inline-block" style={{ background: c }} />
            ))}
            <span>多</span>
          </div>
        </div>
      )}

      {/* 聊天趋势折线图 */}
      {monthlyChartData.length > 1 && (
        <div className="bg-[#f8f9fb] rounded-2xl p-4">
          <div className="flex items-center justify-between mb-1">
            <h4 className="text-sm font-black text-gray-600 uppercase tracking-wider">聊天趋势</h4>
            <div className="flex items-center gap-1 bg-white rounded-xl p-1 shadow-sm">
              <ModeBtn active={trendMode === 'total'} onClick={() => setTrendMode('total')}>总数</ModeBtn>
              <ModeBtn active={trendMode === 'their'} onClick={() => setTrendMode('their')}>对方</ModeBtn>
              <ModeBtn active={trendMode === 'mine'}  onClick={() => setTrendMode('mine')}>我</ModeBtn>
            </div>
          </div>
          <p className="text-xs text-gray-400 mb-3">每月消息条数折线图</p>
          <div className="h-[160px] sm:h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyChartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#bbb' }} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: '#bbb' }} tickLine={false} axisLine={false}
                  tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v} />
                <Tooltip
                  contentStyle={{ borderRadius: 10, fontSize: 12, border: '1px solid #eee', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                  formatter={(v: number, name: string) => [
                    `${v.toLocaleString()} 条`,
                    name === 'total' ? '总数' : name === 'their' ? (privacyMode ? '对方' : contactName) : '我',
                  ]}
                />
                {trendMode === 'total' && (
                  <Line type="monotone" dataKey="total" stroke="#07c160" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                )}
                {trendMode === 'their' && (
                  <Line type="monotone" dataKey="their" stroke="#576b95" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                )}
                {trendMode === 'mine' && (
                  <Line type="monotone" dataKey="mine" stroke="#10aeff" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-4 mt-2 text-xs text-gray-400">
            {trendMode === 'total' && <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#07c160] inline-block rounded" />总数</span>}
            {trendMode === 'their' && <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#576b95] inline-block rounded" /><span className={privacyMode ? 'privacy-blur' : ''}>{contactName}</span></span>}
            {trendMode === 'mine'  && <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#10aeff] inline-block rounded" />我</span>}
          </div>
        </div>
      )}

      {dayPanel && (
        <DayChatPanel
          username={username}
          date={dayPanel.date}
          dayCount={dayPanel.count}
          contactName={contactName}
          onClose={() => setDayPanel(null)}
        />
      )}
    </div>
  );
};
