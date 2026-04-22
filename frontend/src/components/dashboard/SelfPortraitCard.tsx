/**
 * 个人自画像 —— 三个 tab 合并了原先分散的三张卡：
 *   - 概览：原 SelfPortrait（我的发送数据聚合，LLM 炼化入口）
 *   - MBTI：原 MBTICard（主动率/时段/长度/表情四轴）
 *   - 标签：原 MyPersonaCard（规则派生 3 个标签，不调 LLM）
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, User, Clock, MessageSquare, Calendar, Zap, Users, Sparkles } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { SelfPortrait, ContactStats, GlobalStats } from '../../types';
import { contactsApi } from '../../services/api';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';
import { ForgeSkillModal } from '../contact/ForgeSkillModal';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

type Tab = 'overview' | 'mbti' | 'tags';

interface Props {
  blockedDisplayNames?: Set<string>;
  contacts?: ContactStats[];
  globalStats?: GlobalStats | null;
  onOpenSettings?: () => void;
}

// ─── MBTI 计算（从原 MBTICard 搬来） ─────────────────────────────────────
function computeMBTI(contacts: ContactStats[], globalStats: GlobalStats | null) {
  let myMsgs = 0, theirMsgs = 0, myChars = 0, lateNight = 0, totalMsgs = 0;
  for (const c of contacts) {
    myMsgs += c.my_messages ?? 0;
    theirMsgs += c.their_messages ?? 0;
    myChars += c.my_chars ?? 0;
    totalMsgs += c.total_messages ?? 0;
  }
  const hourly = (globalStats as unknown as { hourly?: number[] })?.hourly;
  if (hourly && hourly.length >= 24) {
    for (let h = 0; h < 6; h++) lateNight += hourly[h] ?? 0;
  }
  const lateRatio = totalMsgs > 0 ? lateNight / totalMsgs : 0;
  const initiativeRatio = (myMsgs + theirMsgs) > 0 ? myMsgs / (myMsgs + theirMsgs) : 0.5;
  const avgLen = myMsgs > 0 ? myChars / myMsgs : 0;
  const I_E = initiativeRatio > 0.55 ? 'E' : 'I';
  const N_S = lateRatio > 0.15 ? 'N' : 'S';
  const T_F = avgLen < 8 ? 'T' : 'F';
  let emojiCount = 0, textCount = 0;
  for (const c of contacts) {
    const tc = (c as unknown as { type_cnt?: Record<string, number> }).type_cnt;
    if (!tc) continue;
    emojiCount += tc['表情'] ?? 0;
    textCount += tc['文本'] ?? 0;
  }
  const emojiRatio = textCount > 0 ? emojiCount / textCount : 0;
  const J_P = emojiRatio < 0.05 ? 'J' : 'P';
  return {
    label: I_E + N_S + T_F + J_P,
    axes: [
      { axis: '社交倾向', left: 'I 内向', right: 'E 外向', value: initiativeRatio, pick: I_E, desc: `主动消息占比 ${Math.round(initiativeRatio * 100)}%` },
      { axis: '时段偏好', left: 'S 日间', right: 'N 深夜', value: lateRatio, pick: N_S, desc: `深夜 0-6h 占比 ${Math.round(lateRatio * 100)}%` },
      { axis: '表达风格', left: 'T 简练', right: 'F 详尽', value: Math.min(1, avgLen / 30), pick: T_F, desc: `平均每条 ${avgLen.toFixed(1)} 字` },
      { axis: '情感表达', left: 'J 克制', right: 'P 豪放', value: Math.min(1, emojiRatio * 10), pick: J_P, desc: `表情 / 文字比 ${(emojiRatio * 100).toFixed(1)}%` },
    ],
  };
}

// ─── 标签计算（从原 MyPersonaCard 搬来） ──────────────────────────────────
interface PersonaTag { label: string; desc: string }
function computePersonaTags(contacts: ContactStats[], globalStats: GlobalStats | null): PersonaTag[] {
  const candidates: { tag: PersonaTag; strength: number }[] = [];
  const totalMine = contacts.reduce((s, c) => s + (c.my_messages ?? 0), 0);
  const totalTheirs = contacts.reduce((s, c) => s + (c.their_messages ?? 0), 0);
  const totalMyChars = contacts.reduce((s, c) => s + (c.my_chars ?? 0), 0);
  const active = contacts.filter(c => (c.my_messages ?? 0) > 10).length;

  if (totalMine > 0 && contacts.length > 0) {
    const topMine = contacts.reduce((m, c) => Math.max(m, c.my_messages ?? 0), 0);
    const share = topMine / totalMine;
    if (share > 0.4) candidates.push({ tag: { label: '专情型', desc: `${Math.round(share * 100)}% 的消息发给了一个人` }, strength: share });
  }
  if (active > 80) candidates.push({ tag: { label: '社交达人', desc: `在 ${active} 个联系人里主动发过消息` }, strength: Math.min(1, active / 120) });

  if (totalMine > 100) {
    const avgLen = totalMyChars / totalMine;
    if (avgLen >= 20) candidates.push({ tag: { label: '字多党', desc: `平均每条 ${avgLen.toFixed(1)} 字，喜欢长句` }, strength: Math.min(1, (avgLen - 20) / 30 + 0.6) });
    else if (avgLen <= 7) candidates.push({ tag: { label: '惜字如金', desc: `平均每条 ${avgLen.toFixed(1)} 字，言简意赅` }, strength: Math.min(1, (8 - avgLen) / 6 + 0.6) });
  }

  if (totalMine > 100 && totalTheirs > 100) {
    const r = totalMine / totalTheirs;
    if (r > 1.8) candidates.push({ tag: { label: '主场话痨', desc: `你说的是对方的 ${r.toFixed(1)} 倍` }, strength: Math.min(1, (r - 1.5) / 3 + 0.5) });
    else if (r < 0.6) candidates.push({ tag: { label: '倾听者', desc: `对方说的是你的 ${(1 / r).toFixed(1)} 倍` }, strength: Math.min(1, (0.7 - r) / 0.5 + 0.5) });
  }

  if (globalStats?.late_night_ranking?.length && totalMine > 0) {
    const ln = globalStats.late_night_ranking.reduce((s, e) => s + e.late_night_count, 0);
    const ratio = ln / (totalMine + totalTheirs);
    if (ratio > 0.1) candidates.push({ tag: { label: '深夜战士', desc: `凌晨 0~5 点约占总聊天 ${Math.round(ratio * 100)}%` }, strength: Math.min(1, ratio / 0.3 + 0.3) });
  }

  if (totalMine + totalTheirs > 0) {
    let weighted = 0, weight = 0;
    for (const c of contacts) {
      const t = c.total_messages ?? 0;
      if (t < 50 || !c.type_pct) continue;
      const p = (c.type_pct['图片'] ?? 0) + (c.type_pct['表情'] ?? 0);
      weighted += p * t;
      weight += t;
    }
    if (weight > 0) {
      const avg = weighted / weight;
      if (avg > 20) candidates.push({ tag: { label: '表情包选手', desc: `平均 ${avg.toFixed(0)}% 的消息是图片/表情` }, strength: Math.min(1, avg / 40 + 0.3) });
      else if (avg < 4) candidates.push({ tag: { label: '纯文本派', desc: `图片/表情仅占 ${avg.toFixed(1)}%，几乎全靠文字` }, strength: Math.min(1, (5 - avg) / 5 + 0.5) });
    }
  }

  candidates.sort((a, b) => b.strength - a.strength);
  const picked = candidates.slice(0, 3).map(c => c.tag);
  if (picked.length === 0) return [{ label: '均衡型', desc: '各项特征都没到显著档位，属于典型的普通用户' }];
  return picked;
}

export const SelfPortraitCard: React.FC<Props> = ({ blockedDisplayNames, contacts = [], globalStats = null, onOpenSettings }) => {
  const { privacyMode } = usePrivacyMode();
  const [data, setData] = useState<SelfPortrait | null>(null);
  const [loading, setLoading] = useState(true);
  const [forgeOpen, setForgeOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');

  useEffect(() => {
    let cancelled = false;
    contactsApi.getSelfPortrait().then(res => {
      if (!cancelled) { setData(res); setLoading(false); }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const displayMostContacted = data && (!blockedDisplayNames || !blockedDisplayNames.has(data.most_contacted_name))
    ? data.most_contacted_name
    : '';

  const mbti = useMemo(() => contacts.length > 0 ? computeMBTI(contacts, globalStats) : null, [contacts, globalStats]);
  const tags = useMemo(() => contacts.length > 0 ? computePersonaTags(contacts, globalStats) : [], [contacts, globalStats]);

  if (loading) {
    return (
      <div className="bg-white dk-card rounded-3xl border border-gray-100 dk-border p-6">
        <div className="flex items-center gap-2 mb-4">
          <User size={18} className="text-[#07c160]" />
          <h3 className="text-lg font-black text-[#1d1d1f] dk-text">个人自画像</h3>
        </div>
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <Loader2 size={24} className="text-[#07c160] animate-spin" />
          <div className="text-center">
            <p className="text-xs text-gray-400">正在聚合所有联系人的发送数据…</p>
            <p className="text-[10px] text-gray-300 mt-1">需要遍历全部消息统计你的发言指纹，请耐心等待</p>
          </div>
        </div>
      </div>
    );
  }

  if (!data || data.total_sent === 0) return null;

  const hourlyData = data.hourly_dist.map((v, h) => ({ label: `${h}`, value: v, isLateNight: h < 5 }));

  const TabBtn: React.FC<{ id: Tab; label: string }> = ({ id, label }) => (
    <button
      onClick={() => setTab(id)}
      className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
        tab === id
          ? 'bg-[#07c160]/10 text-[#07c160]'
          : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="bg-white dk-card rounded-3xl border border-gray-100 dk-border p-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <User size={18} className="text-[#07c160]" />
          <h3 className="text-lg font-black text-[#1d1d1f] dk-text">个人自画像</h3>
        </div>
        <button
          onClick={() => setForgeOpen(true)}
          className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#8b5cf6]/10 text-[#8b5cf6] hover:bg-[#8b5cf6]/20 transition-colors"
          title="把自己的写作风格炼化为 Skill"
        >
          <Sparkles size={11} />
          炼化我的 Skill
        </button>
      </div>
      <div className="flex items-center gap-1 mb-4 -mx-1">
        <TabBtn id="overview" label="概览" />
        {mbti && <TabBtn id="mbti" label="MBTI" />}
        {tags.length > 0 && <TabBtn id="tags" label="标签" />}
      </div>

      {tab === 'overview' && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <div className="bg-[#07c160]/5 rounded-2xl p-3 text-center">
              <MessageSquare size={14} className="mx-auto text-[#07c160] mb-1" />
              <div className="text-xl font-black text-[#07c160]">{data.total_sent.toLocaleString()}</div>
              <div className="text-[10px] text-gray-400">发出消息</div>
            </div>
            <div className="bg-[#10aeff]/5 rounded-2xl p-3 text-center">
              <Zap size={14} className="mx-auto text-[#10aeff] mb-1" />
              <div className="text-xl font-black text-[#10aeff]">{Math.round(data.avg_msg_len * 10) / 10}</div>
              <div className="text-[10px] text-gray-400">平均字数</div>
            </div>
            <div className="bg-[#ff9500]/5 rounded-2xl p-3 text-center">
              <Clock size={14} className="mx-auto text-[#ff9500] mb-1" />
              <div className="text-xl font-black text-[#ff9500]">{data.top_active_hour}:00</div>
              <div className="text-[10px] text-gray-400">最活跃时段</div>
            </div>
            <div className="bg-[#8b5cf6]/5 rounded-2xl p-3 text-center">
              <Users size={14} className="mx-auto text-[#8b5cf6] mb-1" />
              <div className="text-xl font-black text-[#8b5cf6]">{data.total_contacts}</div>
              <div className="text-[10px] text-gray-400">联系过的人</div>
            </div>
          </div>
          <div className="bg-[#f8f9fb] dark:bg-white/5 rounded-2xl p-4 mb-4 space-y-1 text-sm">
            <div className="flex items-center gap-2">
              <Calendar size={12} className="text-gray-400 flex-shrink-0" />
              <span className="text-gray-500 dk-text">
                你最爱在 <b className="text-[#1d1d1f] dk-text">{WEEKDAYS[data.top_active_weekday]}</b> 发消息
              </span>
            </div>
            {displayMostContacted && (
              <div className="flex items-center gap-2">
                <User size={12} className="text-gray-400 flex-shrink-0" />
                <span className="text-gray-500 dk-text">
                  最常联系的人是{' '}
                  <b className={`text-[#07c160] ${privacyMode ? 'privacy-blur' : ''}`}>{displayMostContacted}</b>
                  <span className="text-gray-400 font-normal ml-1">（给 TA 发过 {data.most_contacted_count.toLocaleString()} 条）</span>
                </span>
              </div>
            )}
          </div>
          <div>
            <div className="text-xs text-gray-400 mb-1">我的 24 小时发送分布</div>
            <ResponsiveContainer width="100%" height={90}>
              <BarChart data={hourlyData} margin={{ top: 0, right: 0, bottom: 0, left: -30 }}>
                <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#bbb' }} tickLine={false} interval={3} />
                <YAxis tick={false} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, fontSize: 12 }}
                  formatter={(v: number) => [`${v} 条`, '']}
                  labelFormatter={(l: string) => `${l}:00`}
                />
                <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={12}>
                  {hourlyData.map((e, i) => (
                    <Cell key={i} fill={e.isLateNight ? '#576b95' : '#07c160'} opacity={0.8} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {tab === 'mbti' && mbti && (
        <>
          <div className="text-4xl font-black text-[#07c160] tracking-wider mb-1">{mbti.label}</div>
          <p className="text-xs text-gray-400 mb-4">基于主动率、时段、消息长度、表情密度的趣味四轴，仅供娱乐</p>
          <div className="space-y-2.5">
            {mbti.axes.map(a => (
              <div key={a.axis}>
                <div className="flex items-center gap-2 text-xs mb-0.5">
                  <span className="text-gray-400">{a.axis}</span>
                  <span className="ml-auto font-bold text-[#07c160]">{a.pick}</span>
                  <span className="text-[10px] text-gray-400">{a.desc}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-gray-400 w-10">{a.left}</span>
                  <div className="flex-1 h-1 bg-gray-100 dark:bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full bg-[#07c160]" style={{ width: `${Math.round(a.value * 100)}%` }} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-10 text-right">{a.right}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'tags' && tags.length > 0 && (
        <>
          <p className="text-xs text-gray-400 mb-3">规则派生，不调 LLM；每条都能追到一个具体阈值</p>
          <div className="space-y-2">
            {tags.map((t, i) => (
              <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-[#f8f9fb] dark:bg-white/5">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#07c160]/10 text-[#07c160] text-xs font-black flex-shrink-0">{i + 1}</span>
                <div className="flex-1">
                  <div className="text-sm font-bold text-[#1d1d1f] dk-text">{t.label}</div>
                  <p className="text-xs text-gray-500">{t.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {forgeOpen && (
        <ForgeSkillModal
          open={forgeOpen}
          onClose={() => setForgeOpen(false)}
          skillType="self"
          displayName="我的写作风格"
          onOpenSettings={onOpenSettings}
        />
      )}
    </div>
  );
};
