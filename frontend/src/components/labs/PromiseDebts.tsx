/**
 * 人情债 / 承诺与邀约挖掘
 *
 * 选一个联系人 → POST /api/contacts/promise-debts → AI 抽出未兑现的承诺/邀约
 * → 渲染卡片（方向 / 类别 / 目标日期 / 原文引用 / 当时日期）→ 导出分享图
 */

import React, { useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  HeartHandshake, Loader2, Search, Wand2, Share2, Check, ArrowRight, ArrowLeft, Users,
} from 'lucide-react';
import type { ContactStats } from '../../types';
import { avatarSrc } from '../../utils/avatar';
import { captureCardToPng } from '../../utils/exportPng';
import { useToast } from '../common/Toast';
import { welinkBrandHTML } from './_shared';

interface Props {
  contacts: ContactStats[];
}

type Direction = 'i_owe' | 'they_owe' | 'mutual';
type Confidence = 'high' | 'medium' | 'low';

interface Debt {
  text: string;
  direction: Direction;
  category: string;
  target_date: string;
  target_date_text: string;
  source_quote: string;
  source_speaker: string;
  source_date: string;
  confidence: Confidence;
}

interface PromiseResp {
  display_name: string;
  avatar?: string;
  total_messages: number;
  scanned_messages: number;
  candidate_count: number;
  debts: Debt[];
  generated_at: number;
}

const displayOf = (c: ContactStats) => c.remark || c.nickname || c.username;
const fmtNum = (n: number) => n.toLocaleString('zh-CN');

const DIR_META: Record<Direction, { label: string; bg: string; text: string; icon: React.ReactNode }> = {
  they_owe: { label: 'TA 欠我',  bg: '#e7f8f0', text: '#07c160', icon: <ArrowLeft  size={11} /> },
  mutual:   { label: '双方约定', bg: '#eef4fc', text: '#576b95', icon: <Users      size={11} /> },
  i_owe:    { label: '我欠 TA',  bg: '#fff5e6', text: '#ff9500', icon: <ArrowRight size={11} /> },
};

const CONF_LABEL: Record<Confidence, string> = {
  high: '强信号', medium: '可能', low: '弱信号',
};

type Tab = 'all' | 'they_owe' | 'mutual' | 'i_owe';

