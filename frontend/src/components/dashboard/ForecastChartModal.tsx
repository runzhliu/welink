/**
 * 关系预测 — 折线/柱状图大图 modal
 * 接收 12 月消息数数组（旧→新），展示大号柱状图 + 峰值标注 + 最后月高亮。
 */

import React, { useEffect, useMemo } from 'react';
import { X, TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface Props {
  displayName: string;
  status: 'rising' | 'cooling' | 'stable' | 'endangered';
  monthly12: number[];
  trendPct: number;
  initiatorRecent?: number; // 0-100，-1 = 样本不足
  initiatorPrior?: number;
  initiatorTrend?: number;
  theirLatencyRecentSec?: number; // 秒，-1 = 样本不足
  theirLatencyPriorSec?: number;
  mineLatencyRecentSec?: number;
  mineLatencyPriorSec?: number;
  onClose: () => void;
}

const formatDelay = (sec: number): string => {
  if (sec < 120) return `${sec} 秒`;
  if (sec < 3600) return `${Math.round(sec / 60)} 分钟`;
  if (sec < 86400) return `${Math.round(sec / 3600)} 小时`;
  return `${(sec / 86400).toFixed(1)} 天`;
};

const STATUS_COLOR: Record<Props['status'], string> = {
  endangered: '#fa5151',
  cooling:    '#10aeff',
  stable:     '#888',
  rising:     '#07c160',
};

const STATUS_LABEL: Record<Props['status'], string> = {
  endangered: '濒危',
  cooling:    '降温',
  stable:     '稳定',
  rising:     '升温',
};

const monthLabel = (offset: number): string => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - offset);
  return `${d.getMonth() + 1}月`;
};

