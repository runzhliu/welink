/**
 * 群语料 ROI 诊断 / Group ROI
 *
 * 纯前端聚合：基于 GET /api/groups 已经返回的字段（recent_30d_messages /
 * recent_trend_pct / my_messages / my_rank / my_last_message_ts / last_message_ts）
 * 给每个群打个综合分，三档分流：值得多看 / 可以静音 / 可以放手。
 *
 * 没有 LLM，没有新接口。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Compass, Loader2, Share2, Check, Sparkles, BellOff, LogOut, Search,
} from 'lucide-react';
import html2canvas from 'html2canvas';
import { groupsApi } from '../../services/api';
import type { GroupInfo } from '../../types';
import { avatarSrc } from '../../utils/avatar';
import { prepareForCapture } from '../../utils/exportPng';
import { useToast } from '../common/Toast';

type Tier = 'keep' | 'mute' | 'leave';

interface Scored {
  group: GroupInfo;
  score: number;          // 0-100
  activity: number;       // 0-25
  trend: number;          // 0-25
  engagement: number;     // 0-25
  recency: number;        // 0-25
  tier: Tier;
  reasons: string[];      // 最多 2 条
  daysSilent: number;     // 群最后一条消息距今天数
  myDaysSilent: number;   // 我最后一条消息距今天数（无则 -1）
}

const NOW = () => Math.floor(Date.now() / 1000);

const fmtNum = (n: number) => n.toLocaleString('zh-CN');
const fmtDays = (d: number) => {
  if (d < 0) return '从未';
  if (d < 1) return '今天';
  if (d < 60) return `${Math.floor(d)} 天`;
  if (d < 365) return `${Math.floor(d / 30)} 个月`;
  return `${(d / 365).toFixed(1)} 年`;
};

function score(g: GroupInfo): Scored {
  const r30 = g.recent_30d_messages ?? 0;
  const trend = g.recent_trend_pct;
  const myMsg = g.my_messages ?? 0;
  const myRank = g.my_rank ?? 0;
  const total = g.total_messages || 1;
  const lastTs = g.last_message_ts ?? 0;
  const myLastTs = g.my_last_message_ts ?? 0;
  const now = NOW();
  const daysSilent = lastTs > 0 ? (now - lastTs) / 86400 : 9999;
  const myDaysSilent = myLastTs > 0 ? (now - myLastTs) / 86400 : -1;

  // 1) Activity 0-25：log 压缩，500 条到顶
  let activity = 0;
  if (r30 > 0) {
    activity = Math.min(25, (25 * Math.log10(1 + r30)) / Math.log10(501));
  }

  // 2) Trend 0-25
  let trendScore: number;
  if (trend === undefined || trend === null) {
    trendScore = 18;
  } else if (trend === 999) {
    trendScore = 22;
  } else if (trend >= 30) {
    trendScore = 25;
  } else if (trend >= -30) {
    trendScore = 18;
  } else if (trend >= -70) {
    trendScore = 10;
  } else {
    trendScore = 3;
  }

  // 3) Engagement 0-25
  let engagement = 0;
  if (myMsg > 0) {
    let rankScore = 0;
    if (myRank >= 1 && myRank <= 3)        rankScore = 12;
    else if (myRank >= 4 && myRank <= 10)  rankScore = 8;
    else if (myRank >= 11 && myRank <= 30) rankScore = 5;
    else if (myRank > 30)                  rankScore = 2;
    const ratio = myMsg / total;
    const ratioScore = Math.min(13, 13 * Math.sqrt(Math.min(1, ratio * 20)));
    engagement = rankScore + ratioScore;
    // 我 60 天内还在发言，不扣；闭口潜水的群每多 30 天扣 1 分
    if (myDaysSilent > 60) engagement = Math.max(0, engagement - Math.min(8, Math.floor((myDaysSilent - 60) / 30)));
  }

  // 4) Recency 0-25
  let recency = 0;
  if (daysSilent < 7)        recency = 25;
  else if (daysSilent < 30)  recency = 20;
  else if (daysSilent < 90)  recency = 12;
  else if (daysSilent < 180) recency = 5;

  const total100 = Math.round(activity + trendScore + engagement + recency);

  // 档位判定
  let tier: Tier;
  if (daysSilent >= 180) {
    tier = 'leave';
  } else if (total100 >= 60 && r30 >= 30) {
    tier = 'keep';
  } else if (total100 < 30) {
    tier = 'leave';
  } else {
    // 噪音群补丁：群很活但我几乎不发言 → 静音建议
    if (r30 >= 100 && engagement <= 5) {
      tier = 'mute';
    } else {
      tier = total100 < 45 ? 'mute' : 'keep';
    }
  }

  // 理由（最多 2 条，按"信号最强"优先）
  const reasons: string[] = [];
  if (daysSilent >= 180) {
    reasons.push(`整个群已经 ${fmtDays(daysSilent)} 没消息`);
  } else if (myDaysSilent > 60 && daysSilent < 14 && r30 >= 50) {
    reasons.push(`群还在活跃（30 天 ${r30} 条），但你已经 ${fmtDays(myDaysSilent)} 没说话`);
  } else if (trend !== undefined && trend !== 999 && trend <= -50) {
    reasons.push(`近 3 月活跃度下滑 ${Math.abs(trend)}%`);
  } else if (r30 >= 100 && engagement <= 5) {
    reasons.push(`30 天 ${r30} 条 · 你只发了 ${myMsg} 条`);
  }
  if (reasons.length < 2) {
    if (myMsg === 0 && total >= 100) {
      reasons.push('你从未在这个群发过言');
    } else if (myRank > 0 && myMsg > 0) {
      const ratioPct = Math.round((myMsg / total) * 100);
      reasons.push(`你说了 ${fmtNum(myMsg)} 条 · 占比 ${ratioPct}% · 排第 ${myRank}`);
    } else if (r30 > 0) {
      reasons.push(`30 天 ${r30} 条`);
    }
  }

  return {
    group: g,
    score: total100,
    activity: Math.round(activity),
    trend: Math.round(trendScore),
    engagement: Math.round(engagement),
    recency,
    tier,
    reasons: reasons.slice(0, 2),
    daysSilent,
    myDaysSilent,
  };
}

type FilterTab = 'all' | 'keep' | 'mute' | 'leave';

const TIER_META: Record<Tier, { label: string; sub: string; color: string; bg: string; icon: React.ReactNode }> = {
  keep:  { label: '值得多看', sub: '高频且你还在参与', color: '#07c160', bg: 'bg-[#e7f8f0] text-[#07c160]', icon: <Sparkles size={11} /> },
  mute:  { label: '可以静音', sub: '吵但和你关系不大', color: '#ff9500', bg: 'bg-orange-50 text-[#ff9500]', icon: <BellOff size={11} /> },
  leave: { label: '可以放手', sub: '已经没什么动静了',   color: '#8a94a6', bg: 'bg-[#eef1f7] text-[#576b95]', icon: <LogOut size={11} /> },
};

export const GroupROI: React.FC = () => {
  const toast = useToast();
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<FilterTab>('all');
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    setErr('');
    groupsApi.getList()
      .then((d) => setGroups(d || []))
      .catch((e) => setErr((e as Error).message || '加载失败'))
      .finally(() => setLoading(false));
  }, []);

  const scored = useMemo<Scored[]>(() => {
    // 至少 50 条历史消息才纳入打分（太小的群打分没意义）
    return groups.filter(g => g.total_messages >= 50).map(score);
  }, [groups]);

  const stats = useMemo(() => {
    const out = { keep: 0, mute: 0, leave: 0 };
    scored.forEach(s => { out[s.tier] += 1; });
    return out;
  }, [scored]);

  const filtered = useMemo(() => {
    let arr = scored;
    if (tab !== 'all') arr = arr.filter(s => s.tier === tab);
    const q = search.trim().toLowerCase();
    if (q) arr = arr.filter(s => s.group.name.toLowerCase().includes(q));
    return [...arr].sort((a, b) => {
      if (tab === 'leave') return b.daysSilent - a.daysSilent; // 放手 tab 按沉寂时长降序
      return b.score - a.score;
    });
  }, [scored, tab, search]);

  // 分享卡用：Top 5 keep + Top 5 leave
  const topKeep = useMemo(() => scored.filter(s => s.tier === 'keep').sort((a, b) => b.score - a.score).slice(0, 5), [scored]);
  const topLeave = useMemo(() => scored.filter(s => s.tier === 'leave').sort((a, b) => b.daysSilent - a.daysSilent).slice(0, 5), [scored]);

  const today = new Date().toISOString().slice(0, 10);

  const exportPng = async () => {
    if (!cardRef.current || exporting) return;
    setExporting(true);
    let wrapper: HTMLElement | null = null;
    try {
      const node = cardRef.current.cloneNode(true) as HTMLElement;
      wrapper = document.createElement('div');
      wrapper.style.cssText = `
        width: 720px; background: #ffffff; padding: 0;
        font-family: system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
        position: fixed; left: -10000px; top: 0; z-index: -1;
      `;
      wrapper.appendChild(node);
      const footer = document.createElement('div');
      footer.style.cssText =
        'padding:14px 28px; background:#f7f8fa; color:#8a94a6; font-size:11px; text-align:center; border-top:1px solid #eef1f7;';
      footer.innerHTML = `WeLink · 群语料 ROI · welink.click · ${today}`;
      wrapper.appendChild(footer);
      document.body.appendChild(wrapper);
      await prepareForCapture(wrapper);
      const canvas = await html2canvas(wrapper, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      });
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `welink-group-roi-${Date.now()}.png`;
      a.click();
      setExported(true);
      setTimeout(() => setExported(false), 3000);
    } catch (e) {
      toast.error('导出失败：' + ((e as Error).message || '未知错误'));
    } finally {
      if (wrapper && wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
      setExporting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      {/* 顶部说明 + 操作 */}
      <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-4 mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Compass size={16} className="text-[#07c160]" />
            <div className="text-sm font-bold text-[#1d1d1f] dark:text-gray-100">群语料 ROI 诊断</div>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            按活跃度 / 趋势 / 你的参与度 / 时新性给每个群打分，建议哪些值得多看、哪些可以静音、哪些可以放手。纯本地统计，无 LLM。
          </div>
        </div>
        {scored.length > 0 && (
          <button
            onClick={exportPng}
            disabled={exporting}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 disabled:opacity-50"
          >
            {exporting ? <Loader2 size={12} className="animate-spin" /> :
              exported ? <Check size={12} className="text-[#07c160]" /> :
              <Share2 size={12} />}
            {exporting ? '生成图片…' : exported ? '已下载' : '导出 Top 10'}
          </button>
        )}
      </div>

      {err && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/30 p-3 mb-4 text-xs text-red-700 dark:text-red-300">{err}</div>
      )}

      {loading && (
        <div className="text-center py-16 text-gray-400 text-sm flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" />
          扫描你的所有群聊…
        </div>
      )}

      {!loading && scored.length === 0 && !err && (
        <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-8 text-center text-sm text-gray-500">
          没有可分析的群（≥ 50 条消息）。
        </div>
      )}

      {!loading && scored.length > 0 && (
        <>
          {/* 统计概览 + 筛选 tab */}
          <div className="grid grid-cols-4 gap-2 mb-4">
            <SummaryCard active={tab === 'all'}   onClick={() => setTab('all')}   label="全部"   value={scored.length} hint="≥50 条" color="#1d1d1f" />
            <SummaryCard active={tab === 'keep'}  onClick={() => setTab('keep')}  label="值得多看" value={stats.keep}    hint="持续投入" color="#07c160" />
            <SummaryCard active={tab === 'mute'}  onClick={() => setTab('mute')}  label="可以静音" value={stats.mute}    hint="降低提醒" color="#ff9500" />
            <SummaryCard active={tab === 'leave'} onClick={() => setTab('leave')} label="可以放手" value={stats.leave}   hint="可考虑退" color="#8a94a6" />
          </div>

          {/* 搜索 */}
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索群名…"
              className="w-full pl-9 pr-3 py-2 rounded-xl text-sm border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1c1c1e] text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#07c160]/30"
            />
          </div>

          {/* 列表 */}
          <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] overflow-hidden">
            {filtered.length === 0 && (
              <div className="text-center py-10 text-xs text-gray-400">没有命中的群</div>
            )}
            {filtered.map((s, i) => (
              <ROIRow key={s.group.username} entry={s} rank={i + 1} />
            ))}
          </div>

          {/* 隐藏的分享卡（仅导出时被克隆出去） */}
          <div className="absolute -left-[99999px] -top-[99999px] pointer-events-none" aria-hidden>
            <div ref={cardRef} className="bg-white" style={{ width: 720 }}>
              <ShareCard today={today} stats={stats} totalGroups={scored.length} topKeep={topKeep} topLeave={topLeave} />
            </div>
          </div>
        </>
      )}
    </div>
  );
};

