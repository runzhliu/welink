/**
 * 关系预测完整 Section — 嵌入 StatsPage 底部
 * 4 档 tab（濒危/降温/稳定/升温），每条带 12 月迷你折线 + reason/suggestion
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Sparkles, AlertCircle, Snowflake, Activity, TrendingUp, Loader2, Wand2, EyeOff, Clock } from 'lucide-react';
import type { ContactStats, ForecastEntry, ForecastStatus, ForecastResponse } from '../../types';
import { forecastApi } from '../../services/api';
import { avatarSrc } from '../../utils/avatar';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';
import { IcebreakerModal } from './IcebreakerModal';
import { ForecastChartModal } from './ForecastChartModal';
import { loadHistory, upsertSnapshot, extractStatuses, consecutiveCoolingWeeks } from '../../utils/forecastHistory';

interface Props {
  contacts: ContactStats[];
  onContactClick?: (contact: ContactStats) => void;
}

const STATUS_META: Record<ForecastStatus, { label: string; color: string; icon: React.ReactNode; sparkColor: string }> = {
  endangered: { label: '濒危',   color: 'text-[#fa5151]', icon: <AlertCircle size={14} />, sparkColor: '#fa5151' },
  cooling:    { label: '降温',   color: 'text-[#10aeff]', icon: <Snowflake size={14} />,   sparkColor: '#10aeff' },
  stable:     { label: '稳定',   color: 'text-gray-500',  icon: <Activity size={14} />,    sparkColor: '#888' },
  rising:     { label: '升温',   color: 'text-[#07c160]', icon: <TrendingUp size={14} />,  sparkColor: '#07c160' },
};

const TAB_ORDER: ForecastStatus[] = ['endangered', 'cooling', 'rising', 'stable'];

const Sparkline: React.FC<{ data: number[]; color: string }> = ({ data, color }) => {
  const w = 80;
  const h = 24;
  const max = Math.max(1, ...data);
  const step = data.length > 1 ? w / (data.length - 1) : w;
  const points = data.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} className="flex-shrink-0">
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" points={points} />
      {data.length > 0 && (
        <circle
          cx={(data.length - 1) * step}
          cy={h - (data[data.length - 1] / max) * h}
          r="1.8"
          fill={color}
        />
      )}
    </svg>
  );
};

export const RelationshipForecastSection: React.FC<Props> = ({ contacts, onContactClick }) => {
  const { privacyMode } = usePrivacyMode();
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ForecastStatus>('endangered');
  const [icebreakerFor, setIcebreakerFor] = useState<ForecastEntry | null>(null);
  const [chartFor, setChartFor] = useState<ForecastEntry | null>(null);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [busyIgnore, setBusyIgnore] = useState<string | null>(null);

  // 加载当前忽略列表
  useEffect(() => {
    fetch('/api/preferences').then(r => r.json()).then(d => {
      if (Array.isArray(d?.forecast_ignored)) setIgnored(d.forecast_ignored);
    }).catch(() => { /* ignore */ });
  }, []);

  const handleIgnore = async (username: string) => {
    setBusyIgnore(username);
    const next = [...ignored.filter(u => u !== username), username];
    try {
      await forecastApi.saveIgnored(next);
      setIgnored(next);
      // 直接在当前数据里本地过滤（不重新请求）
      setData(prev => {
        if (!prev) return prev;
        const strip = (arr?: ForecastEntry[]) => arr?.filter(e => e.username !== username);
        return {
          ...prev,
          suggest_contact: strip(prev.suggest_contact) || [],
          all: strip(prev.all),
        };
      });
    } catch {
      // ignore
    } finally {
      setBusyIgnore(null);
    }
  };

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    forecastApi.getAll()
      .then(resp => {
        if (mounted) {
          setData(resp);
          upsertSnapshot(extractStatuses(resp), resp.generated_at);
        }
      })
      .catch(() => { /* 静默：让外层显示空 */ })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  const history = useMemo(() => loadHistory(), [data]);

  const grouped = useMemo(() => {
    const out: Record<ForecastStatus, ForecastEntry[]> = {
      endangered: [], cooling: [], stable: [], rising: [],
    };
    if (!data?.all) return out;
    const allowed = new Set(contacts.map(c => c.username));
    for (const e of data.all) {
      if (!allowed.has(e.username)) continue;
      out[e.status].push(e);
    }
    return out;
  }, [data, contacts]);

  const handleClick = (e: ForecastEntry) => {
    const c = contacts.find(ct => ct.username === e.username);
    if (c && onContactClick) onContactClick(c);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32 gap-2 text-gray-400">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-xs">正在分析关系趋势…</span>
      </div>
    );
  }

  if (!data?.all || data.all.length === 0) return null;

  const counts: Record<ForecastStatus, number> = {
    endangered: grouped.endangered.length,
    cooling:    grouped.cooling.length,
    stable:     grouped.stable.length,
    rising:     grouped.rising.length,
  };

  const list = grouped[activeTab];

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Sparkles size={18} className="text-[#576b95]" />
        <h3 className="text-xl font-bold text-[#1d1d1f] dk-text">关系动态预测</h3>
        <span className="text-xs text-gray-400">基于过去 12 个月节奏，覆盖 {data.total_scored} 位活跃联系人</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {TAB_ORDER.map(tab => {
          const meta = STATUS_META[tab];
          const active = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
                active
                  ? `bg-white shadow-sm border border-gray-200 dark:bg-white/10 dark:border-white/10 ${meta.color}`
                  : 'bg-gray-100 dark:bg-white/5 text-gray-400 hover:text-gray-600 dk-text hover:bg-gray-200'
              }`}
            >
              <span className={meta.color}>{meta.icon}</span>
              <span>{meta.label}</span>
              <span className={`text-[10px] ${active ? 'opacity-80' : 'opacity-60'}`}>{counts[tab]}</span>
            </button>
          );
        })}
      </div>

      {/* List */}
      {list.length === 0 ? (
        <div className="dk-card bg-white dk-border border border-gray-100 rounded-2xl px-5 py-8 text-center text-sm text-gray-300">
          这一档没有联系人
        </div>
      ) : (
        <div className="dk-card bg-white dk-border border border-gray-100 rounded-2xl divide-y divide-gray-100 dark:divide-white/5">
          {list.map(item => {
            const meta = STATUS_META[item.status];
            const weeks = consecutiveCoolingWeeks(history, item.username);
            return (
              <div
                key={item.username}
                onClick={() => handleClick(item)}
                className="flex items-center gap-3 px-5 py-3.5 cursor-pointer hover:bg-[#f8f9fb] dark:hover:bg-white/5 transition-colors"
              >
                {item.avatar_url ? (
                  <img
                    loading="lazy"
                    src={avatarSrc(item.avatar_url)}
                    alt=""
                    className="w-9 h-9 rounded-full object-cover flex-shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : (
                  <div className={`w-9 h-9 rounded-full bg-gray-100 dark:bg-white/10 flex items-center justify-center flex-shrink-0 ${meta.color}`}>
                    {meta.icon}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-bold text-[#1d1d1f] dk-text truncate${privacyMode ? ' privacy-blur' : ''}`}>
                      {item.display_name}
                    </span>
                    <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${meta.color} bg-current/10`} style={{ backgroundColor: `${meta.sparkColor}1a` }}>
                      {meta.label}
                    </span>
                    {weeks >= 2 && (item.status === 'cooling' || item.status === 'endangered') && (
                      <span className="flex-shrink-0 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#fa5151]/10 text-[#fa5151]" title={`连续 ${weeks} 周处于降温/濒危`}>
                        <Clock size={10} />
                        连续 {weeks} 周
                      </span>
                    )}
                  </div>
                  <div className={`text-xs text-gray-500 mt-0.5 truncate${privacyMode ? ' privacy-blur' : ''}`}>
                    {item.reason}
                  </div>
                  {item.suggestion && (item.status === 'cooling' || item.status === 'endangered') ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); setIcebreakerFor(item); }}
                      className="flex items-center gap-1 text-[11px] text-[#576b95] mt-1 hover:text-[#3d5a8f] hover:underline underline-offset-2 transition-colors"
                    >
                      <Wand2 size={10} />
                      <span className="truncate">写开场白 · {item.suggestion}</span>
                    </button>
                  ) : item.suggestion ? (
                    <div className="text-[11px] text-[#576b95] mt-1 truncate">💡 {item.suggestion}</div>
                  ) : null}
                </div>
                {item.monthly_12 && item.monthly_12.length > 0 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setChartFor(item); }}
                    className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
                    title="查看 12 月曲线"
                  >
                    <Sparkline data={item.monthly_12} color={meta.sparkColor} />
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); handleIgnore(item.username); }}
                  disabled={busyIgnore === item.username}
                  title="不再推荐此人"
                  className="p-1.5 rounded-md text-gray-300 hover:text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10 disabled:opacity-50 transition-colors"
                >
                  <EyeOff size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {icebreakerFor && (
        <IcebreakerModal
          username={icebreakerFor.username}
          fallbackDisplayName={icebreakerFor.display_name}
          reason={icebreakerFor.reason}
          onClose={() => setIcebreakerFor(null)}
        />
      )}

      {chartFor && chartFor.monthly_12 && (
        <ForecastChartModal
          displayName={chartFor.display_name}
          status={chartFor.status}
          monthly12={chartFor.monthly_12}
          trendPct={chartFor.trend_pct}
          initiatorRecent={chartFor.initiator_recent}
          initiatorPrior={chartFor.initiator_prior}
          initiatorTrend={chartFor.initiator_trend}
          theirLatencyRecentSec={chartFor.their_latency_recent_sec}
          theirLatencyPriorSec={chartFor.their_latency_prior_sec}
          mineLatencyRecentSec={chartFor.mine_latency_recent_sec}
          mineLatencyPriorSec={chartFor.mine_latency_prior_sec}
          onClose={() => setChartFor(null)}
        />
      )}
    </div>
  );
};
