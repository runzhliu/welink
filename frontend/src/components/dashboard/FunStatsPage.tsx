/**
 * 有趣统计页 — 从现有数据派生的轻量趣味卡片（保留独立"情绪点"卡片）。
 *
 *  1. 字数换算     — 你打过多少字，换算成本书数
 *  2. 最话痨一天   — 单日消息数 Top 10
 *  3. 互动档位     — 用「日均消息数」粗分五档
 *  4. 陪伴时长     — 后端 /api/fun/companion-time 算出的 session 总分钟
 *  5. 首次相遇     — 每个联系人的第一条消息 + 时间
 *  6. 表情包浓度   — 每个人的图片+表情占比（高到低）
 *  7. 独白指数     — 关系中谁在"唱独角戏"（单向输出极不平衡）
 *
 * 以下卡片已并入洞察页相应组件（保留是视觉冗余）：
 *  - 微信 MBTI / 我的人设 → SelfPortraitCard 的 MBTI / 标签 tab
 *  - Ghost 月 / 沉默最久 → DriftingApart 的"单月骤降" / "最久没聊" tab
 *  - 最像我的朋友 → SimilarityCard 的"他 vs 我" tab
 *  - 深夜俱乐部 → 洞察页 LateNightGuard（信息更全）
 */

import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, Clock, MessageCircle, Moon, Users, Calendar, Award, ArrowDown, Sticker, Mic, BookMarked, Coffee } from 'lucide-react';
import axios from 'axios';
import type { ContactStats, GlobalStats } from '../../types';
import { avatarSrc } from '../../utils/avatar';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';
import { calendarApi } from '../../services/api';

interface Props {
  contacts: ContactStats[];
  globalStats: GlobalStats | null;
  onContactClick?: (c: ContactStats) => void;
}

// ─── 1. 字数换算 ────────────────────────────────────────────────────────────
const BOOKS = [
  { name: '《哈利波特与魔法石》', chars: 72000 },
  { name: '《小王子》',           chars: 21600 },
  { name: '《围城》',              chars: 260000 },
  { name: '《红楼梦》',           chars: 731000 },
];

function displayName(c: ContactStats): string {
  return c.remark || c.nickname || c.username;
}

export const CharCountCard: React.FC<{ contacts: ContactStats[] }> = ({ contacts }) => {
  const myChars = contacts.reduce((s, c) => s + (c.my_chars ?? 0), 0);
  const book = BOOKS.find(b => myChars >= b.chars * 0.5) || BOOKS[BOOKS.length - 1];
  const ratio = (myChars / book.chars).toFixed(1);
  return (
    <Card icon={<BookOpen size={18} />} title="你打过多少字">
      <div className="text-3xl font-black text-[#07c160] mb-1">{myChars.toLocaleString()} 字</div>
      <p className="text-sm text-gray-500">
        ≈ <span className="font-bold">{ratio}</span> 本 {book.name}
      </p>
      <p className="text-xs text-gray-400 mt-2">
        折算：假设 1 分钟打 60 字，你一共打了约 <span className="font-semibold">{Math.round(myChars / 60).toLocaleString()}</span> 分钟、
        <span className="font-semibold"> {(myChars / 60 / 60).toFixed(1)}</span> 小时。
      </p>
    </Card>
  );
};

