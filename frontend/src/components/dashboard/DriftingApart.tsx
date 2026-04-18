/**
 * 渐行渐远 —— 三个切片 tab 合并了原先分散的三张卡：
 *   - 整体下降：峰值 → 近期的总体跌幅（老行为）
 *   - 单月骤降：某一个月骤降 >80%（原 Ghost 月，走 /api/fun/ghost-months）
 *   - 最久没聊：曾有 20+ 条后最久沉默（原沉默最久 Top 10）
 */

import React, { useEffect, useMemo, useState } from 'react';
import { TrendingDown, CheckCircle2, Ghost, Moon } from 'lucide-react';
import axios from 'axios';
import type { ContactStats } from '../../types';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';
import { avatarSrc } from '../../utils/avatar';
import { RelativeTime } from '../common/RelativeTime';

interface Props {
  contacts: ContactStats[];
  onContactClick?: (c: ContactStats) => void;
}

type Tab = 'overall' | 'ghost' | 'silent';

interface GhostEntry {
  username: string;
  name: string;
  avatar: string;
  month: string;
  before_count: number;
  during_count: number;
  after_count: number;
  drop_ratio: number;
  total_history: number;
}

export const DriftingApart: React.FC<Props> = ({ contacts, onContactClick }) => {
  const { privacyMode } = usePrivacyMode();
  const [tab, setTab] = useState<Tab>('overall');
  const [ghosts, setGhosts] = useState<GhostEntry[] | null>(null);
  const byUsername = useMemo(() => new Map(contacts.map(c => [c.username, c])), [contacts]);

  // 整体下降（原 DriftingApart 行为）
  const drifting = useMemo(() => {
    return contacts
      .filter((c) => {
        if (!c.peak_monthly || c.peak_monthly <= 0) return false;
        if (c.recent_monthly == null) return false;
        const dropRatio = (c.peak_monthly - c.recent_monthly) / c.peak_monthly;
        return dropRatio >= 0.8;
      })
      .map((c) => ({
        contact: c,
        dropRatio: (c.peak_monthly! - (c.recent_monthly ?? 0)) / c.peak_monthly!,
      }))
      .sort((a, b) => b.dropRatio - a.dropRatio)
      .slice(0, 8);
  }, [contacts]);

  // 最久没聊（原 SilentLongestCard）
  const silent = useMemo(() => {
    return [...contacts]
      .filter(c => (c.total_messages ?? 0) >= 20 && c.last_message_ts && c.last_message_ts > 0)
      .sort((a, b) => (a.last_message_ts ?? 0) - (b.last_message_ts ?? 0))
      .slice(0, 10);
  }, [contacts]);

  // Ghost 月（原 GhostMonthCard）—— 切到对应 tab 时再拉，避免首屏额外请求
  useEffect(() => {
    if (tab === 'ghost' && ghosts === null) {
      axios.get<{ entries: GhostEntry[] }>('/api/fun/ghost-months')
        .then(r => setGhosts(r.data.entries || []))
        .catch(() => setGhosts([]));
    }
  }, [tab, ghosts]);

  const TabBtn: React.FC<{ id: Tab; icon: React.ReactNode; label: string; count?: number }> = ({ id, icon, label, count }) => (
    <button
      onClick={() => setTab(id)}
      className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold transition-all ${
        tab === id
          ? 'bg-red-500/10 text-red-600 dark:text-red-400'
          : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
      }`}
    >
      {icon}
      {label}
      {count != null && <span className="text-[10px] opacity-60 ml-0.5">· {count}</span>}
    </button>
  );

  return (
    <div className="dk-card bg-white dk-border border border-gray-100 rounded-2xl p-5 h-full">
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 bg-red-500 rounded-xl flex items-center justify-center flex-shrink-0">
          <TrendingDown size={18} className="text-white" strokeWidth={2.5} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="dk-text text-lg font-black text-[#1d1d1f]">渐行渐远</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {tab === 'overall' && '近一月消息量比历史峰值下降超过 80%'}
            {tab === 'ghost' && '某一个月消息骤降 ≥80% 的"失联月"'}
            {tab === 'silent' && '曾有 20+ 条聊天、现在最久没联系'}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1 mb-3 -mx-1 overflow-x-auto">
        <TabBtn id="overall" icon={<TrendingDown size={12} />} label="整体下降" count={drifting.length} />
        <TabBtn id="ghost" icon={<Ghost size={12} />} label="单月骤降" count={ghosts?.length} />
        <TabBtn id="silent" icon={<Moon size={12} />} label="最久没聊" count={silent.length} />
      </div>

      {tab === 'overall' && (
        drifting.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <CheckCircle2 size={36} className="text-[#07c160] mb-3" />
            <p className="text-sm font-semibold text-[#1d1d1f]">所有关系都很健康</p>
            <p className="text-xs text-gray-400 mt-1">没有联系人出现大幅下降，继续保持吧</p>
          </div>
        ) : (
          <div className="space-y-3">
            {drifting.map(({ contact, dropRatio }) => {
              const displayName = contact.remark || contact.nickname || contact.username;
              const url = avatarSrc(contact.small_head_url || contact.big_head_url);
              const dropPct = Math.round(dropRatio * 100);
              return (
                <div
                  key={contact.username}
                  className={`flex items-center gap-3 rounded-xl px-2 py-1.5 transition-colors ${onContactClick ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5' : ''}`}
                  onClick={() => onContactClick?.(contact)}
                >
                  <div className="w-9 h-9 rounded-xl flex-shrink-0 overflow-hidden bg-gray-100">
                    {url && <img src={url} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold dk-text text-[#1d1d1f] truncate${privacyMode ? ' privacy-blur' : ''}`}>{displayName}</p>
                    <div className="flex items-center gap-2 text-[10px] text-gray-400 mt-0.5">
                      <span>峰值 <span className="font-bold text-gray-600">{Math.round(contact.peak_monthly!)}</span>/月{contact.peak_period && <span className="text-gray-300"> ({contact.peak_period})</span>}</span>
                      <span className="text-gray-200">|</span>
                      <span>近期 <span className="font-bold text-gray-600">{Math.round(contact.recent_monthly ?? 0)}</span>/月</span>
                    </div>
                  </div>
                  <span className="flex-shrink-0 text-xs font-black text-red-500 bg-red-50 dark:bg-red-500/15 px-2 py-0.5 rounded-full">-{dropPct}%</span>
                </div>
              );
            })}
          </div>
        )
      )}

      {tab === 'ghost' && (
        ghosts === null ? (
          <div className="py-8 text-center text-xs text-gray-400">加载中…</div>
        ) : ghosts.length === 0 ? (
          <div className="py-8 text-center">
            <CheckCircle2 size={36} className="text-[#07c160] mb-3 mx-auto" />
            <p className="text-sm font-semibold text-[#1d1d1f]">没有明显的"失联月"</p>
            <p className="text-xs text-gray-400 mt-1">各联系人的月度消息量没有骤降事件</p>
          </div>
        ) : (
          <div className="space-y-2">
            {ghosts.map(e => {
              const c = byUsername.get(e.username);
              return (
                <button
                  key={`${e.username}-${e.month}`}
                  onClick={() => c && onContactClick?.(c)}
                  className="w-full flex items-center gap-3 text-left hover:bg-gray-50 dark:hover:bg-white/5 rounded-xl px-2 py-1.5"
                >
                  <div className="w-9 h-9 rounded-xl flex-shrink-0 overflow-hidden bg-gray-100">
                    {e.avatar && <img src={avatarSrc(e.avatar)} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold dk-text text-[#1d1d1f] truncate${privacyMode ? ' privacy-blur' : ''}`}>{e.name}</p>
                    <p className="text-[10px] text-gray-400">
                      <span className="text-red-500 font-semibold">{e.month}</span> 骤降 {Math.round(e.drop_ratio * 100)}%（{e.before_count.toLocaleString()} → {e.during_count.toLocaleString()}{e.after_count > 0 ? `，之后恢复 ${e.after_count.toLocaleString()}` : '，之后无消息'}）
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )
      )}

      {tab === 'silent' && (
        silent.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-6">暂无数据</p>
        ) : (
          <div className="space-y-1.5">
            {silent.map(c => {
              const displayName = c.remark || c.nickname || c.username;
              return (
                <button
                  key={c.username}
                  onClick={() => onContactClick?.(c)}
                  className="w-full flex items-center gap-2 text-left hover:bg-gray-50 dark:hover:bg-white/5 rounded-xl px-2 py-1.5"
                >
                  <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 bg-gray-100">
                    {c.small_head_url && <img src={avatarSrc(c.small_head_url)} className="w-full h-full object-cover" alt="" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-bold text-[#1d1d1f] dk-text truncate${privacyMode ? ' privacy-blur' : ''}`}>{displayName}</p>
                    <p className="text-xs text-gray-400">
                      上次聊天：<RelativeTime ts={c.last_message_ts} />（{(c.total_messages ?? 0).toLocaleString()} 条历史）
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )
      )}
    </div>
  );
};
