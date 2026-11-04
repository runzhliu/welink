/**
 * 群友画像弹窗 —— 单个成员在某群的发言分析（Issue #104）
 *
 * 无论对方是不是好友，点击群成员都能看 TA 在这个群的：
 * 排名/占比、时段分布、月度趋势、消息类型、高频词、最近发言。
 * 如果是好友，提供跳转完整私聊分析的入口。
 */

import React, { useEffect, useState } from 'react';
import { X, Loader2, BarChart3, Clock, Moon, CalendarDays, ExternalLink } from 'lucide-react';
import type { GroupMemberDetail } from '../../types';
import { groupsApi } from '../../services/api';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';
import { avatarSrc } from '../../utils/avatar';

interface Props {
  groupUsername: string;
  groupName: string;
  memberWxid: string;
  memberName: string; // 占位显示名（接口返回前先用）
  onClose: () => void;
  // 如果该成员也是好友，点"完整分析"回调（由父级打开 ContactModal）
  onOpenContact?: (() => void) | null;
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export const GroupMemberModal: React.FC<Props> = ({ groupUsername, groupName, memberWxid, memberName, onClose, onOpenContact }) => {
  const { privacyMode } = usePrivacyMode();
  const [data, setData] = useState<GroupMemberDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setErr('');
    setData(null);
    groupsApi.getMemberDetail(groupUsername, memberWxid)
      .then(d => { if (!ignore) setData(d); })
      .catch(e => {
        if (!ignore) {
          const msg = (e as { response?: { data?: { error?: string } }; message?: string })
            ?.response?.data?.error || (e as Error).message || '加载失败';
          setErr(msg);
        }
      })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [groupUsername, memberWxid]);

