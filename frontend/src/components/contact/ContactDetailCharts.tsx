/**
 * 联系人深度分析面板 - 小时/周/日历/指纹
 */

import React, { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Moon, Gift, MessageSquare, Zap } from 'lucide-react';
import type { ContactDetail } from '../../types';
import { CalendarHeatmap } from './CalendarHeatmap';
import { DayChatPanel } from './DayChatPanel';

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

export const ContactDetailCharts: React.FC<Props> = ({ detail, totalMessages, username, contactName }) => {
  const [dayPanel, setDayPanel] = useState<{ date: string; count: number } | null>(null);
  const hourlyData = detail.hourly_dist.map((v, h) => ({
    label: `${h.toString().padStart(2, '0')}`,
    value: v,
    isLateNight: h < 5,
  }));

  const weeklyData = WEEK_ORDER.map((i, idx) => ({
    label: WEEK_LABELS[idx],
    value: detail.weekly_dist[i],
  }));

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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
        <div className="bg-gradient-to-br from-orange-400 to-orange-500 text-white rounded-2xl p-4 flex flex-col gap-2">
          <Gift size={18} className="text-orange-100" />
          <div className="text-2xl font-black">{detail.money_count}</div>
          <div className="text-xs text-orange-100">红包/转账</div>
          <div className="text-xs text-orange-200">双方合计互动次数</div>
        </div>
        <div className="bg-[#576b95] text-white rounded-2xl p-4 flex flex-col gap-2">
          <MessageSquare size={18} className="text-purple-200" />
          <div className="text-2xl font-black">{detail.total_sessions}</div>
          <div className="text-xs text-purple-200">对话段落</div>
          <div className="text-xs text-purple-300">消息间隔 &gt; 6h 视为新段落</div>
        </div>
      </div>

      {/* 小时分布 */}
      <div className="bg-[#f8f9fb] rounded-2xl p-4">
        <h4 className="text-sm font-black text-gray-600 uppercase mb-1 tracking-wider">24 小时分布</h4>
        <p className="text-xs text-gray-400 mb-3">按消息发送时间（北京时间）统计各小时消息量，深色为深夜 0–5 点</p>
        <ResponsiveContainer width="100%" height={100}>
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

      {/* 周分布 */}
      <div className="bg-[#f8f9fb] rounded-2xl p-4">
        <h4 className="text-sm font-black text-gray-600 uppercase mb-1 tracking-wider">每周活跃分布</h4>
        <p className="text-xs text-gray-400 mb-3">统计与该联系人一周各天的消息总量分布</p>
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

      {/* 日历热力图 */}
      {Object.keys(detail.daily_heatmap).length > 0 && (
        <div className="bg-[#f8f9fb] rounded-2xl p-4">
          <h4 className="text-sm font-black text-gray-600 uppercase mb-1 tracking-wider">聊天日历</h4>
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
