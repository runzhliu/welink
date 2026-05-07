/**
 * 群金句榜 / Golden Quotes
 *
 * 选群（≥ 100 条消息）→ GET /api/groups/golden-quotes?room=...&limit=10
 * 扫描 type=49 + <refermsg>，按被引用次数排出 Top N。
 * 零 LLM，纯 SQL+regex 聚合。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  Quote, Loader2, Search, Wand2, Share2, Check, MessageCircle, Trophy,
} from 'lucide-react';
import html2canvas from 'html2canvas';
import { groupsApi } from '../../services/api';
import type { GroupInfo } from '../../types';
import { avatarSrc } from '../../utils/avatar';
import { prepareForCapture } from '../../utils/exportPng';
import { useToast } from '../common/Toast';

interface GQReplier {
  speaker: string;
  avatar?: string;
  count: number;
}

interface GoldenQuote {
  svrid: string;
  speaker: string;
  speaker_wxid: string;
  avatar?: string;
  content: string;
  quote_count: number;
  ts?: number;
  date?: string;
  time?: string;
  repliers?: GQReplier[];
}

interface GQResp {
  group_name: string;
  room_id: string;
  total_scanned: number;
  total_quotes: number;
  unique_quoted: number;
  quotes: GoldenQuote[];
  generated_at: number;
  truncated: boolean;
}

const fmtNum = (n: number) => n.toLocaleString('zh-CN');

const RANK_BADGE: Array<{ bg: string; text: string; label: string }> = [
  { bg: '#ffb300', text: '#fff', label: '🏆' },
  { bg: '#bdc3cf', text: '#fff', label: '🥈' },
  { bg: '#cd7f32', text: '#fff', label: '🥉' },
];

export const GoldenQuotes: React.FC = () => {
  const toast = useToast();
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [picked, setPicked] = useState<GroupInfo | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [data, setData] = useState<GQResp | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // 拉群列表
  useEffect(() => {
    let cancelled = false;
    setGroupsLoading(true);
    groupsApi.getList()
      .then(d => { if (!cancelled) setGroups(d || []); })
      .catch(() => { /* 静默 */ })
      .finally(() => { if (!cancelled) setGroupsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const base = groups.filter(g => (g.total_messages || 0) >= 100);
    base.sort((a, b) => (b.total_messages || 0) - (a.total_messages || 0));
    const q = search.trim().toLowerCase();
    if (!q) return base.slice(0, 80);
    return base.filter(g => (g.name || '').toLowerCase().includes(q)).slice(0, 80);
  }, [groups, search]);

  const generate = async () => {
    if (!picked || loading) return;
    setLoading(true);
    setErr('');
    setData(null);
    try {
      const r = await axios.get<GQResp>('/api/groups/golden-quotes', {
        params: { room: picked.username, limit: 10 },
      });
      setData(r.data);
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } }; message?: string })
        ?.response?.data?.error || (e as Error).message || '生成失败';
      setErr(msg);
    } finally {
      setLoading(false);
    }
  };

  const today = new Date().toLocaleDateString('zh-CN');

  const exportPng = async () => {
    if (!data || !cardRef.current || exporting) return;
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
      footer.innerHTML = `WeLink · 群金句榜 · welink.click · ${today}`;
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
      a.download = `welink-golden-quotes-${Date.now()}.png`;
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
    <div className="max-w-3xl mx-auto">
      {/* 选群 */}
      <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <MessageCircle size={16} className="text-[#07c160]" />
          <div className="text-sm font-bold text-[#1d1d1f] dark:text-gray-100">
            挑一个群，看哪些消息变成了梗 / 名场面
          </div>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          原理：扫描群内所有「引用消息」，按原文被引用次数排出 Top 10。一条消息被群友翻出来回复 / 玩梗 越多次 → 越是金句。
          零 LLM、即时返回。
        </div>
        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜群名"
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-gray-50 dark:bg-white/5 text-sm text-[#1d1d1f] dark:text-gray-100 border border-transparent focus:border-[#07c160] outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-1.5 max-h-44 overflow-y-auto">
          {groupsLoading && groups.length === 0 && (
            <div className="text-xs text-gray-400 py-4 px-2">加载群列表…</div>
          )}
          {!groupsLoading && filtered.length === 0 && (
            <div className="text-xs text-gray-400 py-4 px-2">没有满足条件的群（消息需 ≥ 100 条）</div>
          )}
          {filtered.map(g => {
            const sel = picked?.username === g.username;
            return (
              <button
                key={g.username}
                onClick={() => setPicked(g)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs transition-colors ${
                  sel
                    ? 'bg-[#07c160] text-white font-bold'
                    : 'bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10'
                }`}
              >
                {g.small_head_url && (
                  <img src={avatarSrc(g.small_head_url) || ''} alt="" className="w-4 h-4 rounded-full object-cover" />
                )}
                <span className="max-w-[14em] truncate">{g.name || g.username}</span>
                <span className={`text-[10px] ${sel ? 'opacity-80' : 'text-gray-400'}`}>
                  {fmtNum(g.total_messages || 0)}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between mt-3">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {picked
              ? <>已选：<strong className="text-[#1d1d1f] dark:text-gray-100">{picked.name || picked.username}</strong></>
              : '请先选一个群'}
          </div>
          <button
            onClick={generate}
            disabled={!picked || loading}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-[#07c160] hover:bg-[#06a850] disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
            {loading ? '扫描中…' : '生成金句榜'}
          </button>
        </div>
      </div>

      {err && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/30 p-3 mb-4 text-xs text-red-700 dark:text-red-300">
          {err}
        </div>
      )}

      {data && data.quotes.length === 0 && (
        <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-8 text-center text-sm text-gray-500">
          这个群还没有产生「金句」——可能群友很少用「引用回复」功能。<br/>
          <span className="text-xs text-gray-400">至少需要同一条消息被引用 ≥ 2 次才会上榜。</span>
        </div>
      )}

      {data && data.quotes.length > 0 && (
        <>
          {/* 概览 + 导出 */}
          <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-4 mb-4 flex items-center justify-between gap-3">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              扫描 <strong className="text-[#1d1d1f] dark:text-gray-100">{fmtNum(data.total_scanned)}</strong> 条消息 ·
              命中引用 <strong className="text-[#1d1d1f] dark:text-gray-100">{fmtNum(data.total_quotes)}</strong> 次 ·
              候选金句 <strong className="text-[#1d1d1f] dark:text-gray-100">{fmtNum(data.unique_quoted)}</strong> 条
              {data.truncated && <span className="ml-1 text-amber-500">（已截断到最近窗口）</span>}
            </div>
            <button
              onClick={exportPng}
              disabled={exporting}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 disabled:opacity-50"
            >
              {exporting ? <Loader2 size={12} className="animate-spin" /> :
                exported ? <Check size={12} className="text-[#07c160]" /> :
                <Share2 size={12} />}
              {exporting ? '生成图片…' : exported ? '已下载' : '导出分享图'}
            </button>
          </div>

          {/* 屏幕版列表 */}
          <div className="space-y-3">
            {data.quotes.map((q, i) => (
              <QuoteRow key={`${q.svrid || ''}-${i}`} q={q} rank={i + 1} />
            ))}
          </div>

          {/* 隐藏的导出卡 */}
          <div className="absolute -left-[99999px] -top-[99999px] pointer-events-none" aria-hidden>
            <div ref={cardRef} className="bg-white" style={{ width: 720 }}>
              <ShareCard data={data} today={today} />
            </div>
          </div>
        </>
      )}
    </div>
  );
};

const QuoteRow: React.FC<{ q: GoldenQuote; rank: number }> = ({ q, rank }) => {
  const badge = rank <= 3 ? RANK_BADGE[rank - 1] : null;
  return (
    <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-4">
      <div className="flex items-start gap-3">
        {/* 排名徽章 */}
        <div className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm tabular-nums"
          style={badge
            ? { background: badge.bg, color: badge.text }
            : { background: '#f3f4f7', color: '#576b95' }}>
          {badge ? badge.label : rank}
        </div>

        <div className="flex-1 min-w-0">
          {/* 发言者 + 时间 */}
          <div className="flex items-center gap-2 mb-1.5">
            {q.avatar ? (
              <img src={avatarSrc(q.avatar) || ''} className="w-5 h-5 rounded-full object-cover" alt="" />
            ) : (
              <div className="w-5 h-5 rounded-full bg-gray-200 dark:bg-white/10" />
            )}
            <div className="text-xs font-bold text-gray-800 dark:text-gray-100 truncate">{q.speaker}</div>
            {q.date && (
              <div className="text-[10px] text-gray-400 shrink-0">{q.date} {q.time}</div>
            )}
          </div>

          {/* 金句正文 */}
          <div className="relative pl-3.5 border-l-2 border-[#07c160]">
            <Quote size={11} className="absolute -left-[6px] -top-1 bg-white dark:bg-[#1c1c1e] text-[#07c160]" />
            <div className="text-sm text-[#1d1d1f] dark:text-gray-100 leading-relaxed whitespace-pre-wrap break-words">
              {q.content}
            </div>
          </div>

          {/* 引用次数 + 引用者 */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2.5">
            <div className="inline-flex items-center gap-1 text-xs font-bold text-[#07c160]">
              <Trophy size={11} />被引用 {q.quote_count} 次
            </div>
            {q.repliers && q.repliers.length > 0 && (
              <div className="flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400 min-w-0">
                <span className="text-gray-400">最常翻牌的人：</span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {q.repliers.map((r, i) => (
                    <span key={i} className="inline-flex items-center gap-1">
                      {r.avatar ? (
                        <img src={avatarSrc(r.avatar) || ''} className="w-3.5 h-3.5 rounded-full object-cover" alt="" />
                      ) : null}
                      <span className="truncate max-w-[7em]">{r.speaker}</span>
                      <span className="text-gray-400">×{r.count}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------- 分享卡 ----------------------------------------------------------

const ShareCard: React.FC<{ data: GQResp; today: string }> = ({ data, today }) => (
  <div className="font-sans">
    {/* Hero */}
    <div className="px-7 py-7" style={{ background: 'linear-gradient(135deg,#07c160,#10aeff)' }}>
      <div className="text-[11px] uppercase tracking-[0.2em] text-white/85 font-bold mb-2">
        GOLDEN QUOTES · 群金句榜
      </div>
      <div className="text-2xl font-black text-white leading-snug mb-1">
        {data.group_name}
      </div>
      <div className="text-[12px] text-white/85 mb-3">
        被翻牌最多的 {data.quotes.length} 条名场面
      </div>
      <div className="flex flex-wrap gap-3 text-[11px] text-white/85">
        <span><strong className="text-white">{fmtNum(data.total_scanned)}</strong> 条扫描</span>
        <span><strong className="text-white">{fmtNum(data.total_quotes)}</strong> 次引用</span>
        <span><strong className="text-white">{fmtNum(data.unique_quoted)}</strong> 候选</span>
      </div>
    </div>

    {/* 名场面列表 */}
    <div style={{ background: '#fff', padding: '8px 28px 22px' }}>
      {data.quotes.slice(0, 10).map((q, i) => (
        <ShareRow key={`${q.svrid || ''}-${i}`} q={q} rank={i + 1} />
      ))}
    </div>
  </div>
);

const ShareRow: React.FC<{ q: GoldenQuote; rank: number }> = ({ q, rank }) => {
  const badge = rank <= 3 ? RANK_BADGE[rank - 1] : null;
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: '14px 0', borderBottom: '1px solid #eef1f7',
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 10, fontSize: 14, fontWeight: 900,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: badge ? badge.bg : '#f3f4f7',
        color: badge ? badge.text : '#576b95',
        flexShrink: 0,
      }}>
        {badge ? badge.label : rank}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          {q.avatar ? (
            <img src={avatarSrc(q.avatar) || ''} style={{ width: 16, height: 16, borderRadius: 8, objectFit: 'cover' }} alt="" />
          ) : (
            <div style={{ width: 16, height: 16, borderRadius: 8, background: '#eef1f7' }} />
          )}
          <span style={{ fontSize: 11, fontWeight: 700, color: '#1d1d1f' }}>{q.speaker}</span>
          {q.date && <span style={{ fontSize: 10, color: '#8a94a6' }}>{q.date}</span>}
        </div>
        <div style={{
          paddingLeft: 10, borderLeft: '2px solid #07c160',
          fontSize: 13, color: '#1d1d1f', lineHeight: 1.55,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {q.content}
        </div>
        <div style={{ marginTop: 6, fontSize: 11, fontWeight: 700, color: '#07c160' }}>
          🏆 被引用 {q.quote_count} 次
          {q.repliers && q.repliers.length > 0 && (
            <span style={{ color: '#8a94a6', fontWeight: 400, marginLeft: 8 }}>
              · 翻牌人：{q.repliers.map(r => `${r.speaker}×${r.count}`).join(' / ')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default GoldenQuotes;