  const maxHour = data ? Math.max(1, ...data.hourly_dist) : 1;
  const maxWeek = data ? Math.max(1, ...data.weekly_dist) : 1;
  const trend = data?.monthly_trend ?? [];
  const maxTrend = Math.max(1, ...trend.map(t => t.count));
  const lateNightPct = data && data.count > 0 ? (data.late_night_cnt / data.count) * 100 : 0;

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[85vh] overflow-y-auto bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white/90 dark:bg-[#1c1c1e]/90 backdrop-blur px-5 py-4 border-b border-gray-100 dark:border-white/10 flex items-center gap-3">
          {data?.avatar_url ? (
            <img src={avatarSrc(data.avatar_url)} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-[#087f5b] flex items-center justify-center text-white text-sm font-black flex-shrink-0">
              <span className={privacyMode ? 'privacy-blur' : ''}>{(data?.speaker || memberName).charAt(0)}</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className={`text-base font-black text-[#1d1d1f] dark:text-gray-100 truncate ${privacyMode ? 'privacy-blur' : ''}`}>
              {data?.speaker || memberName}
            </div>
            <div className="text-[11px] text-gray-400 truncate">在「{groupName}」的发言画像</div>
          </div>
          {data?.is_contact && onOpenContact && (
            <button
              onClick={() => { onClose(); onOpenContact(); }}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-[#07c160]/10 text-[#07c160] hover:bg-[#07c160]/20 transition-colors flex-shrink-0"
              title="TA 也是你的好友，查看完整私聊分析"
            >
              <ExternalLink size={11} />
              完整分析
            </button>
          )}
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 flex-shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="p-5">
          {loading && (
            <div className="py-16 text-center text-gray-400 text-sm flex items-center justify-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              扫描 TA 在群里的发言…
            </div>
          )}

          {err && !loading && (
            <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/30 p-3 text-xs text-red-700 dark:text-red-300">{err}</div>
          )}

          {data && !loading && data.count === 0 && (
            <div className="py-12 text-center text-gray-400 text-sm">
              TA 在这个群里还没发过言（潜水中 🤿）
            </div>
          )}

          {data && !loading && data.count > 0 && (
            <div className="space-y-5">
              {/* 核心指标 */}
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: '群内排名', value: `#${data.rank}`, sub: `共 ${data.total_spoken} 人发言` },
                  { label: '消息数', value: data.count.toLocaleString(), sub: `占全群 ${data.share_pct.toFixed(1)}%` },
                  { label: '活跃天数', value: String(data.active_days), sub: data.first_message_time ? `${data.first_message_time.slice(0, 10)} 起` : '' },
                  { label: '深夜发言', value: `${lateNightPct.toFixed(0)}%`, sub: `${data.late_night_cnt} 条 (0-6点)` },
                ].map(card => (
                  <div key={card.label} className="rounded-xl bg-gray-50 dark:bg-white/5 p-2.5 text-center">
                    <div className="text-base font-black text-[#1d1d1f] dark:text-gray-100">{card.value}</div>
                    <div className="text-[10px] text-gray-500 font-bold mt-0.5">{card.label}</div>
                    {card.sub && <div className="text-[9px] text-gray-300 mt-0.5 truncate">{card.sub}</div>}
                  </div>
                ))}
              </div>

              {/* 24h 时段分布 */}
              <div>
                <div className="flex items-center gap-1.5 text-xs font-bold text-gray-600 dark:text-gray-300 mb-2">
                  <Clock size={12} className="text-[#07c160]" /> 发言时段
                  {lateNightPct >= 20 && <span className="inline-flex items-center gap-0.5 text-[9px] text-purple-500 bg-purple-50 dark:bg-purple-500/10 px-1.5 py-0.5 rounded-full"><Moon size={8} />夜猫子</span>}
                </div>
                <div className="flex items-end gap-[2px] h-14">
                  {data.hourly_dist.map((c, h) => (
                    // 注意：百分比高度需要中间层有明确高度（h-full），否则柱子全是 0 高
                    <div key={h} className="flex-1 h-full flex flex-col justify-end" title={`${h}:00 — ${c} 条`}>
                      <div
                        className={`w-full rounded-sm ${h < 6 ? 'bg-purple-300 dark:bg-purple-500/60' : 'bg-[#07c160]/70'}`}
                        style={{ height: `${Math.max(c > 0 ? 8 : 2, (c / maxHour) * 100)}%` }}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex justify-between text-[8px] text-gray-300 mt-0.5 px-0.5">
                  <span>0</span><span>6</span><span>12</span><span>18</span><span>23</span>
                </div>
              </div>

              {/* 周分布 + 月度趋势 并排 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-gray-600 dark:text-gray-300 mb-2">
                    <CalendarDays size={12} className="text-[#10aeff]" /> 周分布
                  </div>
                  <div className="flex items-end gap-1 h-14">
                    {data.weekly_dist.map((c, i) => (
                      <div key={i} className="flex-1 h-full flex flex-col items-center gap-0.5" title={`周${WEEKDAYS[i]} — ${c} 条`}>
                        {/* flex-1 区域有确定高度，柱子百分比才生效 */}
                        <div className="w-full flex-1 flex items-end">
                          <div className="w-full rounded-sm bg-[#10aeff]/70" style={{ height: `${Math.max(c > 0 ? 8 : 2, (c / maxWeek) * 100)}%` }} />
                        </div>
                        <span className="text-[8px] text-gray-300">{WEEKDAYS[i]}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-gray-600 dark:text-gray-300 mb-2">
                    <BarChart3 size={12} className="text-[#ff9500]" /> 近一年趋势
                  </div>
                  <div className="flex items-end gap-[2px] h-12">
                    {trend.map(t => (
                      <div key={t.month} className="flex-1 h-full flex items-end" title={`${t.month} — ${t.count} 条`}>
                        <div className="w-full rounded-sm bg-[#ff9500]/60" style={{ height: `${Math.max(t.count > 0 ? 8 : 2, (t.count / maxTrend) * 100)}%` }} />
                      </div>
                    ))}
                  </div>
                  {trend.length > 0 && (
                    <div className="flex justify-between text-[8px] text-gray-300 mt-0.5">
                      <span>{trend[0].month.slice(2)}</span>
                      <span>{trend[trend.length - 1].month.slice(2)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* 消息类型 */}
              {Object.keys(data.type_dist ?? {}).length > 0 && (
                <div>
                  <div className="text-xs font-bold text-gray-600 dark:text-gray-300 mb-2">消息类型</div>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(data.type_dist).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                      <span key={k} className="px-2 py-1 rounded-lg bg-gray-100 dark:bg-white/5 text-[11px] text-gray-600 dark:text-gray-300">
                        {k} <span className="font-bold text-[#1d1d1f] dark:text-gray-100">{v.toLocaleString()}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 高频词 */}
              {(data.top_words ?? []).length > 0 && (
                <div>
                  <div className="text-xs font-bold text-gray-600 dark:text-gray-300 mb-2">TA 的高频词</div>
                  <div className={`flex flex-wrap gap-1.5 ${privacyMode ? 'privacy-blur' : ''}`}>
                    {data.top_words.slice(0, 20).map((w, i) => (
                      <span
                        key={w.word}
                        className={`px-2 py-1 rounded-lg text-[11px] ${
                          i < 3 ? 'bg-[#07c160]/10 text-[#07c160] font-bold' : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300'
                        }`}
                      >
                        {w.word} <span className="opacity-50">{w.count}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 最近发言 */}
              {(data.recent_msgs ?? []).length > 0 && (
                <div>
                  <div className="text-xs font-bold text-gray-600 dark:text-gray-300 mb-2">最近发言</div>
                  <div className="space-y-1.5">
                    {(data.recent_msgs ?? []).map((m, i) => (
                      <div key={i} className="rounded-xl bg-gray-50 dark:bg-white/5 px-3 py-2">
                        <div className={`text-xs text-[#1d1d1f] dark:text-gray-200 break-words ${privacyMode ? 'privacy-blur' : ''}`}>{m.content}</div>
                        <div className="text-[9px] text-gray-300 mt-1">{m.time}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
