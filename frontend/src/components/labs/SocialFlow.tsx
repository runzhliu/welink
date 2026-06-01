/**
 * 社交圈年度流动榜 Lab —— 今年 12 个月 vs 去年 12 个月，看人事变迁。
 *
 * GET /api/labs/social-flow
 *   - newcomers: 新晋核心（去年几乎没聊、今年起量）
 *   - faded:     悄然淡出（去年常聊、今年骤降）
 *   - revived:   逆袭回归 / 升温（去年有底子、今年回暖）
 *   - all:       全员流动总览（今年量降序，带流动标签）
 *
 * 纯统计，零 LLM。基于滑动 12 月窗口（含当月），不是自然年。仅供回顾。
 */

import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Waves, Loader2, RefreshCw, Share2, Check, AlertCircle, Sparkles, Snowflake, Flame, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { captureCardToPng } from '../../utils/exportPng';
import { avatarSrc } from '../../utils/avatar';
import { useToast } from '../common/Toast';
import { WelinkBrand } from './_shared';

interface ContactRow {
  username: string;
  display_name: string;
  avatar_url: string;
  this_year: number;
  last_year: number;
  delta: number;
  change_pct: number;
  flow: string;
  my_ratio_this: number;
}

interface Resp {
  scanned_contacts: number;
  anchor_month: string;
  newcomers: ContactRow[];
  faded: ContactRow[];
  revived: ContactRow[];
  all: ContactRow[];
  generated_at: number;
}

type Tab = 'newcomers' | 'faded' | 'revived' | 'all';

const FLOW_META: Record<string, { label: string; cls: string }> = {
  newcomer: { label: '新晋核心', cls: 'bg-[#07c160]/15 text-[#07c160]' },
  revived:  { label: '逆袭回归', cls: 'bg-orange-500/15 text-orange-600 dark:text-orange-300' },
  warming:  { label: '稳步升温', cls: 'bg-[#10aeff]/15 text-[#10aeff]' },
  faded:    { label: '悄然淡出', cls: 'bg-sky-500/15 text-sky-600 dark:text-sky-300' },
  steady:   { label: '稳定常驻', cls: 'bg-gray-400/15 text-gray-500 dark:text-gray-400' },
};

// 把 change_pct 渲染成带箭头的涨跌（999 当作 NEW）
function ChangeBadge({ pct, lastYear }: { pct: number; lastYear: number }) {
  if (lastYear === 0) {
    return <span className="inline-flex items-center gap-0.5 text-[#07c160] font-bold"><Sparkles size={11} />全新</span>;
  }
  if (pct > 0) {
    return <span className="inline-flex items-center gap-0.5 text-[#07c160] font-bold"><ArrowUpRight size={11} />+{pct}%</span>;
  }
  if (pct < 0) {
    return <span className="inline-flex items-center gap-0.5 text-sky-500 font-bold"><ArrowDownRight size={11} />{pct}%</span>;
  }
  return <span className="inline-flex items-center gap-0.5 text-gray-400 font-bold"><Minus size={11} />持平</span>;
}