export const PromiseDebts: React.FC<Props> = ({ contacts }) => {
  const toast = useToast();
  const [picked, setPicked] = useState<ContactStats | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [data, setData] = useState<PromiseResp | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const base = contacts.filter(
      c => !c.username.endsWith('@chatroom') && (c.total_messages || 0) >= 30,
    );
    base.sort((a, b) => (b.total_messages || 0) - (a.total_messages || 0));
    const q = search.trim().toLowerCase();
    if (!q) return base.slice(0, 80);
    return base.filter(c =>
      (c.remark || '').toLowerCase().includes(q) ||
      (c.nickname || '').toLowerCase().includes(q) ||
      c.username.toLowerCase().includes(q),
    ).slice(0, 80);
  }, [contacts, search]);

  const generate = async () => {
    if (!picked || loading) return;
    setLoading(true);
    setErr('');
    setData(null);
    setTab('all');
    try {
      const r = await axios.post<PromiseResp>('/api/contacts/promise-debts', {
        username: picked.username,
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

  const stats = useMemo(() => {
    if (!data) return { they: 0, mutual: 0, i: 0 };
    return data.debts.reduce(
      (acc, d) => {
        if (d.direction === 'they_owe') acc.they += 1;
        else if (d.direction === 'mutual') acc.mutual += 1;
        else acc.i += 1;
        return acc;
      },
      { they: 0, mutual: 0, i: 0 },
    );
  }, [data]);

  const visible = useMemo(() => {
    if (!data) return [];
    if (tab === 'all') return data.debts;
    return data.debts.filter(d => d.direction === tab);
  }, [data, tab]);

  const today = new Date().toLocaleDateString('zh-CN');

  const exportPng = async () => {
    if (!data || !cardRef.current || exporting) return;
    setExporting(true);
    const r = await captureCardToPng(cardRef.current, {
      filename: `promise-debts-${today.replace(/\//g, '-')}.png`,
      backgroundColor: '#ffffff',
      appendHTML: welinkBrandHTML({
        label: '人情债',
        date: today,
        variant: 'light',
      }),
    });
    setExporting(false);
    if (r.ok) {
      setExported(true);
      setTimeout(() => setExported(false), 2000);
    } else {
        toast.error('截图失败：' + (r.error || '未知错误'));
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      {/* 选联系人 */}
      <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <HeartHandshake size={16} className="text-[#07c160]" />
          <div className="text-sm font-bold text-[#1d1d1f] dark:text-gray-100">
            挑一位联系人，看看你们之间还有哪些「答应了但没做」的事
          </div>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          AI 会扫整段聊天记录，把"下次约饭/改天找时间/我寄给你/等我回国请你..."这类承诺、邀约、约定挖出来。
          看看 TA 欠你的，和你欠 TA 的。生成约需 10-25 秒。
        </div>
        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜联系人（备注/昵称）"
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-gray-50 dark:bg-white/5 text-sm text-[#1d1d1f] dark:text-gray-100 border border-transparent focus:border-[#07c160] outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-1.5 max-h-44 overflow-y-auto">
          {filtered.map(c => {
            const sel = picked?.username === c.username;
            return (
              <button
                key={c.username}
                onClick={() => setPicked(c)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs transition-colors ${
                  sel
                    ? 'bg-[#07c160] text-white font-bold'
                    : 'bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10'
                }`}
              >
                {(c.big_head_url || c.small_head_url) && (
                  <img
                    src={avatarSrc(c.big_head_url || c.small_head_url) || ''}
                    alt=""
                    className="w-4 h-4 rounded-full object-cover"
                  />
                )}
                <span>{displayOf(c)}</span>
                <span className={`text-[10px] ${sel ? 'opacity-80' : 'text-gray-400'}`}>
                  {c.total_messages}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between mt-3">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {picked
              ? <>已选：<strong className="text-[#1d1d1f] dark:text-gray-100">{displayOf(picked)}</strong></>
              : '请先选一位联系人'}
          </div>
          <button
            onClick={generate}
            disabled={!picked || loading}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-[#07c160] hover:bg-[#06a850] disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
            {loading ? '挖掘中…' : '挖掘人情债'}
          </button>
        </div>
      </div>

      {err && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/30 p-3 mb-4 text-xs text-red-700 dark:text-red-300">
          {err}
        </div>
      )}

      {data && data.debts.length === 0 && (
        <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-8 text-center text-sm text-gray-500">
          {data.candidate_count > 0
            ? '找到了一些嫌疑句但 AI 觉得都是寒暄 / 客套，没有可上榜的承诺 ✨'
            : '没有发现承诺 / 邀约关键词。和这位联系人之间或许干干净净 ✨'}
          <div className="text-xs text-gray-400 mt-2">
            扫了 {fmtNum(data.scanned_messages)} 条文本消息 · {data.candidate_count} 个嫌疑窗口
          </div>
        </div>
      )}

      {data && data.debts.length > 0 && (
        <>
          {/* 概览 + tab + 导出 */}
          <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-4 mb-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="text-xs text-gray-500 dark:text-gray-400">
                扫了 <strong className="text-[#1d1d1f] dark:text-gray-100">{fmtNum(data.scanned_messages)}</strong> 条文本 ·
                {data.candidate_count} 个嫌疑窗口 · AI 挖出
                <strong className="text-[#1d1d1f] dark:text-gray-100"> {data.debts.length} </strong>
                条人情债
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
            <div className="grid grid-cols-4 gap-2">
              <SummaryCard label="全部"  value={data.debts.length} hint="共"  active={tab === 'all'}      onClick={() => setTab('all')}      color="#1d1d1f" />
              <SummaryCard label="TA 欠我"  value={stats.they}      hint="对方欠"  active={tab === 'they_owe'} onClick={() => setTab('they_owe')} color="#07c160" />
              <SummaryCard label="双方约定" value={stats.mutual}    hint="互相约"  active={tab === 'mutual'}   onClick={() => setTab('mutual')}   color="#576b95" />
              <SummaryCard label="我欠 TA" value={stats.i}          hint="我欠"    active={tab === 'i_owe'}    onClick={() => setTab('i_owe')}    color="#ff9500" />
            </div>
          </div>

          {/* 列表 */}
          <div className="space-y-3">
            {visible.length === 0 ? (
              <div className="text-center py-10 text-xs text-gray-400">这一档暂时没有</div>
            ) : visible.map((d, i) => (
              <DebtCard key={i} d={d} contactName={data.display_name} avatar={data.avatar} />
            ))}
          </div>

          {/* 隐藏导出卡 */}
          <div className="absolute -left-[99999px] -top-[99999px] pointer-events-none" aria-hidden>
            <div ref={cardRef} className="bg-white" style={{ width: 720 }}>
              <ShareCard data={data} stats={stats} today={today} />
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
    className={`text-left rounded-xl border p-2.5 transition-colors ${
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

const DebtCard: React.FC<{ d: Debt; contactName: string; avatar?: string }> = ({ d, contactName, avatar }) => {
  const meta = DIR_META[d.direction];
  const speakerLabel = d.source_speaker === '我' ? '我' : (contactName || d.source_speaker);
  return (
    <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-4">
      {/* 头部：方向 + 类别 + 置信度 */}
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
          style={{ background: meta.bg, color: meta.text }}
        >
          {meta.icon}{meta.label}
        </span>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300">
          {d.category || '其他'}
        </span>
        {d.target_date_text && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#fff8db] text-[#a8770b]">
            ⏰ {d.target_date_text}
          </span>
        )}
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
            d.confidence === 'high'   ? 'bg-[#07c160]/10 text-[#07c160]' :
            d.confidence === 'medium' ? 'bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400' :
                                        'bg-gray-100 dark:bg-white/10 text-gray-400'
          }`}
        >
          {CONF_LABEL[d.confidence]}
        </span>
      </div>

      {/* 主述说 */}
      <div className="text-sm font-bold text-[#1d1d1f] dark:text-gray-100 leading-relaxed mb-2">
        {d.text}
      </div>

      {/* 原文引用 */}
      {d.source_quote && (
        <div className="flex items-start gap-2 pl-3 border-l-2 border-[#07c160]/40">
          {d.source_speaker === '我' ? (
            <div className="shrink-0 w-5 h-5 rounded-full bg-[#07c160]/15 text-[#07c160] flex items-center justify-center text-[10px] font-bold">我</div>
          ) : (
            avatar ? (
              <img src={avatarSrc(avatar) || ''} className="shrink-0 w-5 h-5 rounded-full object-cover" alt="" />
            ) : (
              <div className="shrink-0 w-5 h-5 rounded-full bg-gray-200 dark:bg-white/10" />
            )
          )}
          <div className="flex-1 min-w-0">
            <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-0.5">
              {speakerLabel} · {d.source_date}
            </div>
            <div className="text-sm text-[#1d1d1f] dark:text-gray-200 leading-relaxed whitespace-pre-wrap break-words">
              「{d.source_quote}」
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------- 分享卡 ----------------------------------------------------------

const ShareCard: React.FC<{
  data: PromiseResp;
  stats: { they: number; mutual: number; i: number };
  today: string;
}> = ({ data, stats, today }) => {
  const top = data.debts.slice(0, 8);
  return (
    <div className="font-sans">
      {/* Hero */}
      <div className="px-7 py-7" style={{ background: 'linear-gradient(135deg,#07c160,#10aeff)' }}>
        <div className="text-[11px] uppercase tracking-[0.2em] text-white/85 font-bold mb-2">
          PROMISE DEBTS · 人情债
        </div>
        <div className="text-2xl font-black text-white leading-snug mb-1">
          我和「{data.display_name}」
        </div>
        <div className="text-[12px] text-white/85 mb-3">
          AI 挖出 {data.debts.length} 条还没兑现的承诺 / 邀约
        </div>
        <div className="flex items-center gap-3 text-[11px] text-white/85">
          <span><strong className="text-white text-base">{stats.they}</strong> 条 TA 欠我</span>
          <span><strong className="text-white text-base">{stats.mutual}</strong> 条双方约定</span>
          <span><strong className="text-white text-base">{stats.i}</strong> 条我欠 TA</span>
        </div>
      </div>

      {/* 列表 */}
      <div style={{ background: '#fff', padding: '8px 28px 22px' }}>
        {top.map((d, i) => {
          const meta = DIR_META[d.direction];
          return (
            <div key={i} style={{ padding: '14px 0', borderBottom: '1px solid #eef1f7' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                  background: meta.bg, color: meta.text,
                }}>{meta.label}</span>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                  background: '#f3f4f7', color: '#576b95',
                }}>{d.category || '其他'}</span>
                {d.target_date_text && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                    background: '#fff8db', color: '#a8770b',
                  }}>⏰ {d.target_date_text}</span>
                )}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#1d1d1f', lineHeight: 1.55, marginBottom: 4 }}>
                {d.text}
              </div>
              {d.source_quote && (
                <div style={{
                  paddingLeft: 10, borderLeft: '2px solid rgba(7,193,96,0.4)',
                  fontSize: 12, color: '#576b95', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  <div style={{ fontSize: 10, color: '#8a94a6', marginBottom: 1 }}>
                    {d.source_speaker === '我' ? '我' : data.display_name} · {d.source_date}
                  </div>
                  「{d.source_quote}」
                </div>
              )}
            </div>
          );
        })}
        {data.debts.length > 8 && (
          <div style={{ fontSize: 11, color: '#8a94a6', textAlign: 'center', marginTop: 8 }}>
            还有 {data.debts.length - 8} 条没列出
          </div>
        )}
      </div>
    </div>
  );
};

export default PromiseDebts;
