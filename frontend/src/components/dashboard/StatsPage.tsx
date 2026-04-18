/**
 * 洞察页 — 可拖拽自由排版
 */

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Users, MessageSquare, Flame, Snowflake, Edit3, Check, RotateCcw, Eye, EyeOff, Rewind } from 'lucide-react';
import { YearInReview } from './YearInReview';
import { Responsive, WidthProvider, type Layout, type LayoutItem, type ResponsiveLayouts } from 'react-grid-layout/legacy';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

import type { ContactStats, GlobalStats, HealthStatus } from '../../types';
import { KPICard } from './KPICard';
import { RelationshipHeatmap } from './RelationshipHeatmap';
import { MonthlyTrendChart } from './MonthlyTrendChart';
import { HourlyHeatmap } from './HourlyHeatmap';
import SocialReport from './SocialReport';
import { DriftingApart } from './DriftingApart';
import { LateNightGuard } from './LateNightGuard';
import { SimilarityCard } from './SimilarityCard';
import { MoneyOverviewCard } from './MoneyOverviewCard';
import { RecallRanking } from './RecallRanking';
import { SelfPortraitCard } from './SelfPortraitCard';
import { SocialBreadthCard } from './SocialBreadthCard';
import { formatCompactNumber } from '../../utils/formatters';
import {
  CharCountCard, BusiestDayCard, InteractionTierCard, CompanionTimeCard,
  FirstEncountersCard, EmojiDensityCard, MonologueCard, WordAlmanacCard, InsomniaTopCard,
} from './FunStatsPage';
import { RelationshipForecastSection } from './RelationshipForecastSection';

type Layouts = { lg: LayoutItem[]; md: LayoutItem[] };
const ResponsiveGridLayout = WidthProvider(Responsive);

interface StatsPageProps {
  contacts: ContactStats[];
  globalStats: GlobalStats | null;
  healthStatus: HealthStatus;
  onContactClick: (c: ContactStats) => void;
  blockedUsers: string[];
  blockedDisplayNames: Set<string>;
}

const LAYOUT_KEY = 'welink_stats_layout_v3';
const HIDDEN_KEY = 'welink_stats_hidden_v1';
const VIEW_KEY = 'welink_stats_view_v1';
const FUN_COLLAPSED_KEY = 'welink_stats_fun_collapsed_v1';

// 视图预设：切换后自动算 hidden 集合
type ViewPreset = 'full' | 'core' | 'compact' | 'fun' | 'custom';

// 精简视图保留的 6 张代表性卡片
const COMPACT_KEEP: Set<string> = new Set([
  'kpi', 'heatmap', 'monthly', 'self', 'drifting', 'recall',
]);

const computeHiddenForPreset = (preset: ViewPreset, allIds: string[], customHidden: Set<string>): Set<string> => {
  switch (preset) {
    case 'full':
      return new Set(); // 全开
    case 'core':
      // 隐藏所有 fun-* 卡片
      return new Set(allIds.filter(id => id.startsWith('fun-')));
    case 'compact':
      // 只保留 COMPACT_KEEP 里的卡，其他全隐藏（包括 section）
      return new Set(allIds.filter(id => !COMPACT_KEEP.has(id)));
    case 'fun':
      // 只保留 fun-* 卡，其他全隐藏
      return new Set(allIds.filter(id => !id.startsWith('fun-')));
    case 'custom':
    default:
      return customHidden;
  }
};

// 每个卡片定义 + 默认布局（12 列栅格）
interface CardMeta {
  id: string;
  title: string;
  defaultLg: { x: number; y: number; w: number; h: number };
  defaultMd: { x: number; y: number; w: number; h: number };
}