export const SocialFlow: React.FC = () => {
  const toast = useToast();
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<Tab>('newcomers');
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const fetchData = async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setErr('');
    try {
      const r = await axios.get<Resp>('/api/labs/social-flow', { params: refresh ? { refresh: 1 } : {} });
      setData(r.data);
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } }; message?: string })
        ?.response?.data?.error || (e as Error).message || '加载失败';
      setErr(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchData(false); }, []);

  const today = new Date().toLocaleDateString('zh-CN');

  const exportPng = async () => {
    if (!data || !cardRef.current || exporting) return;
    setExporting(true);
    const r = await captureCardToPng(cardRef.current, {
      filename: `social-flow-${today.replace(/\//g, '-')}.png`,
      backgroundColor: '#ffffff',
      appendHTML: '',
    });
    setExporting(false);
    if (r.ok) {
      setExported(true);
      setTimeout(() => setExported(false), 2000);
    } else {
      toast.error('截图失败：' + (r.error || '未知错误'));
    }
  };

  const tabs: { key: Tab; label: string; hint: string; icon: React.ReactNode }[] = [
    { key: 'newcomers', label: '新晋核心', hint: '今年才走进你生活、突然聊很多的人', icon: <Sparkles size={12} /> },
    { key: 'faded',     label: '悄然淡出', hint: '去年还常聊、今年骤降的老朋友',     icon: <Snowflake size={12} /> },
    { key: 'revived',   label: '逆袭回归', hint: '冷过一阵、今年又热起来的关系',     icon: <Flame size={12} /> },
    { key: 'all',       label: '全员总览', hint: '今年聊得最多的人 · 含流动标签',     icon: <Waves size={12} /> },
  ];

  const rows = data
    ? (tab === 'newcomers' ? data.newcomers : tab === 'faded' ? data.faded : tab === 'revived' ? data.revived : data.all)
    : [];

  const empty = data && data.scanned_contacts === 0;

  // 锚点月 "2026-05" → "2025.06 – 2026.05" 的窗口标注
  const windowLabel = (() => {
    if (!data?.anchor_month) return '';
    const [y, m] = data.anchor_month.split('-').map(Number);
    if (!y || !m) return '';
    // 今年窗口 = 含当月往前数 12 个月
    const startY = m === 12 ? y : y - 1;
    const startM = m === 12 ? 1 : m + 1;
    return `${String(startY).padStart(4, '0')}.${String(startM).padStart(2, '0')} – ${String(y).padStart(4, '0')}.${String(m).padStart(2, '0')}`;
  })();

  const activeTab = tabs.find(t => t.key === tab)!;

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-3 gap-2">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          把每个私聊「今年 12 个月」和「去年同期」对比，看谁新晋、谁淡出、谁回归。纯统计，零 LLM、秒出。
        </p>
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={() => fetchData(true)}
            disabled={refreshing || loading}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/15 disabled:opacity-50 transition-colors"
          >
            {refreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            刷新
          </button>
          {data && !empty && (
            <button
              onClick={exportPng}
              disabled={exporting}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-gradient-to-r from-[#07c160] to-[#10aeff] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {exporting ? <Loader2 size={12} className="animate-spin" /> : exported ? <Check size={12} /> : <Share2 size={12} />}
              {exported ? '已下载' : '截图'}
            </button>
          )}
        </div>
      </div>

      {/* 免责声明 */}
      <div className="rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-3 mb-4 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
        <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
        <span>消息量起落受换工作、搬家、平台迁移等很多事影响。<strong>仅供回顾</strong>，"淡出"不等于"绝交" 🙂</span>
      </div>

      {err && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/30 p-3 mb-4 text-xs text-red-700 dark:text-red-300">{err}</div>
      )}

      {loading && (
        <div className="text-center py-16 text-gray-400 text-sm flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" />
          对比这一年和上一年的社交流向…
        </div>
      )}

      {empty && !loading && (
        <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-8 text-center text-sm text-gray-500">
          数据跨度不够 —— 需要至少有跨年的聊天记录才能对比流动
        </div>
      )}

      {data && !empty && (
        <>
          {/* Tab 切换 */}
          <div className="flex gap-1.5 mb-3">
            {tabs.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex-1 inline-flex items-center justify-center gap-1 px-2 py-2 rounded-xl text-xs font-bold transition-colors ${
                  tab === t.key
                    ? 'bg-gradient-to-r from-[#07c160] to-[#10aeff] text-white'
                    : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          <div ref={cardRef} className="rounded-2xl bg-white dark:bg-[#1c1c1e] overflow-hidden border border-gray-100 dark:border-white/10">
            {/* Hero */}
            <div className="px-7 py-6 bg-[#07c160]/8 dark:bg-[#07c160]/10 border-b border-[#07c160]/15">
              <div className="text-xs uppercase tracking-widest text-[#07c160] font-bold mb-1 flex items-center gap-1.5">
                <Waves size={12} />
                Social Flow · 社交圈年度流动
              </div>
              <div className="text-2xl font-black text-[#1d1d1f] dark:text-gray-100 mb-1 break-words flex items-center gap-2">
                {activeTab.icon}{activeTab.label}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{activeTab.hint}</div>
              {windowLabel && (
                <div className="text-[10px] text-gray-400 mt-1.5 font-mono">今年窗口：{windowLabel}（对比去年同期 12 个月）</div>
              )}
            </div>

            {/* 榜单 */}
            <div className="px-5 py-4">
              {rows.length === 0 ? (
                <div className="text-center text-gray-400 text-sm py-6">这个维度暂无符合条件的人</div>
              ) : (
                <div className="space-y-1.5">
                  {rows.slice(0, 15).map((c, idx) => {
                    const fm = FLOW_META[c.flow] || FLOW_META.steady;
                    return (
                      <div key={c.username} className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-white/5">
                        <span className="text-xs font-mono text-gray-400 w-6 text-right">#{idx + 1}</span>
                        {c.avatar_url ? (
                          <img src={avatarSrc(c.avatar_url) || ''} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#07c160] to-[#10aeff] flex items-center justify-center text-xs text-white font-bold flex-shrink-0">
                            {c.display_name.charAt(0)}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-semibold text-[#1d1d1f] dark:text-gray-200 truncate">{c.display_name}</span>
                            {tab === 'all' && (
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-black flex-shrink-0 ${fm.cls}`}>{fm.label}</span>
                            )}
                          </div>
                          {/* 今年 vs 去年消息量 */}
                          <div className="flex items-center gap-2 text-[11px] text-gray-400 mt-0.5">
                            <span>今年 <span className="font-mono text-gray-600 dark:text-gray-300">{c.this_year}</span></span>
                            <span className="text-gray-300">·</span>
                            <span>去年 <span className="font-mono text-gray-600 dark:text-gray-300">{c.last_year}</span></span>
                          </div>
                        </div>
                        {/* 主指标：涨跌 */}
                        <div className="text-right flex-shrink-0">
                          <div className="text-sm"><ChangeBadge pct={c.change_pct} lastYear={c.last_year} /></div>
                          <div className="text-[10px] text-gray-300">
                            {c.delta > 0 ? `+${c.delta}` : c.delta} 条
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <WelinkBrand
              label="社交圈年度流动榜"
              leftText={<>已分析 {data.scanned_contacts} 位联系人 · {activeTab.label}</>}
            />
          </div>
        </>
      )}
    </div>
  );
};
