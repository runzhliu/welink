/**
 * 群聊 AI 年度回顾 Modal —— Spotify Wrapped 风格
 * 分页展示：年度概览 / 活跃榜 / 金句 / 月度曲线 / 叙事
 */

import React, { useEffect, useState } from 'react';
import { X, Loader2, Calendar, MessageSquare, Users, Crown, Sparkles, Quote, TrendingUp, AlertCircle } from 'lucide-react';
import type { GroupYearReview } from '../../types';
import { groupExtraApi } from '../../services/api';
import { avatarSrc } from '../../utils/avatar';
import { TTSButton } from '../common/TTSButton';

interface Props {
  username: string;
  fallbackName: string;
  onClose: () => void;
}

export const GroupYearReviewModal: React.FC<Props> = ({ username, fallbackName, onClose }) => {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<number>(currentYear);
  const [data, setData] = useState<GroupYearReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError('');
    setData(null);
    setPage(0);
    groupExtraApi.yearReview(username, year)
      .then(r => { if (mounted) setData(r); })
      .catch(e => {
        const msg = e?.response?.data?.error || e?.message || String(e);
        if (mounted) setError(msg);
      })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [username, year]);

  const years = Array.from({ length: 6 }, (_, i) => currentYear - i);
  const pages: { title: string; icon: React.ReactNode; render: () => React.ReactNode }[] = [];

  if (data) {
    pages.push({
      title: '年度概览',
      icon: <Calendar size={18} />,
      render: () => (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-[#f0faf4] dark:bg-[#07c160]/10 rounded-2xl p-4 text-center">
              <MessageSquare className="mx-auto text-[#07c160] mb-1" size={20} />
              <div className="text-2xl font-black text-[#1d1d1f] dk-text">{data.total_messages.toLocaleString()}</div>
              <div className="text-xs text-gray-400">年度消息数</div>
            </div>
            <div className="bg-[#e8f3ff] dark:bg-[#10aeff]/10 rounded-2xl p-4 text-center">
              <Users className="mx-auto text-[#10aeff] mb-1" size={20} />
              <div className="text-2xl font-black text-[#1d1d1f] dk-text">{data.total_members}</div>
              <div className="text-xs text-gray-400">活跃成员数</div>
            </div>
          </div>
          {data.busiest_day && (
            <div className="bg-[#fff3e6] dark:bg-[#ff9500]/10 rounded-2xl p-4">
              <div className="text-xs text-gray-400 mb-1">最忙的一天</div>
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-black text-[#ff9500]">{data.busiest_day}</span>
                <span className="text-sm text-gray-500 dk-text">一天发了 {data.busiest_day_count} 条</span>
              </div>
            </div>
          )}
          {data.top_topics.length > 0 && (
            <div className="bg-[#f8f9fb] dark:bg-white/5 rounded-2xl p-4">
              <div className="text-xs text-gray-400 mb-2">年度热词</div>
              <div className="flex flex-wrap gap-2">
                {data.top_topics.map((t, i) => (
                  <span key={t} className={`px-3 py-1 rounded-full text-sm font-bold ${i === 0 ? 'bg-[#fa5151]/15 text-[#fa5151]' : 'bg-[#576b95]/10 text-[#576b95]'}`}>
                    {i === 0 ? '🔥' : ''}{t}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      ),
    });

    pages.push({
      title: '年度话痨榜',
      icon: <Crown size={18} />,
      render: () => (
        <div className="space-y-3">
          {data.top_members.length === 0 ? (
            <div className="text-center text-gray-400 py-10 text-sm">该年没有活跃成员</div>
          ) : data.top_members.map((m, i) => {
            const medals = ['🥇', '🥈', '🥉'];
            const max = data.top_members[0]?.messages || 1;
            return (
              <div key={m.username || i} className="bg-white dark:bg-white/5 border dk-border rounded-2xl p-4">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl flex-shrink-0">{medals[i] || '🏅'}</span>
                  {m.avatar_url ? (
                    <img loading="lazy" src={avatarSrc(m.avatar_url)} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#576b95] to-[#3d5a8f] flex items-center justify-center text-white flex-shrink-0">
                      {m.display_name.slice(0, 1)}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-[#1d1d1f] dk-text truncate">{m.display_name}</div>
                    <div className="text-xs text-gray-400">{m.messages.toLocaleString()} 条 · 占全年 {((m.messages / data.total_messages) * 100).toFixed(1)}%</div>
                  </div>
                </div>
                <div className="h-2 bg-gray-100 dark:bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-[#07c160] to-[#06ad56]" style={{ width: `${(m.messages / max) * 100}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      ),
    });

    if (data.golden_quotes && data.golden_quotes.length > 0) {
      pages.push({
        title: 'AI 精选金句',
        icon: <Quote size={18} />,
        render: () => (
          <div className="space-y-3">
            {data.golden_quotes.map((q, i) => (
              <div key={i} className="bg-gradient-to-br from-[#fff9e6] to-[#fff0f0] dark:from-[#ff9500]/10 dark:to-[#fa5151]/10 rounded-2xl p-5 border border-[#ff9500]/20">
                <Quote className="text-[#ff9500] mb-2" size={20} />
                <div className="text-base text-[#1d1d1f] dk-text leading-relaxed font-medium break-words">{q}</div>
              </div>
            ))}
          </div>
        ),
      });
    }

    // 月度趋势
    if (data.monthly_trend && data.monthly_trend.some(v => v > 0)) {
      pages.push({
        title: '月度消息趋势',
        icon: <TrendingUp size={18} />,
        render: () => {
          const max = Math.max(...data.monthly_trend);
          return (
            <div className="space-y-4">
              <div className="flex items-end gap-1 h-48">
                {data.monthly_trend.map((v, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center justify-end h-full group">
                    <div className="text-[10px] text-gray-400 mb-1 opacity-0 group-hover:opacity-100 transition-opacity">{v}</div>
                    <div className="w-full rounded-t-lg transition-all" style={{
                      height: `${max > 0 ? (v / max) * 100 : 0}%`,
                      backgroundColor: '#07c160',
                      opacity: v === max && v > 0 ? 1 : 0.6,
                      minHeight: v > 0 ? 2 : 0,
                    }} />
                    <div className="text-[10px] text-gray-500 dk-text mt-1">{i + 1}月</div>
                  </div>
                ))}
              </div>
              <div className="text-[11px] text-gray-400 text-center">
                峰值 {max} 条 · 平均 {Math.round(data.monthly_trend.reduce((a, b) => a + b, 0) / 12)} 条 / 月
              </div>
            </div>
          );
        },
      });
    }

    if (data.highlight) {
      const highlight = data.highlight; // 在闭包里固化，TS narrowing 跨 render 箭头函数会丢
      pages.push({
        title: 'AI 年度叙事',
        icon: <Sparkles size={18} />,
        render: () => (
          <div className="relative bg-gradient-to-br from-[#f5f7fb] to-[#fff7e6] dark:from-[#576b95]/10 dark:to-[#ff9500]/10 rounded-2xl p-6 border border-[#576b95]/20">
            <div className="absolute top-3 right-3">
              <TTSButton text={highlight} size={16} title="朗读年度叙事" />
            </div>
            <Sparkles className="text-[#576b95] mb-3" size={24} />
            <div className="text-base text-[#1d1d1f] dk-text leading-[1.9] whitespace-pre-wrap">
              {highlight}
            </div>
          </div>
        ),
      });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white dark:bg-[#1d1d1f] rounded-3xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col" style={{ maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-white/10">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xl">📖</span>
            <span className="text-base font-bold text-[#1d1d1f] dk-text truncate">
              {data?.group_name || fallbackName} · {year} 年报
            </span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <select
              value={year}
              onChange={e => setYear(Number(e.target.value))}
              disabled={loading}
              className="text-xs bg-gray-100 dark:bg-white/10 border-0 rounded-lg px-2 py-1"
            >
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <Loader2 size={32} className="text-[#07c160] animate-spin" />
              <span className="text-sm text-gray-400">AI 正在翻阅全年聊天…</span>
              <span className="text-[11px] text-gray-300">含 LLM 提炼，大群可能需要 10-30 秒</span>
            </div>
          )}
          {!loading && error && (
            <div className="flex items-start gap-3 p-4 bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 rounded-2xl">
              <AlertCircle size={18} className="text-[#fa5151] flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="text-sm font-bold text-[#fa5151]">生成失败</div>
                <div className="text-xs text-gray-500 dk-text mt-1 break-all">{error}</div>
              </div>
            </div>
          )}
          {!loading && !error && data && pages[page] && pages[page].render()}
        </div>

        {/* Footer: 分页 */}
        {pages.length > 0 && !loading && !error && (
          <div className="border-t border-gray-100 dark:border-white/10 px-4 py-3 flex items-center justify-between gap-2">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-white/10 text-gray-500 dk-text font-bold disabled:opacity-30 hover:bg-gray-200 transition-colors"
            >
              ← 上一页
            </button>
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {pages.map((p, i) => (
                <button
                  key={i}
                  onClick={() => setPage(i)}
                  className={`flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg font-bold whitespace-nowrap transition-colors ${i === page ? 'bg-[#07c160] text-white' : 'bg-gray-100 dark:bg-white/10 text-gray-500 dk-text hover:bg-gray-200'}`}
                >
                  {p.icon}
                  {p.title}
                </button>
              ))}
            </div>
            <button
              onClick={() => setPage(p => Math.min(pages.length - 1, p + 1))}
              disabled={page === pages.length - 1}
              className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-white/10 text-gray-500 dk-text font-bold disabled:opacity-30 hover:bg-gray-200 transition-colors"
            >
              下一页 →
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
