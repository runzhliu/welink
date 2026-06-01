/**
 * 话题图谱 Lab（AI 聚类）—— 「我这一年/这段时间，都在聊什么？」
 *
 * 两步：本地抽高频词（受全局时间范围影响）→ LLM 聚成有名字 + emoji 的主题。
 * 主题从真实语料涌现，可能出现"考研冲刺/装修选材/猫猫日常"这种贴身主题。
 *
 * POST /api/labs/topic-map  body: {refresh?: boolean}
 */

import React, { useRef, useState } from 'react';
import axios from 'axios';
import { LayoutGrid, Loader2, RefreshCw, Share2, Check, AlertCircle, Sparkles } from 'lucide-react';
import { captureCardToPng } from '../../utils/exportPng';
import { useToast } from '../common/Toast';
import { WelinkBrand } from './_shared';

interface Theme {
  emoji: string;
  name: string;
  percent: number;
  keywords: string[];
  top_contacts: string[];
  blurb: string;
}

interface Resp {
  themes: Theme[];
  scanned_contacts: number;
  total_contacts: number;
  words_analyzed: number;
  generated_at: number;
}

// 给前 N 个主题一组柔和的主题色（条形 + 标签底色）
const PALETTE = [
  '#07c160', '#10aeff', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#6366f1',
];

export const TopicMap: React.FC = () => {
  const toast = useToast();
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const [err, setErr] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const generate = async (refresh = false) => {
    if (loading) return;
    setLoading(true);
    setStarted(true);
    setErr('');
    if (!refresh) setData(null);
    try {
      const r = await axios.post<Resp>('/api/labs/topic-map', { refresh });
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
    const r = await captureCardToPng(cardRef.current, {
      filename: `topic-map-${today.replace(/\//g, '-')}.png`,
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

  // 占比最大的拿来做"主题之最"
  const maxPct = data ? Math.max(...data.themes.map(t => t.percent), 1) : 1;

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-3 gap-2">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          先在本地抽出高频词，再交给你配置的 AI 聚成有名字的话题。跟着顶部的时间范围走（切「今年 / 全部」换口径）。
        </p>
        <div className="flex gap-2 flex-shrink-0">
          {data && (
            <button
              onClick={() => generate(true)}
              disabled={loading}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/15 disabled:opacity-50 transition-colors"
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              重新生成
            </button>
          )}
          {data && (
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
        <span>主题由 AI 从高频词归纳，占比是粗略估算。只把<strong>必要的词表</strong>送给你自己配置的 LLM，原文不出本机。仅供回顾娱乐。</span>
      </div>

      {err && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/30 p-3 mb-4 text-xs text-red-700 dark:text-red-300">{err}</div>
      )}

      {/* 未开始：引导按钮 */}
      {!started && (
        <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-10 text-center">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#07c160] to-[#10aeff] flex items-center justify-center mx-auto mb-4 shadow-sm">
            <LayoutGrid size={26} className="text-white" />
          </div>
          <h3 className="text-base font-black text-[#1d1d1f] dark:text-gray-100 mb-1">我的话题宇宙</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-5 max-w-sm mx-auto">
            扫一遍你最常聊的那些人，AI 帮你把聊天内容聚成几个主题——看看这段时间你的注意力都花在哪儿了。
          </p>
          <button
            onClick={() => generate(false)}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-bold bg-gradient-to-r from-[#07c160] to-[#10aeff] text-white hover:opacity-90 transition-opacity"
          >
            <Sparkles size={15} />
            生成话题图谱
          </button>
        </div>
      )}

      {loading && !data && (
        <div className="text-center py-16 text-gray-400 text-sm flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" />
          抽词中 → 交给 AI 聚类（约十几秒）…
        </div>
      )}

      {data && (
        <div ref={cardRef} className="rounded-2xl bg-white dark:bg-[#1c1c1e] overflow-hidden border border-gray-100 dark:border-white/10">
          {/* Hero */}
          <div className="px-7 py-6 bg-[#07c160]/8 dark:bg-[#07c160]/10 border-b border-[#07c160]/15">
            <div className="text-xs uppercase tracking-widest text-[#07c160] font-bold mb-1 flex items-center gap-1.5">
              <LayoutGrid size={12} />
              Topic Map · 话题图谱
            </div>
            <div className="text-2xl font-black text-[#1d1d1f] dark:text-gray-100 mb-1">我的话题宇宙</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              从 {data.scanned_contacts} 个私聊、{data.words_analyzed} 个高频词里聚出 {data.themes.length} 个主题
            </div>
          </div>

          {/* 主题列表 */}
          <div className="px-5 py-4 space-y-2.5">
            {data.themes.map((t, idx) => {
              const color = PALETTE[idx % PALETTE.length];
              const barW = Math.round((t.percent / maxPct) * 100);
              return (
                <div key={`${t.name}-${idx}`} className="rounded-xl border border-gray-100 dark:border-white/10 p-3">
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <span className="text-xl flex-shrink-0">{t.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-black text-[#1d1d1f] dark:text-gray-100 truncate">{t.name}</span>
                        <span className="text-xs font-mono font-bold flex-shrink-0" style={{ color }}>{t.percent}%</span>
                      </div>
                    </div>
                  </div>

                  {/* 占比条 */}
                  <div className="h-1.5 rounded-full bg-gray-100 dark:bg-white/10 overflow-hidden mb-2">
                    <div className="h-full rounded-full" style={{ width: `${barW}%`, background: color }} />
                  </div>

                  {/* 点评 */}
                  {t.blurb && (
                    <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-2 leading-snug">{t.blurb}</div>
                  )}

                  {/* 代表词 + 主要聊的人 */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {t.keywords.slice(0, 6).map(k => (
                      <span
                        key={k}
                        className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                        style={{ background: `${color}1a`, color }}
                      >
                        {k}
                      </span>
                    ))}
                    {t.top_contacts.length > 0 && (
                      <span className="text-[10px] text-gray-400 ml-1">
                        常聊：{t.top_contacts.join('、')}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <WelinkBrand
            label="话题图谱"
            leftText={<>已分析 {data.scanned_contacts}/{data.total_contacts} 个私聊 · {data.themes.length} 个主题</>}
          />
        </div>
      )}
    </div>
  );
};
