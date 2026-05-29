/**
 * 主动指数榜 Lab —— 看每段对话是谁先开口的。
 *
 * GET /api/labs/initiative
 *   - you_initiate:  你主动找的人（my_ratio 降序）
 *   - they_initiate: 主动找你的人（my_ratio 升序）
 *   - most_uneven:   最不对等（|my_ratio-0.5| 降序）
 *
 * 静默超 4 小时算开启新对话，第一条是谁发的就记谁一次"开场"。
 * 纯时间戳计算，零 LLM。仅供娱乐，不代表关系本质。
 */

import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Hand, Loader2, RefreshCw, Share2, Check, AlertCircle, Scale } from 'lucide-react';
import { captureCardToPng } from '../../utils/exportPng';
import { avatarSrc } from '../../utils/avatar';
import { useToast } from '../common/Toast';
import { WelinkBrand } from './_shared';

interface ContactRow {
  username: string;
  display_name: string;
  avatar_url: string;
  my_opens: number;
  their_opens: number;
  total_sessions: number;
  my_ratio: number;
}

interface Resp {
  scanned_contacts: number;
  you_initiate: ContactRow[];
  they_initiate: ContactRow[];
  most_uneven: ContactRow[];
  generated_at: number;
}

type Tab = 'you' | 'they' | 'uneven';

const pct = (r: number) => `${Math.round(r * 100)}%`;

export const InitiativeRank: React.FC = () => {
  const toast = useToast();
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<Tab>('you');
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const fetchData = async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setErr('');
    try {
      const r = await axios.get<Resp>('/api/labs/initiative', { params: refresh ? { refresh: 1 } : {} });
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
      filename: `initiative-${today.replace(/\//g, '-')}.png`,
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

  const tabs: { key: Tab; label: string; hint: string }[] = [
    { key: 'you',    label: '你主动找的人', hint: '你总忍不住先开口 —— 你在意 TA' },
    { key: 'they',   label: '主动找你的人', hint: 'TA 总先来找你 —— TA 惦记你' },
    { key: 'uneven', label: '最不对等',     hint: '一方一直主动，一方很少先开口' },
  ];

  const rows = data
    ? (tab === 'you' ? data.you_initiate : tab === 'they' ? data.they_initiate : data.most_uneven)
    : [];

  const empty = data && data.you_initiate.length === 0 && data.they_initiate.length === 0;

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-3 gap-2">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          静默超过 4 小时算开启新对话，第一条是谁发的就记谁一次"开场"。零 LLM、秒出。
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
        <span>谁先开口受很多因素影响（谁更闲、谁有事找）。<strong>仅供娱乐回顾</strong>，别拿来计较谁更爱谁 😉</span>
      </div>

      {err && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/30 p-3 mb-4 text-xs text-red-700 dark:text-red-300">{err}</div>
      )}

      {loading && (
        <div className="text-center py-16 text-gray-400 text-sm flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" />
          数你和每个人，谁更常先开口…
        </div>
      )}

      {empty && !loading && (
        <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-8 text-center text-sm text-gray-500">
          样本不够 —— 需要有足够多"分段对话"才能算主动指数
          <div className="text-xs text-gray-400 mt-2">已扫描 {data?.scanned_contacts} 个私聊</div>
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
                className={`flex-1 px-2 py-2 rounded-xl text-xs font-bold transition-colors ${
                  tab === t.key
                    ? 'bg-gradient-to-r from-[#07c160] to-[#10aeff] text-white'
                    : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div ref={cardRef} className="rounded-2xl bg-white dark:bg-[#1c1c1e] overflow-hidden border border-gray-100 dark:border-white/10">
            {/* Hero */}
            <div className="px-7 py-6 bg-[#07c160]/8 dark:bg-[#07c160]/10 border-b border-[#07c160]/15">
              <div className="text-xs uppercase tracking-widest text-[#07c160] font-bold mb-1 flex items-center gap-1.5">
                {tab === 'uneven' ? <Scale size={12} /> : <Hand size={12} />}
                Initiative · 主动指数榜
              </div>
              <div className="text-2xl font-black text-[#1d1d1f] dark:text-gray-100 mb-1 break-words">
                {tabs.find(t => t.key === tab)?.label}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{tabs.find(t => t.key === tab)?.hint}</div>
            </div>

            {/* 榜单 */}
            <div className="px-5 py-4">
              {rows.length === 0 ? (
                <div className="text-center text-gray-400 text-sm py-6">这个维度暂无足够样本</div>
              ) : (
                <div className="space-y-1.5">
                  {rows.slice(0, 15).map((c, idx) => {
                    // 主指标：'you' 看我开场占比，'they' 看 TA 开场占比，'uneven' 看主动方
                    const theirRatio = 1 - c.my_ratio;
                    const mainPct = tab === 'they' ? theirRatio : c.my_ratio;
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
                          <div className="text-sm font-semibold text-[#1d1d1f] dark:text-gray-200 truncate">{c.display_name}</div>
                          {/* 开场占比可视化条：绿=你开场，蓝=TA 开场 */}
                          <div className="flex items-center gap-2 mt-1">
                            <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-[#10aeff]/25 flex">
                              <div className="h-full bg-[#07c160]" style={{ width: pct(c.my_ratio) }} />
                            </div>
                            <span className="text-[10px] font-mono text-gray-400 flex-shrink-0">
                              你 {c.my_opens} · TA {c.their_opens}
                            </span>
                          </div>
                        </div>
                        {/* 主指标大字 */}
                        <div className="text-right flex-shrink-0">
                          {tab === 'uneven' ? (
                            <div className={`text-base font-black ${c.my_ratio >= 0.5 ? 'text-[#07c160]' : 'text-[#10aeff]'}`}>
                              {c.my_ratio >= 0.5 ? '你' : 'TA'} {pct(Math.max(c.my_ratio, theirRatio))}
                            </div>
                          ) : (
                            <div className={`text-base font-black ${tab === 'they' ? 'text-[#10aeff]' : 'text-[#07c160]'}`}>
                              {pct(mainPct)}
                            </div>
                          )}
                          <div className="text-[10px] text-gray-300">{c.total_sessions} 段对话</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <WelinkBrand
              label="主动指数榜"
              leftText={<>已扫描 {data.scanned_contacts} 个私聊 · {tabs.find(t => t.key === tab)?.label}</>}
            />
          </div>
        </>
      )}
    </div>
  );
};