// ─── 2. 最话痨一天 ─────────────────────────────────────────────────────────
export const BusiestDayCard: React.FC = () => {
  const [days, setDays] = useState<{ date: string; count: number }[] | null>(null);
  useEffect(() => {
    calendarApi.getHeatmap()
      .then(r => {
        const heat = r.heatmap || {};
        const list = Object.entries(heat).map(([date, count]) => ({ date, count }));
        list.sort((a, b) => b.count - a.count);
        setDays(list.slice(0, 10));
      })
      .catch(() => setDays([]));
  }, []);
  if (!days) return <Card icon={<Calendar size={18} />} title="最话痨的一天"><Loading /></Card>;
  if (days.length === 0) return null;
  const top = days[0];
  return (
    <Card icon={<Calendar size={18} />} title="最话痨的一天">
      <div className="mb-3">
        <div className="text-3xl font-black text-[#07c160] mb-1">{top.count.toLocaleString()} 条</div>
        <p className="text-sm text-gray-500">{top.date}</p>
      </div>
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Top 10</div>
      <div className="space-y-1">
        {days.map((d, i) => (
          <div key={d.date} className="flex items-center gap-2 text-xs">
            <span className="text-gray-300 w-5 tabular-nums">#{i + 1}</span>
            <span className="text-gray-600 flex-1">{d.date}</span>
            <span className="text-[#07c160] font-semibold tabular-nums">{d.count.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </Card>
  );
};

// ─── 3. 互动档位 ───────────────────────────────────────────────────────────
interface Tier { label: string; desc: string; color: string; count: number }
export const InteractionTierCard: React.FC<{ contacts: ContactStats[] }> = ({ contacts }) => {
  const tiers = useMemo(() => {
    const ts: Tier[] = [
      { label: '秒回型', desc: '日均 > 20 条，基本每天都在聊', color: 'bg-red-500',    count: 0 },
      { label: '高频型', desc: '日均 5–20 条',                 color: 'bg-orange-500', count: 0 },
      { label: '日常型', desc: '日均 1–5 条',                  color: 'bg-[#07c160]',  count: 0 },
      { label: '佛系型', desc: '几天一条',                      color: 'bg-blue-400',   count: 0 },
      { label: '随缘型', desc: '很久才有一条',                   color: 'bg-gray-400',   count: 0 },
    ];
    const now = Date.now() / 1000;
    for (const c of contacts) {
      if (!c.total_messages || !c.first_message_ts) continue;
      const days = Math.max(1, (now - c.first_message_ts) / 86400);
      const perDay = c.total_messages / days;
      if      (perDay > 20) ts[0].count++;
      else if (perDay > 5)  ts[1].count++;
      else if (perDay > 1)  ts[2].count++;
      else if (perDay > 0.1) ts[3].count++;
      else                   ts[4].count++;
    }
    return ts;
  }, [contacts]);
  const total = tiers.reduce((s, t) => s + t.count, 0) || 1;
  return (
    <Card icon={<MessageCircle size={18} />} title="互动档位">
      <p className="text-xs text-gray-400 mb-3">按认识天数和消息总量分档，反映「你们到底有多熟」</p>
      <div className="space-y-2">
        {tiers.map(t => (
          <div key={t.label}>
            <div className="flex items-center gap-2 text-xs mb-0.5">
              <span className="font-bold text-[#1d1d1f] dk-text w-14">{t.label}</span>
              <span className="text-gray-400 flex-1 truncate">{t.desc}</span>
              <span className="tabular-nums font-semibold text-[#1d1d1f] dk-text">{t.count} 人</span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className={`h-full ${t.color}`} style={{ width: `${(t.count / total) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
};

// ─── 4. 陪伴时长 ───────────────────────────────────────────────────────────
interface CompanionEntry { username: string; name: string; session_count: number; total_minutes: number; total_messages: number }
interface CompanionStats { total_minutes: number; entries: CompanionEntry[]; gap_seconds: number }

export const CompanionTimeCard: React.FC<{ onContactClick?: (c: ContactStats) => void; contacts: ContactStats[] }> = ({ onContactClick, contacts }) => {
  const [stats, setStats] = useState<CompanionStats | null>(null);
  const { privacyMode } = usePrivacyMode();
  useEffect(() => {
    axios.get<CompanionStats>('/api/fun/companion-time')
      .then(r => setStats(r.data))
      .catch(() => setStats({ total_minutes: 0, entries: [], gap_seconds: 0 }));
  }, []);
  if (!stats) return <Card icon={<Clock size={18} />} title="微信陪伴时长"><Loading /></Card>;
  const hours = Math.floor(stats.total_minutes / 60);
  const days = Math.floor(hours / 24);
  const top = stats.entries.slice(0, 8);
  const byUsername = new Map(contacts.map(c => [c.username, c]));
  return (
    <Card icon={<Clock size={18} />} title="微信陪伴时长">
      <div className="mb-3">
        <div className="text-3xl font-black text-[#07c160] mb-1">{hours.toLocaleString()} 小时</div>
        <p className="text-sm text-gray-500">
          ≈ {days} 天 ≈ {Math.round(hours / 24 * 10) / 10} 天微信时光
        </p>
        <p className="text-[10px] text-gray-400 mt-1">
          按 {Math.round(stats.gap_seconds / 3600)} 小时无消息切 session 估算；单聊之和，不含群聊。
        </p>
      </div>
      {top.length > 0 && (
        <>
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">陪伴 Top</div>
          <div className="space-y-1">
            {top.map((e, i) => {
              const c = byUsername.get(e.username);
              const mins = e.total_minutes;
              const h = Math.floor(mins / 60);
              const m = mins % 60;
              return (
                <button
                  key={e.username}
                  onClick={() => c && onContactClick?.(c)}
                  className="w-full flex items-center gap-2 text-xs text-left hover:bg-[#f8f9fb] dark:hover:bg-white/5 rounded px-1 py-0.5"
                >
                  <span className="text-gray-300 w-5 tabular-nums">#{i + 1}</span>
                  <span className={`text-gray-700 dark:text-gray-300 flex-1 truncate ${privacyMode ? 'privacy-blur' : ''}`}>{e.name}</span>
                  <span className="text-[#07c160] tabular-nums">{h > 0 ? `${h}h ${m}m` : `${m}m`}</span>
                  <span className="text-gray-300 tabular-nums w-12 text-right">{e.session_count} 次</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
};

// ─── 5. 首次相遇 ───────────────────────────────────────────────────────────
export const FirstEncountersCard: React.FC<{ contacts: ContactStats[]; onContactClick?: (c: ContactStats) => void }> = ({ contacts, onContactClick }) => {
  const { privacyMode } = usePrivacyMode();
  const sorted = useMemo(() => {
    return [...contacts]
      .filter(c => c.first_message_ts && c.first_message_ts > 0 && (c.first_msg || '').trim().length > 0)
      .sort((a, b) => (a.first_message_ts ?? 0) - (b.first_message_ts ?? 0))
      .slice(0, 10);
  }, [contacts]);
  return (
    <Card icon={<Users size={18} />} title="首次相遇时间胶囊">
      <p className="text-xs text-gray-400 mb-3">按第一条消息的时间，前 10 位联系人出现的瞬间</p>
      <div className="space-y-2">
        {sorted.map(c => (
          <button
            key={c.username}
            onClick={() => onContactClick?.(c)}
            className="w-full flex items-start gap-2 text-left hover:bg-[#f8f9fb] dark:hover:bg-white/5 rounded p-2 -mx-2"
          >
            <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 bg-gray-100">
              {c.small_head_url && <img loading="lazy" src={avatarSrc(c.small_head_url)} className="w-full h-full object-cover" alt="" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <span className={`text-sm font-bold text-[#1d1d1f] dk-text truncate ${privacyMode ? 'privacy-blur' : ''}`}>{displayName(c)}</span>
                <span className="text-[10px] text-gray-400 flex-shrink-0">{c.first_message_time}</span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{c.first_msg}</p>
            </div>
          </button>
        ))}
        {sorted.length === 0 && <p className="text-xs text-gray-400 text-center py-4">暂无数据</p>}
      </div>
    </Card>
  );
};

// ─── 6. 表情包浓度（图片+表情 / 总消息）────────────────────────────────────
export const EmojiDensityCard: React.FC<{ contacts: ContactStats[]; onContactClick?: (c: ContactStats) => void }> = ({ contacts, onContactClick }) => {
  const { privacyMode } = usePrivacyMode();
  // 筛：至少 100 条消息且 type_pct 可用；type_pct 值是百分比（0~100），按"图片+表情"占比排序
  const ranked = useMemo(() => {
    return contacts
      .filter(c => (c.total_messages ?? 0) >= 100 && c.type_pct)
      .map(c => {
        const img = c.type_pct?.['图片'] ?? 0;
        const emoji = c.type_pct?.['表情'] ?? 0;
        return { c, pct: img + emoji };
      })
      .filter(x => x.pct > 0)
      .sort((a, b) => b.pct - a.pct);
  }, [contacts]);
  if (ranked.length === 0) return null;
  const top = ranked.slice(0, 5);
  const bottom = ranked.slice(-3).reverse();
  return (
    <Card icon={<Sticker size={18} />} title="表情包浓度">
      <p className="text-xs text-gray-400 mb-3">聊天里「图片 + 表情」占比</p>
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">主力输出 Top 5</div>
      <div className="space-y-1 mb-3">
        {top.map((x, i) => (
          <button key={x.c.username} onClick={() => onContactClick?.(x.c)}
            className="w-full flex items-center gap-2 text-xs text-left hover:bg-[#f8f9fb] dark:hover:bg-white/5 rounded px-1 py-0.5">
            <span className="text-gray-300 w-5 tabular-nums">#{i + 1}</span>
            <span className={`text-gray-700 dark:text-gray-300 flex-1 truncate ${privacyMode ? 'privacy-blur' : ''}`}>{displayName(x.c)}</span>
            <span className="text-[#ff9500] font-semibold tabular-nums">{x.pct.toFixed(1)}%</span>
          </button>
        ))}
      </div>
      {bottom.length > 0 && (
        <>
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">几乎纯文本 Bottom 3</div>
          <div className="space-y-1">
            {bottom.map((x, i) => (
              <button key={x.c.username} onClick={() => onContactClick?.(x.c)}
                className="w-full flex items-center gap-2 text-xs text-left hover:bg-[#f8f9fb] dark:hover:bg-white/5 rounded px-1 py-0.5">
                <span className="text-gray-300 w-5 tabular-nums">#{i + 1}</span>
                <span className={`text-gray-700 dark:text-gray-300 flex-1 truncate ${privacyMode ? 'privacy-blur' : ''}`}>{displayName(x.c)}</span>
                <span className="text-gray-400 tabular-nums">{x.pct.toFixed(1)}%</span>
              </button>
            ))}
          </div>
        </>
      )}
    </Card>
  );
};

// ─── 11. 独白指数（单向输出不平衡）────────────────────────────────────────
// 每段关系里 my_messages vs their_messages 谁更多，取绝对差/总数。
// 两个方向各取 Top 3：你在 monologue 的 / 对方在 monologue 的。
export const MonologueCard: React.FC<{ contacts: ContactStats[]; onContactClick?: (c: ContactStats) => void }> = ({ contacts, onContactClick }) => {
  const { privacyMode } = usePrivacyMode();
  const { mine, theirs } = useMemo(() => {
    const candidates = contacts.filter(c => (c.total_messages ?? 0) >= 50 && c.my_messages != null && c.their_messages != null);
    const scored = candidates.map(c => {
      const my = c.my_messages ?? 0;
      const their = c.their_messages ?? 0;
      const tot = my + their;
      if (tot === 0) return null;
      const myShare = my / tot;
      return { c, myShare, my, their };
    }).filter(Boolean) as { c: ContactStats; myShare: number; my: number; their: number }[];
    const mineDominant = [...scored].filter(x => x.myShare >= 0.7).sort((a, b) => b.myShare - a.myShare).slice(0, 3);
    const theirDominant = [...scored].filter(x => x.myShare <= 0.3).sort((a, b) => a.myShare - b.myShare).slice(0, 3);
    return { mine: mineDominant, theirs: theirDominant };
  }, [contacts]);
  if (mine.length === 0 && theirs.length === 0) return null;
  return (
    <Card icon={<Mic size={18} />} title="独白指数">
      <p className="text-xs text-gray-400 mb-3">谁在关系里"唱独角戏"—— 70% 以上消息来自同一方</p>
      {mine.length > 0 && (
        <>
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">你在输出 Top 3</div>
          <div className="space-y-1 mb-3">
            {mine.map(x => (
              <button key={x.c.username} onClick={() => onContactClick?.(x.c)}
                className="w-full flex items-center gap-2 text-xs text-left hover:bg-[#f8f9fb] dark:hover:bg-white/5 rounded px-1 py-0.5">
                <span className={`text-gray-700 dark:text-gray-300 flex-1 truncate ${privacyMode ? 'privacy-blur' : ''}`}>{displayName(x.c)}</span>
                <span className="text-[#07c160] font-semibold tabular-nums">你 {Math.round(x.myShare * 100)}%</span>
                <span className="text-gray-300 tabular-nums w-16 text-right text-[10px]">{x.my.toLocaleString()}/{x.their.toLocaleString()}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {theirs.length > 0 && (
        <>
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">对方在输出 Top 3</div>
          <div className="space-y-1">
            {theirs.map(x => (
              <button key={x.c.username} onClick={() => onContactClick?.(x.c)}
                className="w-full flex items-center gap-2 text-xs text-left hover:bg-[#f8f9fb] dark:hover:bg-white/5 rounded px-1 py-0.5">
                <span className={`text-gray-700 dark:text-gray-300 flex-1 truncate ${privacyMode ? 'privacy-blur' : ''}`}>{displayName(x.c)}</span>
                <span className="text-[#576b95] font-semibold tabular-nums">TA {Math.round((1 - x.myShare) * 100)}%</span>
                <span className="text-gray-300 tabular-nums w-16 text-right text-[10px]">{x.my.toLocaleString()}/{x.their.toLocaleString()}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </Card>
  );
};

// ─── 词语年鉴 ──────────────────────────────────────────────────────────────
interface AlmanacEntry { year: number; word: string; count: number; messages: number; runners: string[] }
interface AlmanacResult { entries: AlmanacEntry[]; generated_at: number }

export const WordAlmanacCard: React.FC = () => {
  const [data, setData] = useState<AlmanacResult | null>(null);
  useEffect(() => {
    axios.get<AlmanacResult>('/api/fun/word-almanac')
      .then(r => setData(r.data))
      .catch(() => setData({ entries: [], generated_at: 0 }));
  }, []);
  if (!data) return <Card icon={<BookMarked size={18} />} title="词语年鉴"><Loading /></Card>;
  if (data.entries.length === 0) return null;
  return (
    <Card icon={<BookMarked size={18} />} title="词语年鉴">
      <p className="text-xs text-gray-400 mb-3">你每一年发送消息里最高频的那个词 —— 一条只属于你的时间轴</p>
      <div className="space-y-2">
        {data.entries.map(e => (
          <div key={e.year} className="flex items-baseline gap-3">
            <span className="text-xs font-black text-gray-300 tabular-nums w-12">{e.year}</span>
            <span className="text-xl font-black text-[#07c160] leading-tight">{e.word}</span>
            <span className="text-[10px] text-gray-400 tabular-nums">{e.count} 次 · 全年 {e.messages} 条</span>
            {e.runners.length > 0 && (
              <span className="text-[10px] text-gray-300 truncate flex-1 text-right">
                亚军：{e.runners.slice(0, 3).join(' · ')}
              </span>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
};

// ─── 失眠陪聊榜 ───────────────────────────────────────────────────────────
interface InsomniaEntry {
  username: string; name: string; avatar: string;
  my_calls: number; responded: number;
  response_rate: number; median_response_sec: number;
}
interface InsomniaResult { entries: InsomniaEntry[]; generated_at: number }

export const InsomniaTopCard: React.FC<{ contacts: ContactStats[]; onContactClick?: (c: ContactStats) => void }> = ({ contacts, onContactClick }) => {
  const [data, setData] = useState<InsomniaResult | null>(null);
  const { privacyMode } = usePrivacyMode();
  const byUsername = useMemo(() => new Map(contacts.map(c => [c.username, c])), [contacts]);
  useEffect(() => {
    axios.get<InsomniaResult>('/api/fun/insomnia-top')
      .then(r => setData(r.data))
      .catch(() => setData({ entries: [], generated_at: 0 }));
  }, []);
  if (!data) return <Card icon={<Coffee size={18} />} title="失眠陪聊榜"><Loading /></Card>;
  if (data.entries.length === 0) {
    return (
      <Card icon={<Coffee size={18} />} title="失眠陪聊榜">
        <p className="text-xs text-gray-400 py-3 text-center">凌晨 2-4 点你没什么"呼叫"样本，睡得挺好</p>
      </Card>
    );
  }
  const fmtMin = (sec: number) => {
    if (sec < 60) return `${sec} 秒`;
    const m = Math.round(sec / 60);
    return `${m} 分`;
  };
  return (
    <Card icon={<Coffee size={18} />} title="失眠陪聊榜">
      <p className="text-xs text-gray-400 mb-3">凌晨 2-4 点你主动发消息后，谁 30 分钟内回了你（响应率 + 中位响应时间）</p>
      <div className="space-y-2">
        {data.entries.map((e, i) => {
          const c = byUsername.get(e.username);
          return (
            <button
              key={e.username}
              onClick={() => c && onContactClick?.(c)}
              className="w-full flex items-center gap-2 text-left hover:bg-gray-50 dark:hover:bg-white/5 rounded-xl px-2 py-1.5"
            >
              <span className="text-gray-300 w-5 tabular-nums text-xs">#{i + 1}</span>
              <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 bg-gray-100">
                {e.avatar && <img loading="lazy" src={avatarSrc(e.avatar)} className="w-full h-full object-cover" alt="" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-bold text-[#1d1d1f] dk-text truncate${privacyMode ? ' privacy-blur' : ''}`}>{e.name}</div>
                <p className="text-[10px] text-gray-400">
                  呼叫 {e.my_calls} 次 · 回应 {e.responded}（<span className="text-[#07c160] font-semibold">{Math.round(e.response_rate * 100)}%</span>）· 中位 {fmtMin(e.median_response_sec)}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
};

// ─── 通用组件 ──────────────────────────────────────────────────────────────
const Card: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
  <section className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 p-5 dk-card dk-border">
    <div className="flex items-center gap-2 mb-3">
      <span className="text-[#07c160]">{icon}</span>
      <h3 className="text-base font-bold text-[#1d1d1f] dk-text">{title}</h3>
    </div>
    {children}
  </section>
);

const Loading: React.FC = () => (
  <div className="flex items-center justify-center py-8 text-gray-400 text-xs">加载中…</div>
);

// ─── 主组件 ────────────────────────────────────────────────────────────────
export const FunStatsPage: React.FC<Props> = ({ contacts, globalStats, onContactClick }) => {
  return (
    <div>
      <div className="mb-6">
        <h3 className="text-xl font-black text-[#1d1d1f] dk-text mb-1">有趣发现</h3>
        <p className="text-sm text-gray-400">从你的聊天数据里派生的轻量趣味卡片</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <CharCountCard contacts={contacts} />
        <BusiestDayCard />
        <InteractionTierCard contacts={contacts} />
        <CompanionTimeCard contacts={contacts} onContactClick={onContactClick} />
        <FirstEncountersCard contacts={contacts} onContactClick={onContactClick} />
        <EmojiDensityCard contacts={contacts} onContactClick={onContactClick} />
        <MonologueCard contacts={contacts} onContactClick={onContactClick} />
        <InsomniaTopCard contacts={contacts} onContactClick={onContactClick} />
        <div className="md:col-span-2">
          <WordAlmanacCard />
        </div>
      </div>
    </div>
  );
};