// 一个 h 单位 = rowHeight(30) + margin[1](8) = 38px
// 实际高度 = h * 30 + (h-1) * 8
const CARD_METAS: CardMeta[] = [
  { id: 'kpi',              title: 'KPI 卡片',       defaultLg: { x: 0, y: 0,  w: 12, h: 5  }, defaultMd: { x: 0, y: 0,  w: 12, h: 5  } },
  { id: 'heatmap',          title: '关系热度分布',   defaultLg: { x: 0, y: 5,  w: 12, h: 9  }, defaultMd: { x: 0, y: 5,  w: 12, h: 9  } },
  { id: 'monthly',          title: '月度消息趋势',   defaultLg: { x: 0, y: 14, w: 6,  h: 10 }, defaultMd: { x: 0, y: 14, w: 12, h: 10 } },
  { id: 'hourly',           title: '24 小时活跃度',  defaultLg: { x: 6, y: 14, w: 6,  h: 10 }, defaultMd: { x: 0, y: 24, w: 12, h: 10 } },
  { id: 'self',             title: '个人自画像',     defaultLg: { x: 0, y: 24, w: 6,  h: 12 }, defaultMd: { x: 0, y: 34, w: 12, h: 12 } },
  { id: 'breadth',          title: '每日社交广度',   defaultLg: { x: 6, y: 24, w: 6,  h: 9  }, defaultMd: { x: 0, y: 46, w: 12, h: 9  } },
  { id: 'social-report',    title: '社交体检报告',   defaultLg: { x: 0, y: 36, w: 6,  h: 11 }, defaultMd: { x: 0, y: 55, w: 12, h: 11 } },
  { id: 'drifting',         title: '渐行渐远',       defaultLg: { x: 6, y: 36, w: 6,  h: 11 }, defaultMd: { x: 0, y: 66, w: 12, h: 11 } },
  { id: 'late-night-guard', title: '深夜守护',       defaultLg: { x: 0, y: 47, w: 12, h: 11 }, defaultMd: { x: 0, y: 77, w: 12, h: 11 } },
  { id: 'similarity',       title: '谁最像谁',       defaultLg: { x: 0, y: 58, w: 6,  h: 12 }, defaultMd: { x: 0, y: 88, w: 12, h: 12 } },
  { id: 'money',            title: '红包/转账总览',  defaultLg: { x: 6, y: 58, w: 6,  h: 13 }, defaultMd: { x: 0, y: 111, w: 12, h: 13 } },
  { id: 'recall',           title: '消息撤回排行',   defaultLg: { x: 0, y: 71, w: 12, h: 10 }, defaultMd: { x: 0, y: 124, w: 12, h: 10 } },
  // ── 以下为从旧「有趣发现」section 拍平进来的卡片，默认与其它卡并列参与拖拽/隐藏 ──
  { id: 'fun-charcount',      title: '你打过多少字',     defaultLg: { x: 0, y: 81, w: 6,  h: 8  }, defaultMd: { x: 0, y: 134, w: 12, h: 8  } },
  { id: 'fun-busiestday',     title: '最话痨的一天',     defaultLg: { x: 6, y: 81, w: 6,  h: 12 }, defaultMd: { x: 0, y: 142, w: 12, h: 12 } },
  { id: 'fun-interactiontier',title: '互动档位',         defaultLg: { x: 0, y: 89, w: 6,  h: 10 }, defaultMd: { x: 0, y: 154, w: 12, h: 10 } },
  { id: 'fun-companiontime',  title: '微信陪伴时长',     defaultLg: { x: 0, y: 99, w: 6,  h: 12 }, defaultMd: { x: 0, y: 164, w: 12, h: 12 } },
  { id: 'fun-firstencounters',title: '首次相遇时间胶囊', defaultLg: { x: 6, y: 93, w: 6,  h: 14 }, defaultMd: { x: 0, y: 176, w: 12, h: 14 } },
  { id: 'fun-emojidensity',   title: '表情包浓度',       defaultLg: { x: 0, y: 111,w: 6,  h: 11 }, defaultMd: { x: 0, y: 190, w: 12, h: 11 } },
  { id: 'fun-monologue',      title: '独白指数',         defaultLg: { x: 6, y: 107,w: 6,  h: 12 }, defaultMd: { x: 0, y: 201, w: 12, h: 12 } },
  { id: 'fun-insomniatop',    title: '失眠陪聊榜',       defaultLg: { x: 0, y: 122,w: 6,  h: 11 }, defaultMd: { x: 0, y: 213, w: 12, h: 11 } },
  { id: 'fun-wordalmanac',    title: '词语年鉴',         defaultLg: { x: 6, y: 119,w: 6,  h: 13 }, defaultMd: { x: 0, y: 224, w: 12, h: 13 } },
];

function buildDefaultLayouts(): Layouts {
  return {
    lg: CARD_METAS.map(c => ({ i: c.id, ...c.defaultLg, minW: 3, minH: 4 })),
    md: CARD_METAS.map(c => ({ i: c.id, ...c.defaultMd, minW: 3, minH: 4 })),
  };
}

