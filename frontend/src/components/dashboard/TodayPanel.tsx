/**
 * 首页右侧聚合面板：把「建议主动联系」「今日纪念日」「每周摘要」
 * 合并为一个带 tab 的悬浮面板，避免抢占 AI 首页中央视觉。
 *
 * - tab 只显示有数据的那个；全部为空时整面板静默不渲染
 * - X 关闭 = 今日不再提醒（一次性覆盖三项）
 * - 折叠 = 贴右侧小标签，状态持久化 localStorage
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Sparkles, Snowflake, AlertCircle, Wand2, EyeOff, X, Clock, ChevronRight,
  Cake, Heart, PartyPopper, Target, ArrowRight, TrendingDown, TrendingUp,
} from 'lucide-react';
import type {
  ContactStats, AnniversaryResponse,
  ForecastEntry, ForecastResponse, ForecastStatus,
} from '../../types';
import { forecastApi, anniversaryApi } from '../../services/api';
import { avatarSrc } from '../../utils/avatar';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';
import { IcebreakerModal } from './IcebreakerModal';
import {
  isoWeekKey, loadHistory, upsertSnapshot, extractStatuses,
  consecutiveCoolingWeeks, type Snapshot,
} from '../../utils/forecastHistory';

interface Props {
  contacts: ContactStats[];
  onContactClick?: (contact: ContactStats) => void;
  onNavigateToAnniversary?: () => void;
}

const DISMISS_KEY = 'welink:today-panel-dismissed-day';
const COLLAPSED_KEY = 'welink:today-panel-collapsed';
const ACTIVE_TAB_KEY = 'welink:today-panel-tab';

type TabId = 'forecast' | 'anniv' | 'digest';

const todayMMDD = (): string => {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const todayKey = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ─── forecast（建议主动联系）──────────────────────────────────────────────
const forecastStatusIcon = (status: ForecastEntry['status']) => {
  if (status === 'endangered') return <AlertCircle size={12} className="text-[#fa5151]" />;
  return <Snowflake size={12} className="text-[#10aeff]" />;
};

const forecastBadge = (status: ForecastEntry['status']): { label: string; cls: string } => {
  if (status === 'endangered') return { label: '濒危', cls: 'bg-[#fa5151]/10 text-[#fa5151]' };
  return { label: '降温', cls: 'bg-[#10aeff]/10 text-[#10aeff]' };
};

// ─── anniversary（今日纪念日）────────────────────────────────────────────
type AnnivItem =
  | { kind: 'years'; title: string; subtitle: string; avatar?: string; username: string }
  | { kind: 'birthday'; title: string; subtitle: string; avatar?: string; username: string }
  | { kind: 'milestone'; title: string; subtitle: string; avatar?: string; username: string }
  | { kind: 'custom'; title: string; subtitle: string };

const annivIcon = (kind: AnnivItem['kind']) => {
  if (kind === 'years') return <PartyPopper size={14} className="text-[#07c160]" />;
  if (kind === 'birthday') return <Cake size={14} className="text-[#fa5151]" />;
  if (kind === 'milestone') return <Target size={14} className="text-[#10aeff]" />;
  return <Heart size={14} className="text-[#ff9500]" />;
};

// ─── digest（每周变化摘要）──────────────────────────────────────────────
const isWorsening = (from: ForecastStatus | undefined, to: ForecastStatus): boolean => {
  if (to === 'endangered' && from !== 'endangered') return true;
  if (to === 'cooling' && (from === 'rising' || from === 'stable' || !from)) return true;
  return false;
};
const isImproving = (from: ForecastStatus | undefined, to: ForecastStatus): boolean => {
  if ((to === 'stable' || to === 'rising') && (from === 'cooling' || from === 'endangered')) return true;
  return false;
};

// ─── 主组件 ─────────────────────────────────────────────────────────────

export const TodayPanel: React.FC<Props> = ({ contacts, onContactClick, onNavigateToAnniversary }) => {
  const { privacyMode } = usePrivacyMode();
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [anniv, setAnniv] = useState<AnniversaryResponse | null>(null);
  const [prevSnapshot, setPrevSnapshot] = useState<Snapshot | null>(null);
  const [localIgnored, setLocalIgnored] = useState<Set<string>>(new Set());
  const [icebreakerFor, setIcebreakerFor] = useState<ForecastEntry | null>(null);
  const [mounted, setMounted] = useState(false);

  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem(DISMISS_KEY) === todayKey(); } catch { return false; }
  });
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; }
  });
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    try {
      const saved = localStorage.getItem(ACTIVE_TAB_KEY);
      if (saved === 'forecast' || saved === 'anniv' || saved === 'digest') return saved;
    } catch { /* ignore */ }
    return 'forecast';
  });

  // 入场动画
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // 拉 forecast（含 all，用于 digest）+ 维护快照
  useEffect(() => {
    let alive = true;
    const history = loadHistory();
    const thisWeek = isoWeekKey();
    const prev = [...history].reverse().find(s => s.weekKey !== thisWeek) ?? null;

    forecastApi.getAll().then(resp => {
      if (!alive) return;
      setForecast(resp);
      upsertSnapshot(extractStatuses(resp), resp.generated_at);
      if (prev) setPrevSnapshot(prev);
    }).catch(() => { /* 静默 */ });
    return () => { alive = false; };
  }, []);

  // 拉 anniversary
  useEffect(() => {
    let alive = true;
    anniversaryApi.getAll()
      .then(resp => { if (alive) setAnniv(resp); })
      .catch(() => { /* 静默 */ });
    return () => { alive = false; };
  }, []);

  // forecast items
  const forecastItems = useMemo(() => {
    if (!forecast) return [];
    const allowed = new Set(contacts.map(c => c.username));
    return forecast.suggest_contact.filter(e => allowed.has(e.username) && !localIgnored.has(e.username));
  }, [forecast, contacts, localIgnored]);

  const forecastHistory = useMemo(() => loadHistory(), [forecast]);

  // anniversary items
  const annivItems = useMemo<AnnivItem[]>(() => {
    const mmdd = todayMMDD();
    const today = new Date();
    const out: AnnivItem[] = [];
    const seen = new Set<string>();

    for (const c of contacts) {
      const ts = c.first_message_ts;
      if (!ts) continue;
      const d = new Date(ts * 1000);
      const cmm = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (cmm !== mmdd) continue;
      const years = today.getFullYear() - d.getFullYear();
      if (years < 1) continue;
      const name = c.remark || c.nickname || c.username;
      out.push({
        kind: 'years',
        title: `和 ${name} 认识 ${years} 周年`,
        subtitle: `${d.getFullYear()}-${cmm} 第一次在微信说话`,
        avatar: c.small_head_url || c.big_head_url || undefined,
        username: c.username,
      });
      seen.add(c.username);
    }

    if (anniv) {
      const allowed = new Set(contacts.map(c => c.username));
      for (const e of anniv.detected || []) {
        if (e.date !== mmdd) continue;
        if (!allowed.has(e.username)) continue;
        out.push({
          kind: 'birthday',
          title: `${e.display_name} 的生日`,
          subtitle: e.evidence ? `线索：${e.evidence}` : `${e.years.length} 次记录`,
          avatar: e.avatar_url,
          username: e.username,
        });
      }
      for (const m of anniv.milestones || []) {
        if (m.days_until !== 0) continue;
        if (!allowed.has(m.username)) continue;
        if (seen.has(m.username)) continue;
        out.push({
          kind: 'milestone',
          title: `和 ${m.display_name} 相识 ${m.next_milestone} 天`,
          subtitle: `从 ${m.first_msg_date} 起算`,
          avatar: m.avatar_url,
          username: m.username,
        });
      }
      const todayFull = todayKey();
      for (const c of anniv.custom || []) {
        const matched = c.recurring ? c.date.slice(5) === mmdd : c.date === todayFull;
        if (!matched) continue;
        out.push({
          kind: 'custom',
          title: c.title,
          subtitle: c.recurring ? '每年的今天' : c.date,
        });
      }
    }
    return out;
  }, [contacts, anniv]);

  // digest
  const digest = useMemo(() => {
    if (!forecast || !prevSnapshot || !forecast.all) return null;
    let worsened = 0;
    let improved = 0;
    for (const e of forecast.all) {
      const from = prevSnapshot.statuses[e.username];
      if (isWorsening(from, e.status)) worsened++;
      else if (isImproving(from, e.status)) improved++;
    }
    if (worsened === 0 && improved === 0) return null;
    const daysAgo = Math.max(1, Math.round((forecast.generated_at - prevSnapshot.ts) / 86400));
    return { worsened, improved, daysAgo };
  }, [forecast, prevSnapshot]);

  // 可见 tabs
  const tabs = useMemo(() => {
    const t: { id: TabId; label: string; count: number; hot: boolean }[] = [];
    if (forecastItems.length > 0) {
      t.push({
        id: 'forecast',
        label: '提醒',
        count: forecastItems.length,
        hot: forecastItems.some(i => i.status === 'endangered'),
      });
    }
    if (annivItems.length > 0) {
      t.push({ id: 'anniv', label: '纪念日', count: annivItems.length, hot: false });
    }
    if (digest) {
      t.push({ id: 'digest', label: '摘要', count: digest.worsened + digest.improved, hot: digest.worsened > 0 });
    }
    return t;
  }, [forecastItems, annivItems, digest]);

  // 当前 tab fallback
  const effectiveTab: TabId | null = useMemo(() => {
    if (tabs.length === 0) return null;
    if (tabs.find(t => t.id === activeTab)) return activeTab;
    return tabs[0].id;
  }, [tabs, activeTab]);

  const handleSelectTab = (id: TabId) => {
    setActiveTab(id);
    try { localStorage.setItem(ACTIVE_TAB_KEY, id); } catch { /* ignore */ }
  };

  const handleDismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, todayKey()); } catch { /* ignore */ }
  };

  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };

  const handleIgnoreForecast = async (username: string) => {
    try {
      const prefs = await fetch('/api/preferences').then(r => r.json()).catch(() => null);
      const current: string[] = Array.isArray(prefs?.forecast_ignored) ? prefs.forecast_ignored : [];
      const next = current.includes(username) ? current : [...current, username];
      await forecastApi.saveIgnored(next);
      setLocalIgnored(prev => new Set([...prev, username]));
    } catch { /* ignore */ }
  };

  const handleForecastClick = (e: ForecastEntry) => {
    const c = contacts.find(ct => ct.username === e.username);
    if (c && onContactClick) onContactClick(c);
  };

  const handleAnnivClick = (item: AnnivItem) => {
    if (item.kind === 'custom') { onNavigateToAnniversary?.(); return; }
    const c = contacts.find(ct => ct.username === item.username);
    if (c) onContactClick?.(c);
    else onNavigateToAnniversary?.();
  };

  if (dismissed || tabs.length === 0 || effectiveTab === null) return null;

  const totalCount = tabs.reduce((s, t) => s + t.count, 0);
  const hasHot = tabs.some(t => t.hot);

  // ── 折叠态：右侧小标签 ──────────────────────────────────────────────
  if (collapsed) {
    return (
      <button
        onClick={toggleCollapsed}
        title={`展开今日动态（${totalCount}）`}
        className={`hidden md:flex fixed right-0 top-24 z-30 flex-col items-center gap-1.5 px-2 py-3 rounded-l-xl border border-r-0 border-[#576b95]/20 dark:border-white/10 bg-gradient-to-b from-[#f5f7fb] to-[#fff7e6] dark:from-[#576b95]/15 dark:to-[#fa5151]/10 shadow-lg shadow-black/5 dark:shadow-black/30 hover:pr-3 transition-all duration-200 ease-out group ${
          mounted ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0'
        }`}
      >
        <Sparkles size={14} className="text-[#576b95]" />
        <span className={`text-[11px] font-black ${hasHot ? 'text-[#fa5151]' : 'text-[#576b95]'}`}>
          {totalCount}
        </span>
        <ChevronRight size={10} className="text-gray-400 rotate-180 group-hover:-translate-x-0.5 transition-transform" />
      </button>
    );
  }

  // ── 展开态 ──────────────────────────────────────────────────────────
  return (
    <div
      className={`hidden md:block fixed right-4 lg:right-6 top-20 z-30 w-[360px] max-w-[calc(100vw-2rem)] transition-all duration-300 ease-out ${
        mounted ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0'
      }`}
    >
      <div className="rounded-2xl border border-[#576b95]/20 dark:border-white/10 bg-gradient-to-br from-[#f5f7fb] to-[#fff7e6] dark:from-[#576b95]/15 dark:to-[#fa5151]/10 overflow-hidden shadow-xl shadow-black/5 dark:shadow-black/30">
        {/* Header */}
        <div className="px-3 pt-3 pb-0 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 min-w-0 overflow-x-auto">
            {tabs.map(t => {
              const active = t.id === effectiveTab;
              return (
                <button
                  key={t.id}
                  onClick={() => handleSelectTab(t.id)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap transition-colors ${
                    active
                      ? 'bg-white/80 dark:bg-white/15 text-[#1d1d1f] dk-text shadow-sm'
                      : 'text-gray-500 hover:text-[#1d1d1f] dark:hover:text-gray-200 hover:bg-white/40 dark:hover:bg-white/10'
                  }`}
                >
                  {t.label}
                  <span className={`inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full text-[10px] font-black ${
                    t.hot ? 'bg-[#fa5151]/15 text-[#fa5151]' : 'bg-[#576b95]/15 text-[#576b95]'
                  }`}>
                    {t.count}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button
              onClick={toggleCollapsed}
              title="收起到右侧"
              className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-white/60 dark:hover:bg-white/10 transition-colors"
            >
              <ChevronRight size={14} />
            </button>
            <button
              onClick={handleDismiss}
              title="今日不再提醒"
              className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-white/60 dark:hover:bg-white/10 transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="mt-1 max-h-[65vh] overflow-y-auto">
          {/* ─── 提醒 tab ─── */}
          {effectiveTab === 'forecast' && (
            <div className="px-2 pb-2 space-y-1">
              {forecastItems.map(item => {
                const badge = forecastBadge(item.status);
                const weeks = consecutiveCoolingWeeks(forecastHistory, item.username);
                return (
                  <div
                    key={item.username}
                    onClick={() => handleForecastClick(item)}
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer hover:bg-white/70 dark:hover:bg-white/10 transition-colors group"
                  >
                    {item.avatar_url ? (
                      <img
                        loading="lazy"
                        src={avatarSrc(item.avatar_url)}
                        alt=""
                        className="w-9 h-9 rounded-full object-cover flex-shrink-0"
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-white dark:bg-white/10 flex items-center justify-center flex-shrink-0 shadow-sm">
                        {forecastStatusIcon(item.status)}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-bold text-[#1d1d1f] dk-text truncate${privacyMode ? ' privacy-blur' : ''}`}>
                          {item.display_name}
                        </span>
                        <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${badge.cls}`}>
                          {badge.label}
                        </span>
                        {weeks >= 2 && (
                          <span
                            className="flex-shrink-0 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#fa5151]/10 text-[#fa5151]"
                            title={`连续 ${weeks} 周处于降温/濒危`}
                          >
                            <Clock size={10} />
                            {weeks} 周
                          </span>
                        )}
                      </div>
                      <div className={`text-xs text-gray-500 mt-0.5 truncate${privacyMode ? ' privacy-blur' : ''}`}>
                        {item.reason}
                      </div>
                      {item.suggestion && (
                        <button
                          onClick={e => { e.stopPropagation(); setIcebreakerFor(item); }}
                          className="flex items-center gap-1 text-[11px] text-[#576b95] mt-1 hover:text-[#3d5a8f] hover:underline underline-offset-2 transition-colors"
                        >
                          <Wand2 size={10} />
                          <span className="truncate">写开场白 · {item.suggestion}</span>
                        </button>
                      )}
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); handleIgnoreForecast(item.username); }}
                      title="不再推荐此人"
                      className="p-1.5 rounded-md text-gray-300 hover:text-gray-500 hover:bg-white/60 dark:hover:bg-white/10 transition-colors flex-shrink-0"
                    >
                      <EyeOff size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* ─── 纪念日 tab ─── */}
          {effectiveTab === 'anniv' && (
            <div className="px-2 pb-2 space-y-1">
              {annivItems.slice(0, 5).map((item, i) => {
                const interactive = item.kind !== 'custom' || !!onNavigateToAnniversary;
                return (
                  <div
                    key={i}
                    onClick={interactive ? () => handleAnnivClick(item) : undefined}
                    className={`flex items-center gap-3 px-3 py-2 rounded-xl ${interactive ? 'cursor-pointer hover:bg-white/70 dark:hover:bg-white/10' : ''} transition-colors`}
                  >
                    {item.kind !== 'custom' && item.avatar ? (
                      <img
                        loading="lazy"
                        src={avatarSrc(item.avatar)}
                        alt=""
                        className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-white dark:bg-white/10 flex items-center justify-center flex-shrink-0 shadow-sm">
                        {annivIcon(item.kind)}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-bold text-[#1d1d1f] dk-text truncate${privacyMode ? ' privacy-blur' : ''}`}>
                        {item.title}
                      </div>
                      <div className={`text-xs text-gray-500 mt-0.5 truncate${privacyMode ? ' privacy-blur' : ''}`}>
                        {item.subtitle}
                      </div>
                    </div>
                    <span className="flex-shrink-0">{annivIcon(item.kind)}</span>
                  </div>
                );
              })}
              {(annivItems.length > 5 || onNavigateToAnniversary) && (
                <button
                  onClick={() => onNavigateToAnniversary?.()}
                  className="w-full mt-1 px-3 py-2 rounded-lg text-xs font-bold text-[#07c160] hover:bg-white/40 dark:hover:bg-white/5 flex items-center justify-center gap-1.5 transition-colors"
                >
                  {annivItems.length > 5 ? `查看全部 ${annivItems.length} 个` : '前往纪念日页'}
                  <ArrowRight size={12} />
                </button>
              )}
            </div>
          )}

          {/* ─── 摘要 tab ─── */}
          {effectiveTab === 'digest' && digest && (
            <div className="px-4 pb-4 pt-2">
              <p className="text-[11px] text-gray-500 dk-text mb-2">近 {digest.daysAgo} 天关系变化</p>
              <div className="space-y-2">
                {digest.worsened > 0 && (
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[#fa5151]/8 dark:bg-[#fa5151]/15">
                    <TrendingDown size={16} className="text-[#fa5151] flex-shrink-0" />
                    <div className="text-sm">
                      <b className="text-[#fa5151]">{digest.worsened}</b>
                      <span className="text-gray-600 dk-text ml-1">位关系降温</span>
                    </div>
                  </div>
                )}
                {digest.improved > 0 && (
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[#07c160]/8 dark:bg-[#07c160]/15">
                    <TrendingUp size={16} className="text-[#07c160] flex-shrink-0" />
                    <div className="text-sm">
                      <b className="text-[#07c160]">{digest.improved}</b>
                      <span className="text-gray-600 dk-text ml-1">位回暖</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {icebreakerFor && (
        <IcebreakerModal
          username={icebreakerFor.username}
          fallbackDisplayName={icebreakerFor.display_name}
          reason={icebreakerFor.reason}
          onClose={() => setIcebreakerFor(null)}
        />
      )}
    </div>
  );
};