const SummaryCard: React.FC<{
  label: string; value: number; hint: string; color: string;
  active: boolean; onClick: () => void;
}> = ({ label, value, hint, color, active, onClick }) => (
  <button
    onClick={onClick}
    className={`text-left rounded-2xl border p-3 transition-colors ${
      active
        ? 'border-[#07c160] bg-[#07c160]/5 dark:bg-[#07c160]/10'
        : 'border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] hover:border-gray-200 dark:hover:border-white/20'
    }`}
  >
    <div className="text-[11px] text-gray-500 dark:text-gray-400">{label}</div>
    <div className="text-2xl font-black mt-0.5" style={{ color }}>{value}</div>
    <div className="text-[10px] text-gray-400 mt-0.5">{hint}</div>
  </button>
);

const ROIRow: React.FC<{ entry: Scored; rank: number }> = ({ entry, rank }) => {
  const { group: g, score: s, tier, reasons, daysSilent } = entry;
  const meta = TIER_META[tier];
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 dark:border-white/5 last:border-b-0">
      <div className="text-xs text-gray-400 w-6 text-center">{rank}</div>
      {g.small_head_url ? (
        <img src={avatarSrc(g.small_head_url) || ''} className="w-9 h-9 rounded-xl object-cover bg-gray-100" alt="" />
      ) : (
        <div className="w-9 h-9 rounded-xl bg-gray-100 dark:bg-white/10" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="text-sm font-bold text-gray-800 dark:text-gray-100 truncate">{g.name}</div>
          <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${meta.bg}`}>
            {meta.icon}{meta.label}
          </span>
        </div>
        <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 truncate">
          {reasons.length > 0 ? reasons.join(' · ') : `${fmtNum(g.total_messages)} 条历史 · 沉寂 ${fmtDays(daysSilent)}`}
        </div>
        {/* 4 维迷你条 */}
        <div className="flex items-center gap-2 mt-1.5">
          <Bar label="活" v={entry.activity} />
          <Bar label="趋" v={entry.trend} />
          <Bar label="参" v={entry.engagement} />
          <Bar label="近" v={entry.recency} />
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-2xl font-black tabular-nums leading-none" style={{ color: meta.color }}>{s}</div>
        <div className="text-[10px] text-gray-400 mt-0.5">/ 100</div>
      </div>
    </div>
  );
};

const Bar: React.FC<{ label: string; v: number }> = ({ label, v }) => {
  const pct = Math.max(2, Math.min(100, (v / 25) * 100));
  return (
    <div className="flex items-center gap-1">
      <span className="text-[9px] text-gray-400 w-3">{label}</span>
      <div className="w-12 h-1 rounded-full bg-gray-100 dark:bg-white/10 overflow-hidden">
        <div className="h-full bg-gradient-to-r from-[#07c160] to-[#10aeff]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

// ----- 分享卡 ------------------------------------------------------------

const ShareCard: React.FC<{
  today: string;
  stats: { keep: number; mute: number; leave: number };
  totalGroups: number;
  topKeep: Scored[];
  topLeave: Scored[];
}> = ({ today, stats, totalGroups, topKeep, topLeave }) => (
  <div className="font-sans">
    {/* Hero */}
    <div className="px-7 py-7" style={{ background: 'linear-gradient(135deg,#07c160,#10aeff)' }}>
      <div className="text-[11px] uppercase tracking-[0.2em] text-white/85 font-bold mb-2">
        GROUP ROI · 群语料 ROI 诊断
      </div>
      <div className="text-2xl font-black text-white leading-snug mb-1">
        我加了 {totalGroups} 个群<br/>
        <span className="text-white/90 text-lg font-bold">真正值得多看的只有 {stats.keep} 个</span>
      </div>
      <div className="text-[11px] text-white/80">{today}</div>
    </div>

    {/* 三档统计 */}
    <div className="grid grid-cols-3" style={{ background: '#f7f8fa' }}>
      <ShareTier label="值得多看" value={stats.keep}  color="#07c160" sub="持续投入"  />
      <ShareTier label="可以静音" value={stats.mute}  color="#ff9500" sub="降低提醒"  />
      <ShareTier label="可以放手" value={stats.leave} color="#8a94a6" sub="可考虑退群" />
    </div>

    {/* Top keep */}
    {topKeep.length > 0 && (
      <ShareSection title="值得多看 Top 5" accent="#07c160">
        {topKeep.map((s, i) => (
          <ShareRow key={s.group.username} idx={i + 1} g={s.group} score={s.score} accent="#07c160" reason={s.reasons[0]} />
        ))}
      </ShareSection>
    )}

    {/* Top leave */}
    {topLeave.length > 0 && (
      <ShareSection title="可以放手 Top 5" accent="#8a94a6">
        {topLeave.map((s, i) => (
          <ShareRow key={s.group.username} idx={i + 1} g={s.group} score={s.score} accent="#8a94a6" reason={s.reasons[0]} muted />
        ))}
      </ShareSection>
    )}
  </div>
);

const ShareTier: React.FC<{ label: string; value: number; color: string; sub: string }> = ({ label, value, color, sub }) => (
  <div style={{ padding: '20px 16px', background: '#fff', borderRight: '1px solid #eef1f7' }}>
    <div style={{ fontSize: 11, color: '#8a94a6', fontWeight: 700, letterSpacing: 0.5 }}>{label}</div>
    <div style={{ fontSize: 28, fontWeight: 900, color, marginTop: 2, lineHeight: 1.1 }}>{value}<span style={{ fontSize: 11, color: '#8a94a6', fontWeight: 400, marginLeft: 4 }}>个</span></div>
    <div style={{ fontSize: 10, color: '#8a94a6', marginTop: 2 }}>{sub}</div>
  </div>
);

const ShareSection: React.FC<{ title: string; accent: string; children: React.ReactNode }> = ({ title, accent, children }) => (
  <div style={{ padding: '18px 28px', background: '#fff', borderTop: '1px solid #eef1f7' }}>
    <div style={{ fontSize: 11, fontWeight: 800, color: accent, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 12 }}>{title}</div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
  </div>
);

const ShareRow: React.FC<{
  idx: number; g: GroupInfo; score: number; accent: string; reason?: string; muted?: boolean;
}> = ({ idx, g, score, accent, reason, muted }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
    <div style={{ fontSize: 13, fontWeight: 800, color: accent, width: 18, textAlign: 'center' }}>{idx}</div>
    {g.small_head_url ? (
      <img src={avatarSrc(g.small_head_url) || ''} style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover', background: '#eef1f7' }} alt="" />
    ) : (
      <div style={{ width: 32, height: 32, borderRadius: 8, background: '#eef1f7' }} />
    )}
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: muted ? '#8a94a6' : '#1d1d1f', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.name}</div>
      <div style={{ fontSize: 11, color: '#8a94a6', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {reason || `${fmtNum(g.total_messages)} 条历史`}
      </div>
    </div>
    <div style={{ fontSize: 18, fontWeight: 900, color: accent, fontVariantNumeric: 'tabular-nums' }}>{score}</div>
  </div>
);

export default GroupROI;