export const StatsPage: React.FC<StatsPageProps> = ({
  contacts,
  globalStats,
  healthStatus,
  onContactClick,
  blockedUsers,
  blockedDisplayNames,
}) => {
  const [editMode, setEditMode] = useState(false);
  const [showYearReview, setShowYearReview] = useState(false);
  const [layouts, setLayouts] = useState<Layouts>(() => {
    try {
      const saved = localStorage.getItem(LAYOUT_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Layouts;
        // 合并：补全新增的 card id + 清掉已被删除的卡片（旧版 late-night-rank 等）
        const defaults = buildDefaultLayouts();
        const validIds = new Set(defaults.lg.map(l => l.i));
        const result: Layouts = {
          lg: (parsed.lg || []).filter(l => validIds.has(l.i)),
          md: (parsed.md || []).filter(l => validIds.has(l.i)),
        };
        for (const bp of ['lg', 'md'] as const) {
          const savedIds = new Set(result[bp].map(l => l.i));
          const missing = defaults[bp].filter(l => !savedIds.has(l.i));
          result[bp] = [...result[bp], ...missing];
        }
        return result;
      }
    } catch {/* ignore */}
    return buildDefaultLayouts();
  });

  const [hiddenCards, setHiddenCards] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(HIDDEN_KEY);
      if (saved) return new Set(JSON.parse(saved));
    } catch {/* ignore */}
    return new Set();
  });

  // 当前视图预设：custom = 用户手动编辑过的状态
  const [viewPreset, setViewPreset] = useState<ViewPreset>(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY) as ViewPreset | null;
      if (v && ['full', 'core', 'compact', 'fun', 'custom'].includes(v)) return v;
    } catch {/* ignore */}
    return 'custom';
  });

  // 非编辑模式下趣味派生组是否折叠
  const [funCollapsed, setFunCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(FUN_COLLAPSED_KEY) === '1'; } catch { return false; }
  });

  const toggleFunCollapsed = () => {
    setFunCollapsed(v => {
      const next = !v;
      try { localStorage.setItem(FUN_COLLAPSED_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };

  const applyViewPreset = (preset: ViewPreset) => {
    setViewPreset(preset);
    try { localStorage.setItem(VIEW_KEY, preset); } catch { /* ignore */ }
    if (preset === 'custom') return; // custom 保持当前 hiddenCards
    const allIds = [...CARD_METAS.map(c => c.id), 'section-forecast'];
    const next = computeHiddenForPreset(preset, allIds, hiddenCards);
    setHiddenCards(next);
    try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(Array.from(next))); } catch { /* ignore */ }
  };

  // 批量隐藏/显示一组
  const setGroupHidden = (ids: string[], hide: boolean) => {
    setHiddenCards(prev => {
      const next = new Set(prev);
      for (const id of ids) {
        if (hide) next.add(id);
        else next.delete(id);
      }
      try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(Array.from(next))); } catch { /* ignore */ }
      return next;
    });
    setViewPreset('custom');
    try { localStorage.setItem(VIEW_KEY, 'custom'); } catch { /* ignore */ }
  };

  const saveTimer = useRef<number | null>(null);
  const handleLayoutChange = (_: Layout, allLayouts: ResponsiveLayouts) => {
    const next: Layouts = {
      lg: [...(allLayouts.lg ?? [])],
      md: [...(allLayouts.md ?? [])],
    };
    setLayouts(next);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
    }, 300);
  };

  const toggleHidden = (id: string) => {
    setHiddenCards(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(Array.from(next)));
      return next;
    });
    // 手动 toggle 自动切到 custom 视图
    setViewPreset('custom');
    try { localStorage.setItem(VIEW_KEY, 'custom'); } catch { /* ignore */ }
  };

  const resetLayout = () => {
    if (confirm('恢复默认布局？自定义的排版和显示设置都会丢失')) {
      const defaults = buildDefaultLayouts();
      setLayouts(defaults);
      setHiddenCards(new Set());
      setViewPreset('full');
      setFunCollapsed(false);
      localStorage.removeItem(LAYOUT_KEY);
      localStorage.removeItem(HIDDEN_KEY);
      localStorage.removeItem(VIEW_KEY);
      localStorage.removeItem(FUN_COLLAPSED_KEY);
    }
  };

  useEffect(() => {
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, []);

  const kpis = useMemo(() => [
    { title: '总好友数',  value: globalStats?.total_friends || 0,                           subtitle: 'Total Friends',  icon: Users,         color: 'green'  as const },
    { title: '总消息量',  value: formatCompactNumber(globalStats?.total_messages || 0),     subtitle: 'Total Messages', icon: MessageSquare, color: 'blue'   as const },
    { title: '活跃好友',  value: healthStatus.hot,                                          subtitle: '7 天内有消息',    icon: Flame,         color: 'orange' as const },
    { title: '零消息',    value: healthStatus.cold,                                         subtitle: '从未聊天',        icon: Snowflake,     color: 'purple' as const },
  ], [globalStats, healthStatus]);

  const renderCard = (id: string) => {
    switch (id) {
      case 'kpi':
        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 h-full">
            {kpis.map(k => (
              <KPICard key={k.title} title={k.title} value={k.value} subtitle={k.subtitle} icon={k.icon} color={k.color} />
            ))}
          </div>
        );
      case 'heatmap':
        return <RelationshipHeatmap health={healthStatus} totalContacts={contacts.length} contacts={contacts} onContactClick={onContactClick} />;
      case 'monthly':
        return <MonthlyTrendChart data={globalStats} />;
      case 'hourly':
        return <HourlyHeatmap data={globalStats} />;
      case 'self':
        return <SelfPortraitCard blockedDisplayNames={blockedDisplayNames} contacts={contacts} globalStats={globalStats} />;
      case 'breadth':
        return <SocialBreadthCard />;
      case 'social-report':
        return <SocialReport contacts={contacts} globalStats={globalStats} healthStatus={healthStatus} />;
      case 'drifting':
        return <DriftingApart contacts={contacts} onContactClick={onContactClick} />;
      case 'late-night-guard':
        return <LateNightGuard globalStats={globalStats} contacts={contacts} onContactClick={onContactClick} />;
      case 'similarity':
        return <SimilarityCard blockedUsers={blockedUsers} blockedDisplayNames={blockedDisplayNames} onContactClick={u => { const c = contacts.find(cc => cc.username === u); if (c) onContactClick(c); }} />;
      case 'money':
        return <MoneyOverviewCard blockedUsers={blockedUsers} blockedDisplayNames={blockedDisplayNames} onContactClick={u => { const c = contacts.find(cc => cc.username === u); if (c) onContactClick(c); }} />;
      case 'recall':
        return <RecallRanking contacts={contacts} onContactClick={onContactClick} />;
      case 'fun-charcount':
        return <CharCountCard contacts={contacts} />;
      case 'fun-busiestday':
        return <BusiestDayCard />;
      case 'fun-interactiontier':
        return <InteractionTierCard contacts={contacts} />;
      case 'fun-companiontime':
        return <CompanionTimeCard contacts={contacts} onContactClick={onContactClick} />;
      case 'fun-firstencounters':
        return <FirstEncountersCard contacts={contacts} onContactClick={onContactClick} />;
      case 'fun-emojidensity':
        return <EmojiDensityCard contacts={contacts} onContactClick={onContactClick} />;
      case 'fun-monologue':
        return <MonologueCard contacts={contacts} onContactClick={onContactClick} />;
      case 'fun-insomniatop':
        return <InsomniaTopCard contacts={contacts} onContactClick={onContactClick} />;
      case 'fun-wordalmanac':
        return <WordAlmanacCard />;
      default:
        return null;
    }
  };

  // 过滤布局：隐藏的卡片不渲染到 grid 中
  const visibleLayouts = useMemo<ResponsiveLayouts>(() => {
    return {
      lg: layouts.lg.filter(l => !hiddenCards.has(l.i)),
      md: layouts.md.filter(l => !hiddenCards.has(l.i)),
    };
  }, [layouts, hiddenCards]);

  // 按保存的布局顺序返回可见卡片（用于经典视图）
  const visibleCardsInOrder = useMemo<CardMeta[]>(() => {
    const metaMap = new Map(CARD_METAS.map(c => [c.id, c]));
    const lg = layouts.lg.filter(l => !hiddenCards.has(l.i));
    // 按 y 升序、y 相同按 x 升序
    const sorted = [...lg].sort((a, b) => a.y - b.y || a.x - b.x);
    const result: CardMeta[] = [];
    for (const l of sorted) {
      const m = metaMap.get(l.i);
      if (m) result.push(m);
    }
    return result;
  }, [layouts, hiddenCards]);

  // 经典视图：按两两分组的 full/half 布局渲染，保持原先的经典排版
  const renderClassicLayout = () => {
    const metaMap = new Map(CARD_METAS.map(c => [c.id, c]));
    const layoutItems = layouts.lg.filter(l => !hiddenCards.has(l.i));

    // 拆两组分别分行：核心 + 趣味
    const coreItems = layoutItems.filter(l => !l.i.startsWith('fun-'));
    const funItems = layoutItems.filter(l => l.i.startsWith('fun-'));

    const buildRows = (items: LayoutItem[]): Array<{ full?: CardMeta; left?: CardMeta; right?: CardMeta }> => {
      const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
      const rows: Array<{ full?: CardMeta; left?: CardMeta; right?: CardMeta }> = [];
      let i = 0;
      while (i < sorted.length) {
        const cur = sorted[i];
        const meta = metaMap.get(cur.i);
        if (!meta) { i++; continue; }
        if (cur.w >= 12) {
          rows.push({ full: meta });
          i++;
        } else {
          const next = sorted[i + 1];
          const nextMeta = next ? metaMap.get(next.i) : undefined;
          if (next && nextMeta && next.w < 12) {
            rows.push({ left: meta, right: nextMeta });
            i += 2;
          } else {
            rows.push({ full: meta });
            i++;
          }
        }
      }
      return rows;
    };

    const renderRows = (rows: Array<{ full?: CardMeta; left?: CardMeta; right?: CardMeta }>) =>
      rows.map((row, idx) => {
        if (row.full) return <div key={idx}>{renderCard(row.full.id)}</div>;
        return (
          <div key={idx} className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            {row.left && <div>{renderCard(row.left.id)}</div>}
            {row.right && <div>{renderCard(row.right.id)}</div>}
          </div>
        );
      });

    const coreRows = buildRows(coreItems);
    const funRows = buildRows(funItems);

    return (
      <div className="space-y-4 sm:space-y-6">
        {renderRows(coreRows)}
        {/* 趣味派生折叠按钮：只在有可见 fun 卡且非编辑模式时出现 */}
        {funItems.length > 0 && (
          <button
            onClick={toggleFunCollapsed}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-dashed border-[#ff9500]/30 bg-[#fff9e6] dark:bg-[#ff9500]/10 text-xs font-bold text-[#ff9500] hover:bg-[#fff3cc] dark:hover:bg-[#ff9500]/15 transition-colors"
          >
            {funCollapsed ? <Eye size={14} /> : <EyeOff size={14} />}
            {funCollapsed
              ? `趣味派生 · ${funItems.length} 张卡已收起 · 点击展开`
              : `趣味派生 · ${funItems.length} 张卡 · 点击收起`}
          </button>
        )}
        {!funCollapsed && renderRows(funRows)}
      </div>
    );
  };

  return (
    <div>
      <div className="mb-6 sm:mb-8 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black text-[#1d1d1f] dk-text mb-1">洞察</h2>
          <p className="text-sm text-gray-400">
            {editMode ? '拖拽卡片移动，右下角拖拽调整大小' : '聊天记录统计与分析'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* 视图预设 */}
          <div className="flex items-center gap-1 bg-gray-100 dark:bg-white/5 rounded-full p-0.5">
            {([
              ['full', '完整'],
              ['core', '仅核心'],
              ['compact', '精简'],
              ['fun', '仅趣味'],
              ['custom', '自定义'],
            ] as [ViewPreset, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => applyViewPreset(key)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${
                  viewPreset === key
                    ? 'bg-white dark:bg-[#1d1d1f] text-[#07c160] shadow-sm'
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowYearReview(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-[#07c160] text-white hover:bg-[#06ad56] hover:shadow-md transition-all"
          >
            <Rewind size={13} />
            年度回顾
          </button>
          {editMode && (
            <button
              onClick={resetLayout}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 transition-all"
            >
              <RotateCcw size={13} />
              恢复默认
            </button>
          )}
          <button
            onClick={() => setEditMode(!editMode)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
              editMode ? 'bg-[#07c160] text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-[#e7f8f0] hover:text-[#07c160]'
            }`}
          >
            {editMode ? <Check size={13} /> : <Edit3 size={13} />}
            {editMode ? '完成' : '编辑布局'}
          </button>
        </div>
      </div>

      {editMode && (() => {
        const coreIds = CARD_METAS.filter(c => !c.id.startsWith('fun-')).map(c => c.id);
        const funIds = CARD_METAS.filter(c => c.id.startsWith('fun-')).map(c => c.id);
        const allCoreHidden = coreIds.every(id => hiddenCards.has(id));
        const allFunHidden = funIds.every(id => hiddenCards.has(id));
        const renderGroup = (title: string, ids: string[], metas: { id: string; title: string }[], colorCls: { hidden: string; visible: string }, allHidden: boolean) => (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="text-xs font-bold text-gray-500">{title}</div>
              <button
                onClick={() => setGroupHidden(ids, !allHidden)}
                className="text-[10px] font-bold text-gray-400 hover:text-[#07c160] underline-offset-2 hover:underline transition-colors"
              >
                {allHidden ? '全部显示' : '全部隐藏'}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {metas.map(c => {
                const hidden = hiddenCards.has(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() => toggleHidden(c.id)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${hidden ? `${colorCls.hidden} line-through` : colorCls.visible}`}
                  >
                    {hidden ? <EyeOff size={11} /> : <Eye size={11} />}
                    {c.title}
                  </button>
                );
              })}
            </div>
          </div>
        );
        return (
          <div className="mb-4 p-4 bg-white dk-card border border-gray-100 dk-border rounded-2xl space-y-3">
            {renderGroup(
              '核心卡片',
              coreIds,
              CARD_METAS.filter(c => !c.id.startsWith('fun-')),
              { hidden: 'bg-gray-100 dark:bg-white/5 text-gray-400', visible: 'bg-[#07c160]/10 text-[#07c160]' },
              allCoreHidden,
            )}
            {renderGroup(
              '趣味派生',
              funIds,
              CARD_METAS.filter(c => c.id.startsWith('fun-')),
              { hidden: 'bg-gray-100 dark:bg-white/5 text-gray-400', visible: 'bg-[#ff9500]/10 text-[#ff9500]' },
              allFunHidden,
            )}
            {renderGroup(
              '独立版块',
              ['section-forecast'],
              [{ id: 'section-forecast', title: '关系动态预测' }],
              { hidden: 'bg-gray-100 dark:bg-white/5 text-gray-400', visible: 'bg-[#576b95]/10 text-[#576b95]' },
              hiddenCards.has('section-forecast'),
            )}
          </div>
        );
      })()}

      {editMode ? (
        <ResponsiveGridLayout
          className="layout edit-mode"
          layouts={visibleLayouts}
          breakpoints={{ lg: 1024, md: 640, sm: 0 }}
          cols={{ lg: 12, md: 12, sm: 12 }}
          rowHeight={30}
          margin={[8, 8]}
          containerPadding={[0, 0]}
          isDraggable={true}
          isResizable={true}
          onLayoutChange={handleLayoutChange}
          draggableCancel=".no-drag"
        >
          {visibleCardsInOrder.map(c => (
            <div key={c.id} className="stats-card-wrapper edit-border">
              <div className="absolute top-2 left-2 z-10 bg-[#07c160] text-white text-[10px] font-bold px-2 py-0.5 rounded-full pointer-events-none">
                {c.title}
              </div>
              <div className="h-full overflow-auto">
                {renderCard(c.id)}
              </div>
            </div>
          ))}
        </ResponsiveGridLayout>
      ) : (
        renderClassicLayout()
      )}

      <style>{`
        .layout.edit-mode .react-grid-item {
          border: 2px dashed #07c16040;
          border-radius: 1.5rem;
          transition: border-color 0.15s;
        }
        .layout.edit-mode .react-grid-item:hover {
          border-color: #07c160;
        }
        .stats-card-wrapper {
          position: relative;
        }
        .react-grid-item.react-grid-placeholder {
          background: #07c16030 !important;
          border-radius: 1.5rem;
        }
        .react-grid-item > .react-resizable-handle {
          background-image: none;
        }
        .react-grid-item > .react-resizable-handle::after {
          content: '';
          display: ${editMode ? 'block' : 'none'};
          position: absolute;
          right: 6px;
          bottom: 6px;
          width: 10px;
          height: 10px;
          border-right: 2px solid #07c160;
          border-bottom: 2px solid #07c160;
          border-bottom-right-radius: 2px;
        }
      `}</style>

      {showYearReview && (
        <YearInReview
          contacts={contacts}
          globalStats={globalStats}
          onClose={() => setShowYearReview(false)}
        />
      )}

      {/* ── 关系动态预测（不在 grid 里，整段 show/hide） ── */}
      {!hiddenCards.has('section-forecast') && (
        <div className="mt-10">
          <RelationshipForecastSection contacts={contacts} onContactClick={onContactClick} />
        </div>
      )}
    </div>
  );
};
