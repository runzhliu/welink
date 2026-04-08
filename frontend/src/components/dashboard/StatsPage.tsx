/**
 * 洞察页 — 可拖拽自由排版
 */

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Users, MessageSquare, Flame, Snowflake, Edit3, Check, RotateCcw, Eye, EyeOff } from 'lucide-react';
import { Responsive, WidthProvider, type Layout, type LayoutItem, type ResponsiveLayouts } from 'react-grid-layout/legacy';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

import type { ContactStats, GlobalStats, HealthStatus } from '../../types';
import { KPICard } from './KPICard';
import { RelationshipHeatmap } from './RelationshipHeatmap';
import { MonthlyTrendChart } from './MonthlyTrendChart';
import { HourlyHeatmap } from './HourlyHeatmap';
import { LateNightRanking } from './LateNightRanking';
import SocialReport from './SocialReport';
import { DriftingApart } from './DriftingApart';
import { LateNightGuard } from './LateNightGuard';
import { SimilarityCard } from './SimilarityCard';
import { MoneyOverviewCard } from './MoneyOverviewCard';
import { RecallRanking } from './RecallRanking';
import { SelfPortraitCard } from './SelfPortraitCard';
import { SocialBreadthCard } from './SocialBreadthCard';
import { formatCompactNumber } from '../../utils/formatters';

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
  { id: 'kpi',              title: 'KPI 卡片',       defaultLg: { x: 0, y: 0,  w: 12, h: 5  }, defaultMd: { x: 0, y: 0,  w: 12, h: 5  } }, // 182px
  { id: 'heatmap',          title: '关系热度分布',   defaultLg: { x: 0, y: 5,  w: 12, h: 9  }, defaultMd: { x: 0, y: 5,  w: 12, h: 9  } }, // 334px
  { id: 'monthly',          title: '月度消息趋势',   defaultLg: { x: 0, y: 14, w: 6,  h: 10 }, defaultMd: { x: 0, y: 14, w: 12, h: 10 } }, // 372px
  { id: 'hourly',           title: '24 小时活跃度',  defaultLg: { x: 6, y: 14, w: 6,  h: 10 }, defaultMd: { x: 0, y: 24, w: 12, h: 10 } },
  { id: 'self',             title: '个人自画像',     defaultLg: { x: 0, y: 24, w: 6,  h: 12 }, defaultMd: { x: 0, y: 34, w: 12, h: 12 } }, // 448px
  { id: 'breadth',          title: '每日社交广度',   defaultLg: { x: 6, y: 24, w: 6,  h: 9  }, defaultMd: { x: 0, y: 46, w: 12, h: 9  } }, // 334px
  { id: 'social-report',    title: '社交体检报告',   defaultLg: { x: 0, y: 36, w: 6,  h: 11 }, defaultMd: { x: 0, y: 55, w: 12, h: 11 } }, // 410px
  { id: 'drifting',         title: '渐行渐远',       defaultLg: { x: 6, y: 36, w: 6,  h: 11 }, defaultMd: { x: 0, y: 66, w: 12, h: 11 } },
  { id: 'late-night-rank',  title: '深夜排行',       defaultLg: { x: 0, y: 47, w: 6,  h: 11 }, defaultMd: { x: 0, y: 77, w: 12, h: 11 } },
  { id: 'late-night-guard', title: '深夜守护',       defaultLg: { x: 6, y: 47, w: 6,  h: 11 }, defaultMd: { x: 0, y: 88, w: 12, h: 11 } },
  { id: 'similarity',       title: '谁最像谁',       defaultLg: { x: 0, y: 58, w: 6,  h: 12 }, defaultMd: { x: 0, y: 99, w: 12, h: 12 } },
  { id: 'money',            title: '红包/转账总览',  defaultLg: { x: 6, y: 58, w: 6,  h: 13 }, defaultMd: { x: 0, y: 111, w: 12, h: 13 } }, // 486px
  { id: 'recall',           title: '消息撤回排行',   defaultLg: { x: 0, y: 71, w: 12, h: 10 }, defaultMd: { x: 0, y: 124, w: 12, h: 10 } },
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
  const [layouts, setLayouts] = useState<Layouts>(() => {
    try {
      const saved = localStorage.getItem(LAYOUT_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Layouts;
        // 合并：补全新增的 card id
        const defaults = buildDefaultLayouts();
        const result: Layouts = { lg: [...(parsed.lg || [])], md: [...(parsed.md || [])] };
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
  };

  const resetLayout = () => {
    if (confirm('恢复默认布局？自定义的排版和显示设置都会丢失')) {
      const defaults = buildDefaultLayouts();
      setLayouts(defaults);
      setHiddenCards(new Set());
      localStorage.removeItem(LAYOUT_KEY);
      localStorage.removeItem(HIDDEN_KEY);
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
        return <SelfPortraitCard blockedDisplayNames={blockedDisplayNames} />;
      case 'breadth':
        return <SocialBreadthCard />;
      case 'social-report':
        return <SocialReport contacts={contacts} globalStats={globalStats} healthStatus={healthStatus} />;
      case 'drifting':
        return <DriftingApart contacts={contacts} onContactClick={onContactClick} />;
      case 'late-night-rank':
        return <LateNightRanking data={globalStats} contacts={contacts} onContactClick={onContactClick} />;
      case 'late-night-guard':
        return <LateNightGuard globalStats={globalStats} contacts={contacts} onContactClick={onContactClick} />;
      case 'similarity':
        return <SimilarityCard blockedUsers={blockedUsers} blockedDisplayNames={blockedDisplayNames} />;
      case 'money':
        return <MoneyOverviewCard blockedUsers={blockedUsers} blockedDisplayNames={blockedDisplayNames} />;
      case 'recall':
        return <RecallRanking contacts={contacts} onContactClick={onContactClick} />;
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
    // 按原顺序将卡片两两分组（w=12 的独占一行；w=6 的两个一行）
    const metaMap = new Map(CARD_METAS.map(c => [c.id, c]));
    const layoutItems = layouts.lg.filter(l => !hiddenCards.has(l.i));
    const sorted = [...layoutItems].sort((a, b) => a.y - b.y || a.x - b.x);

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
        // 尝试和下一个 w=6 的合并为一行
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

    return (
      <div className="space-y-4 sm:space-y-6">
        {rows.map((row, idx) => {
          if (row.full) {
            return (
              <div key={idx} className={row.full.id === 'kpi' ? '' : ''}>
                {renderCard(row.full.id)}
              </div>
            );
          }
          return (
            <div key={idx} className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
              {row.left && <div>{renderCard(row.left.id)}</div>}
              {row.right && <div>{renderCard(row.right.id)}</div>}
            </div>
          );
        })}
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
        <div className="flex items-center gap-2">
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

      {editMode && (
        <div className="mb-4 p-4 bg-white dk-card border border-gray-100 dk-border rounded-2xl">
          <div className="text-xs font-bold text-gray-500 mb-2">显示 / 隐藏卡片</div>
          <div className="flex flex-wrap gap-2">
            {CARD_METAS.map(c => {
              const hidden = hiddenCards.has(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => toggleHidden(c.id)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                    hidden
                      ? 'bg-gray-100 dark:bg-white/5 text-gray-400 line-through'
                      : 'bg-[#07c160]/10 text-[#07c160]'
                  }`}
                >
                  {hidden ? <EyeOff size={11} /> : <Eye size={11} />}
                  {c.title}
                </button>
              );
            })}
          </div>
        </div>
      )}

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
    </div>
  );
};