export const ForecastChartModal: React.FC<Props> = ({
  displayName, status, monthly12, trendPct,
  initiatorRecent, initiatorPrior, initiatorTrend,
  theirLatencyRecentSec, theirLatencyPriorSec,
  mineLatencyRecentSec, mineLatencyPriorSec,
  onClose,
}) => {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const color = STATUS_COLOR[status];

  const { max, peakIdx, total, avg } = useMemo(() => {
    const m = Math.max(1, ...monthly12);
    let peak = 0;
    for (let i = 0; i < monthly12.length; i++) {
      if (monthly12[i] > monthly12[peak]) peak = i;
    }
    const sum = monthly12.reduce((a, b) => a + b, 0);
    return { max: m, peakIdx: peak, total: sum, avg: monthly12.length > 0 ? Math.round(sum / monthly12.length) : 0 };
  }, [monthly12]);

  const trendIcon = trendPct > 20 ? <TrendingUp size={14} className="text-[#07c160]" />
                  : trendPct < -20 ? <TrendingDown size={14} className="text-[#fa5151]" />
                  : <Minus size={14} className="text-gray-400" />;

  const chartH = 180;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-[#1d1d1f] rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/10">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-bold text-[#1d1d1f] dk-text truncate">{displayName}</span>
            <span
              className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold"
              style={{ backgroundColor: `${color}1a`, color }}
            >
              {STATUS_LABEL[status]}
            </span>
            <span className="text-xs text-gray-400 flex-shrink-0">· 过去 12 个月</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Stats summary */}
        <div className="grid grid-cols-3 divide-x divide-gray-100 dark:divide-white/10 border-b border-gray-100 dark:border-white/10">
          <div className="px-4 py-3">
            <div className="text-[11px] text-gray-400">12 月合计</div>
            <div className="text-lg font-black text-[#1d1d1f] dk-text">{total}</div>
          </div>
          <div className="px-4 py-3">
            <div className="text-[11px] text-gray-400">月均</div>
            <div className="text-lg font-black text-[#1d1d1f] dk-text">{avg}</div>
          </div>
          <div className="px-4 py-3">
            <div className="flex items-center gap-1 text-[11px] text-gray-400">
              {trendIcon}
              最近 3 月 vs 前 3 月
            </div>
            <div className="text-lg font-black" style={{ color: trendPct > 0 ? '#07c160' : trendPct < 0 ? '#fa5151' : '#1d1d1f' }}>
              {trendPct >= 999 ? '新关系' : `${trendPct > 0 ? '+' : ''}${trendPct}%`}
            </div>
          </div>
        </div>

        {/* 响应时延（有样本时才展示） */}
        {((typeof theirLatencyRecentSec === 'number' && theirLatencyRecentSec >= 0 && typeof theirLatencyPriorSec === 'number' && theirLatencyPriorSec >= 0) ||
          (typeof mineLatencyRecentSec === 'number' && mineLatencyRecentSec >= 0 && typeof mineLatencyPriorSec === 'number' && mineLatencyPriorSec >= 0)) && (
          <div className="px-5 py-3 border-b border-gray-100 dark:border-white/10">
            <div className="text-[11px] text-gray-400 mb-2">回复中位时延</div>
            <div className="grid grid-cols-2 gap-4 text-xs">
              {typeof theirLatencyRecentSec === 'number' && theirLatencyRecentSec >= 0 && typeof theirLatencyPriorSec === 'number' && theirLatencyPriorSec >= 0 && (
                <div>
                  <div className="text-[10px] text-gray-400 mb-1">TA 回复我</div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-gray-500 dk-text">{formatDelay(theirLatencyPriorSec)}</span>
                    <span className="text-gray-300">→</span>
                    <span className={`font-bold ${theirLatencyRecentSec > theirLatencyPriorSec * 1.5 ? 'text-[#fa5151]' : theirLatencyRecentSec < theirLatencyPriorSec / 1.5 ? 'text-[#07c160]' : 'text-[#1d1d1f] dk-text'}`}>
                      {formatDelay(theirLatencyRecentSec)}
                    </span>
                  </div>
                </div>
              )}
              {typeof mineLatencyRecentSec === 'number' && mineLatencyRecentSec >= 0 && typeof mineLatencyPriorSec === 'number' && mineLatencyPriorSec >= 0 && (
                <div>
                  <div className="text-[10px] text-gray-400 mb-1">我回复 TA</div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-gray-500 dk-text">{formatDelay(mineLatencyPriorSec)}</span>
                    <span className="text-gray-300">→</span>
                    <span className={`font-bold ${mineLatencyRecentSec > mineLatencyPriorSec * 1.5 ? 'text-[#fa5151]' : mineLatencyRecentSec < mineLatencyPriorSec / 1.5 ? 'text-[#07c160]' : 'text-[#1d1d1f] dk-text'}`}>
                      {formatDelay(mineLatencyRecentSec)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 主动占比 —— 有样本时才展示 */}
        {typeof initiatorRecent === 'number' && initiatorRecent >= 0 && typeof initiatorPrior === 'number' && initiatorPrior >= 0 && (
          <div className="px-5 py-3 border-b border-gray-100 dark:border-white/10">
            <div className="flex items-center justify-between text-[11px] mb-2">
              <span className="text-gray-400">我的主动占比</span>
              {typeof initiatorTrend === 'number' && initiatorTrend !== 0 && (
                <span className={`font-bold ${initiatorTrend > 0 ? 'text-[#07c160]' : 'text-[#fa5151]'}`}>
                  {initiatorTrend > 0 ? '+' : ''}{initiatorTrend} 个百分点
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs">
              <div className="flex-1">
                <div className="text-[10px] text-gray-400 mb-0.5">前 3 月</div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-gray-100 dark:bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full bg-gray-400" style={{ width: `${initiatorPrior}%` }} />
                  </div>
                  <span className="w-10 text-right font-bold text-gray-500 dk-text">{initiatorPrior}%</span>
                </div>
              </div>
              <div className="flex-1">
                <div className="text-[10px] text-gray-400 mb-0.5">最近 3 月</div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-gray-100 dark:bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full bg-[#576b95]" style={{ width: `${initiatorRecent}%` }} />
                  </div>
                  <span className="w-10 text-right font-bold text-[#576b95]">{initiatorRecent}%</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Chart */}
        <div className="px-5 py-5">
          <div className="relative" style={{ height: chartH }}>
            <div className="absolute inset-0 flex items-end gap-1.5">
              {monthly12.map((v, i) => {
                const pct = (v / max) * 100;
                const isPeak = i === peakIdx && v > 0;
                const isLast = i === monthly12.length - 1;
                const barColor = isPeak ? color : isLast ? color : '#e5e7eb';
                return (
                  <div key={i} className="flex-1 flex flex-col items-center justify-end h-full group">
                    <div
                      className="w-full rounded-t-md transition-all relative"
                      style={{
                        height: `${pct}%`,
                        minHeight: v > 0 ? 2 : 0,
                        backgroundColor: barColor,
                        opacity: isPeak || isLast ? 1 : 0.5,
                      }}
                    >
                      {isPeak && v > 0 && (
                        <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] font-bold text-white px-1.5 py-0.5 rounded" style={{ backgroundColor: color }}>
                          峰值 {v}
                        </div>
                      )}
                    </div>
                    <div className="text-[9px] text-gray-400 mt-1 group-hover:text-gray-600 dk-text">
                      {monthLabel(monthly12.length - 1 - i)}
                    </div>
                    <div className={`text-[10px] font-bold ${isLast ? 'text-[#1d1d1f] dk-text' : 'text-gray-400'}`}>
                      {v > 0 ? v : ''}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="px-5 pb-4 flex items-center gap-4 text-[11px] text-gray-400">
          <span className="flex items-center gap-1">
            <span className="w-3 h-2.5 rounded-sm" style={{ backgroundColor: color }} />
            峰值 / 当月
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-2.5 rounded-sm bg-gray-200 dark:bg-white/20" />
            其他月份
          </span>
        </div>
      </div>
    </div>
  );
};
