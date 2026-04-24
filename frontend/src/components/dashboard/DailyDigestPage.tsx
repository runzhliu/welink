/**
 * 今日简报 —— 独立页面版本
 *
 * 数据源与 DailyDigestBanner 相同（/api/daily-digest/today + forecastApi.get），
 * 但布局是整页三栏卡片 + 头部摘要，无折叠无 dismiss。
 */

import React, { useEffect, useState } from 'react';
import { Sunrise, MoonStar, Cake, Snowflake, AlertCircle, RefreshCw, Loader2 } from 'lucide-react';
import axios from 'axios';
import { avatarSrc } from '../../utils/avatar';
import { forecastApi } from '../../services/api';
import type { ContactStats, ForecastEntry } from '../../types';

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
  sleeping_count: number;
  sleeping_friends: DigestSleepingFriend[];
  upcoming_anniversaries: DigestUpcomingAnniv[];
  generated_at: number;
}

interface Props {
  contacts: ContactStats[];
  onContactClick?: (contact: ContactStats) => void;
}

export const DailyDigestPage: React.FC<Props> = ({ contacts, onContactClick }) => {
  const [digest, setDigest] = useState<DailyDigest | null>(null);
  const [forecasts, setForecasts] = useState<ForecastEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [regenBusy, setRegenBusy] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [d, f] = await Promise.all([
        axios.get<DailyDigest>('/api/daily-digest/today').then(r => r.data).catch(() => null),
        forecastApi.get(10).then(r => r.suggest_contact || []).catch(() => []),
      ]);
      if (d) setDigest(normalizeDigest(d));
      setForecasts(f || []);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void loadAll(); }, []);

  const regen = async () => {
    setRegenBusy(true);
    try {
      const r = await axios.post<DailyDigest>('/api/daily-digest/regen');
      setDigest(normalizeDigest(r.data));
      const f = await forecastApi.get(10);
      setForecasts(f.suggest_contact || []);
    } catch { /* ignore */ }
    finally { setRegenBusy(false); }
  };

  // 防御后端返回 null 列表字段（早期版本 Go 侧会把空结果序列化成 null）
  function normalizeDigest(d: DailyDigest): DailyDigest {
    return {
      ...d,
      sleeping_friends: d.sleeping_friends ?? [],
      upcoming_anniversaries: d.upcoming_anniversaries ?? [],
    };
  }

  const clickContact = (username: string) => {
    if (!onContactClick) return;
    const c = contacts.find(x => x.username === username);
    if (c) onContactClick(c);
  };

  if (loading && !digest) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 gap-2">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-sm">正在生成今日简报…</span>
      </div>
    );
  }
  if (!digest) {
    return <div className="text-center text-gray-400 text-sm mt-16">暂无简报数据</div>;
  }

  const dateLabel = (() => {
    try {
      const d = new Date(digest.date);
      const days = ['日', '一', '二', '三', '四', '五', '六'];
      return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${days[d.getDay()]}`;
    } catch { return digest.date; }
  })();

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <header className="relative rounded-3xl border border-amber-100 dark:border-amber-400/20 bg-gradient-to-br from-amber-50 via-rose-50/60 to-purple-50/60 dark:from-amber-500/10 dark:via-rose-500/10 dark:to-purple-500/10 overflow-hidden p-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shrink-0">
            <Sunrise size={28} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-black text-[#1d1d1f] dark:text-gray-100">今日简报</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{dateLabel}</p>
          </div>
          <button
            onClick={regen}
            disabled={regenBusy}
            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-white/80 dark:bg-black/20 text-gray-500 dark:text-gray-400 hover:text-[#07c160] border border-amber-100/60 dark:border-white/5 transition-colors disabled:opacity-50"
            title="重新生成（丢弃缓存）"
          >
            {regenBusy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {regenBusy ? '生成中' : '刷新'}
          </button>
        </div>
        {/* Meta 摘要 */}
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetaCard label="建议主动联系" value={forecasts.length} color="#fa5151" />
          <MetaCard label="昨日有互动" value={digest.active_contact_count} color="#07c160" />
          <MetaCard label="沉睡老朋友" value={digest.sleeping_count} color="#576b95" />
          <MetaCard label="3 天内纪念日" value={digest.upcoming_anniversaries.length} color="#ff9500" />
        </div>
      </header>

      {/* 三栏主体 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* 建议主动联系 */}
        <SectionCard
          icon={<AlertCircle size={14} className="text-[#fa5151]" />}
          title="建议主动联系"
          subtitle={forecasts.length > 0 ? `${forecasts.length} 位降温 / 濒危` : '暂无'}
          empty={forecasts.length === 0}
        >
          {forecasts.map(f => (
            <li
              key={f.username}
              onClick={() => clickContact(f.username)}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-amber-50 dark:hover:bg-white/5 cursor-pointer"
            >
              <img loading="lazy" src={avatarSrc(f.avatar_url || '')} alt="" className="w-8 h-8 rounded-full object-cover bg-gray-100" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm dk-text truncate">{f.display_name}</span>
                  {f.status === 'endangered'
                    ? <span className="text-[9px] font-bold px-1 rounded bg-[#fa5151]/10 text-[#fa5151] shrink-0">濒危</span>
                    : <span className="text-[9px] font-bold px-1 rounded bg-[#10aeff]/10 text-[#10aeff] shrink-0 inline-flex items-center gap-0.5"><Snowflake size={8} />降温</span>}
                </div>
                <div className="text-[11px] text-gray-400 truncate mt-0.5">
                  {f.days_since_last} 天未联系 · {f.reason || '关系趋冷'}
                </div>
              </div>
            </li>
          ))}
        </SectionCard>

        {/* 沉睡的老朋友 */}
        <SectionCard
          icon={<MoonStar size={14} className="text-[#576b95]" />}
          title="沉睡的老朋友"
          subtitle={digest.sleeping_friends.length > 0
            ? `≥500 条 / ≥30 天未联系 · Top ${digest.sleeping_friends.length}`
            : '暂无匹配'}
          empty={digest.sleeping_friends.length === 0}
        >
          {digest.sleeping_friends.map(c => (
            <li
              key={c.username}
              onClick={() => clickContact(c.username)}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-amber-50 dark:hover:bg-white/5 cursor-pointer"
            >
              <img loading="lazy" src={avatarSrc(c.avatar || '')} alt="" className="w-8 h-8 rounded-full object-cover bg-gray-100" />
              <div className="flex-1 min-w-0">
                <div className="text-sm dk-text truncate">{c.name}</div>
                <div className="text-[11px] text-gray-400 truncate mt-0.5">
                  {c.total_messages.toLocaleString()} 条 · {c.days_since} 天未聊
                </div>
              </div>
            </li>
          ))}
        </SectionCard>

        {/* 3 天内纪念日 */}
        <SectionCard
          icon={<Cake size={14} className="text-[#ff9500]" />}
          title="3 天内纪念日"
          subtitle={digest.upcoming_anniversaries.length > 0 ? `${digest.upcoming_anniversaries.length} 个` : '暂无'}
          empty={digest.upcoming_anniversaries.length === 0}
        >
          {digest.upcoming_anniversaries.map((a, i) => (
            <li
              key={`${a.username}-${a.type}-${i}`}
              onClick={() => clickContact(a.username)}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-amber-50 dark:hover:bg-white/5 cursor-pointer"
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-400 to-orange-400 flex items-center justify-center text-white text-[11px] font-bold shrink-0">
                {a.days_until}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm dk-text truncate">{a.display_name}</div>
                <div className="text-[11px] text-gray-400 mt-0.5">
                  {a.date}{a.days_until === 0 ? ' · 今天' : a.days_until === 1 ? ' · 明天' : ` · ${a.days_until} 天后`}
                </div>
              </div>
            </li>
          ))}
        </SectionCard>
      </div>
    </div>
  );
};

// ─── 子组件 ────────────────────────────────────────────────────────────────

const MetaCard: React.FC<{ label: string; value: number; color: string }> = ({ label, value, color }) => (
  <div className="rounded-2xl bg-white/70 dark:bg-black/20 border border-amber-100/40 dark:border-white/5 px-3 py-2.5">
    <div className="text-2xl font-black tabular-nums" style={{ color }}>{value}</div>
    <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{label}</div>
  </div>
);

const SectionCard: React.FC<{
  icon: React.ReactNode; title: string; subtitle: string;
  empty?: boolean; children: React.ReactNode;
}> = ({ icon, title, subtitle, empty, children }) => (
  <section className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-4">
    <div className="flex items-center gap-1.5 mb-3">
      {icon}
      <h2 className="text-sm font-black text-[#1d1d1f] dark:text-gray-100">{title}</h2>
    </div>
    <div className="text-[11px] text-gray-400 mb-2">{subtitle}</div>
    {empty ? (
      <div className="text-center text-xs text-gray-400 py-8">暂无数据</div>
    ) : (
      <ul className="space-y-1">{children}</ul>
    )}
  </section>
);

export default DailyDigestPage;
