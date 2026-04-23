/**
 * 每日社交简报 Banner —— AI 首页顶部
 *
 * 懒生成：首次访问当日 /daily-digest/today 会触发后端统计并落库；
 * 后续命中缓存。LocalStorage 按日期关闭避免每天重复打扰。
 */

import React, { useEffect, useState } from 'react';
import {
  Sunrise, Users, MoonStar, Cake, X, ChevronDown, ChevronUp,
} from 'lucide-react';
import axios from 'axios';
import { avatarSrc } from '../../utils/avatar';
import type { ContactStats } from '../../types';

interface DigestActiveContact {
  username: string;
  name: string;
  avatar?: string;
  message_count?: number;
}
interface DigestSleepingFriend {
  username: string;
  name: string;
  avatar?: string;
  total_messages: number;
  days_since: number;
  last_message_time: string;
}
interface DigestUpcomingAnniv {
  type: string;
  username: string;
  display_name: string;
  date: string;
  days_until: number;
}
interface DailyDigest {
  date: string;
  active_contact_count: number;
  active_contacts: DigestActiveContact[];
  sleeping_count: number;
  sleeping_friends: DigestSleepingFriend[];
  upcoming_anniversaries: DigestUpcomingAnniv[];
  generated_at: number;
}

interface Props {
  contacts: ContactStats[]; // 用于点击时按 username 找对应联系人对象
  onContactClick?: (contact: ContactStats) => void;
}

const DISMISS_KEY_PREFIX = 'welink:daily-digest-dismissed:';
const COLLAPSED_KEY = 'welink:daily-digest-collapsed';

export const DailyDigestBanner: React.FC<Props> = ({ contacts, onContactClick }) => {
  const [digest, setDigest] = useState<DailyDigest | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === '1');

  useEffect(() => {
    axios.get<DailyDigest>('/api/daily-digest/today')
      .then(r => {
        setDigest(r.data);
        // 检查今天是否已关闭
        const key = DISMISS_KEY_PREFIX + r.data.date;
        if (localStorage.getItem(key) === '1') setDismissed(true);
      })
      .catch(() => { /* 静默失败，不显示 banner */ });
  }, []);

  const dismiss = () => {
    if (!digest) return;
    localStorage.setItem(DISMISS_KEY_PREFIX + digest.date, '1');
    setDismissed(true);
  };

  const toggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
  };

  const clickContact = (username: string) => {
    if (!onContactClick) return;
    const c = contacts.find(x => x.username === username);
    if (c) onContactClick(c);
  };

  if (dismissed || !digest) return null;

  // 没有任何可展示内容时不渲染
  const hasContent = digest.active_contact_count > 0 ||
    digest.sleeping_friends.length > 0 ||
    digest.upcoming_anniversaries.length > 0;
  if (!hasContent) return null;

  const dateLabel = (() => {
    try {
      const d = new Date(digest.date);
      return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
    } catch { return digest.date; }
  })();

  return (
    <div className="relative mx-auto mt-4 mb-3 w-full max-w-3xl rounded-3xl border border-amber-100 dark:border-amber-400/20 bg-gradient-to-br from-amber-50/60 via-rose-50/40 to-purple-50/40 dark:from-amber-500/5 dark:via-rose-500/5 dark:to-purple-500/5 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-3 border-b border-amber-100/60 dark:border-amber-400/10">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-sm shrink-0">
          <Sunrise size={16} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-black text-[#1d1d1f] dark:text-gray-100">今日社交简报</h3>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {dateLabel} · {digest.active_contact_count} 位联系人互动
            {digest.sleeping_count > 0 && ` · ${digest.sleeping_count} 位久未联系`}
            {digest.upcoming_anniversaries.length > 0 && ` · ${digest.upcoming_anniversaries.length} 个即将纪念日`}
          </p>
        </div>
        <button
          onClick={toggleCollapse}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-white/50 dark:hover:bg-white/5 transition-colors"
          title={collapsed ? '展开' : '收起'}
        >
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
        <button
          onClick={dismiss}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-white/50 dark:hover:bg-white/5 transition-colors"
          title="今日不再提醒"
        >
          <X size={14} />
        </button>
      </div>

      {!collapsed && (
        <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* 昨日活跃 */}
          {digest.active_contacts.length > 0 && (
            <section className="rounded-2xl bg-white/70 dark:bg-black/20 border border-amber-100/40 dark:border-white/5 p-3">
              <div className="flex items-center gap-1.5 mb-2 text-[11px] font-bold text-[#1d1d1f] dark:text-gray-200">
                <Users size={12} className="text-[#07c160]" />
                昨日有互动
                <span className="text-gray-400 font-normal">· Top {digest.active_contacts.length}</span>
              </div>
              <ul className="space-y-1.5">
                {digest.active_contacts.map(c => (
                  <li
                    key={c.username}
                    onClick={() => clickContact(c.username)}
                    className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-amber-50 dark:hover:bg-white/5 cursor-pointer"
                  >
                    <img loading="lazy" src={avatarSrc(c.avatar || '')} alt="" className="w-6 h-6 rounded-full object-cover bg-gray-100" />
                    <span className="flex-1 text-xs dk-text truncate">{c.name}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 沉睡的老朋友 */}
          {digest.sleeping_friends.length > 0 && (
            <section className="rounded-2xl bg-white/70 dark:bg-black/20 border border-amber-100/40 dark:border-white/5 p-3">
              <div className="flex items-center gap-1.5 mb-2 text-[11px] font-bold text-[#1d1d1f] dark:text-gray-200">
                <MoonStar size={12} className="text-[#576b95]" />
                沉睡的老朋友
                <span className="text-gray-400 font-normal">· ≥500 条 / ≥30 天未联系</span>
              </div>
              <ul className="space-y-1.5">
                {digest.sleeping_friends.map(c => (
                  <li
                    key={c.username}
                    onClick={() => clickContact(c.username)}
                    className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-amber-50 dark:hover:bg-white/5 cursor-pointer"
                  >
                    <img loading="lazy" src={avatarSrc(c.avatar || '')} alt="" className="w-6 h-6 rounded-full object-cover bg-gray-100" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs dk-text truncate">{c.name}</div>
                      <div className="text-[10px] text-gray-400 truncate">
                        {c.total_messages.toLocaleString()} 条 · {c.days_since} 天未聊
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 即将纪念日 */}
          {digest.upcoming_anniversaries.length > 0 && (
            <section className="rounded-2xl bg-white/70 dark:bg-black/20 border border-amber-100/40 dark:border-white/5 p-3">
              <div className="flex items-center gap-1.5 mb-2 text-[11px] font-bold text-[#1d1d1f] dark:text-gray-200">
                <Cake size={12} className="text-[#ff9500]" />
                3 天内纪念日
              </div>
              <ul className="space-y-1.5">
                {digest.upcoming_anniversaries.slice(0, 5).map((a, i) => (
                  <li
                    key={`${a.username}-${a.type}-${i}`}
                    onClick={() => clickContact(a.username)}
                    className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-amber-50 dark:hover:bg-white/5 cursor-pointer"
                  >
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-pink-400 to-orange-400 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                      {a.days_until}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs dk-text truncate">{a.display_name}</div>
                      <div className="text-[10px] text-gray-400">
                        {a.date}{a.days_until === 0 ? ' · 今天' : a.days_until === 1 ? ' · 明天' : ` · ${a.days_until} 天后`}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
};

export default DailyDigestBanner;
