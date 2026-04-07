/**
 * 数据概览页 — KPI + 图表 + 关系热力图 + 联系人表格
 */

import React, { useMemo, useState, useCallback } from 'react';
import { Users, MessageSquare, Flame, Snowflake, Search, GitCompareArrows, X } from 'lucide-react';
import type { ContactStats, GlobalStats, HealthStatus } from '../../types';
import { KPICard } from './KPICard';
import { RelationshipHeatmap } from './RelationshipHeatmap';
import { MonthlyTrendChart } from './MonthlyTrendChart';
import { HourlyHeatmap } from './HourlyHeatmap';
import { LateNightRanking } from './LateNightRanking';
import { ContactTable } from './ContactTable';
import SocialReport from './SocialReport';
import { DriftingApart } from './DriftingApart';
import { LateNightGuard } from './LateNightGuard';
import { ComparePanel } from './ComparePanel';
import { SimilarityCard } from './SimilarityCard';
import { formatCompactNumber } from '../../utils/formatters';

interface StatsPageProps {
  contacts: ContactStats[];
  filteredContacts: ContactStats[];
  globalStats: GlobalStats | null;
  healthStatus: HealthStatus;
  statsLoading: boolean;
  search: string;
  onSearchChange: (v: string) => void;
  onContactClick: (c: ContactStats) => void;
}

export const StatsPage: React.FC<StatsPageProps> = ({
  contacts,
  filteredContacts,
  globalStats,
  healthStatus,
  statsLoading,
  search,
  onSearchChange,
  onContactClick,
}) => {
  const [compareMode, setCompareMode] = useState(false);
  const [compareSelected, setCompareSelected] = useState<Set<string>>(new Set());
  const [showCompare, setShowCompare] = useState(false);

  const handleCompareToggle = useCallback((username: string) => {
    setCompareSelected(prev => {
      const next = new Set(prev);
      if (next.has(username)) {
        next.delete(username);
      } else if (next.size < 6) {
        next.add(username);
      }
      return next;
    });
  }, []);

  const exitCompareMode = useCallback(() => {
    setCompareMode(false);
    setCompareSelected(new Set());
  }, []);

  const compareContacts = useMemo(() =>
    contacts.filter(c => compareSelected.has(c.username)),
    [contacts, compareSelected]
  );

  const kpis = useMemo(() => [
    { title: '总好友数',  value: globalStats?.total_friends || 0,                           subtitle: 'Total Friends',  icon: Users,         color: 'green'  as const },
    { title: '总消息量',  value: formatCompactNumber(globalStats?.total_messages || 0),     subtitle: 'Total Messages', icon: MessageSquare, color: 'blue'   as const },
    { title: '活跃好友',  value: healthStatus.hot,                                          subtitle: '7 天内有消息',    icon: Flame,         color: 'orange' as const },
    { title: '零消息',    value: healthStatus.cold,                                         subtitle: '从未聊天',        icon: Snowflake,     color: 'purple' as const },
  ], [globalStats, healthStatus]);

  return (
    <div>
      <div className="mb-6 sm:mb-8">
        <h2 className="text-2xl font-black text-[#1d1d1f] dk-text mb-1">数据概览</h2>
        <p className="text-sm text-gray-400">聊天记录统计分析</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6 mb-6 sm:mb-8">
        {kpis.map(k => (
          <KPICard key={k.title} title={k.title} value={k.value} subtitle={k.subtitle} icon={k.icon} color={k.color} />
        ))}
      </div>

      {/* Relationship Heatmap */}
      <div className="mb-6 sm:mb-8">
        <RelationshipHeatmap
          health={healthStatus}
          totalContacts={contacts.length}
          contacts={contacts}
          onContactClick={onContactClick}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-8 mb-6 sm:mb-8">
        <MonthlyTrendChart data={globalStats} />
        <HourlyHeatmap data={globalStats} />
      </div>

      {/* Social Report + Drifting Apart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-8 mb-6 sm:mb-8">
        <SocialReport contacts={contacts} globalStats={globalStats} healthStatus={healthStatus} />
        <DriftingApart contacts={contacts} onContactClick={onContactClick} />
      </div>

      {/* Late Night Ranking + Late Night Guard */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-8 mb-6 sm:mb-8">
        <LateNightRanking data={globalStats} contacts={contacts} onContactClick={onContactClick} />
        <LateNightGuard globalStats={globalStats} contacts={contacts} onContactClick={onContactClick} />
      </div>

      {/* 谁最像谁 */}
      <div className="mb-6 sm:mb-8">
        <SimilarityCard />
      </div>

      {/* Contact Table */}
      <div className="mb-8">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-black text-[#1d1d1f] dk-text">
              联系人列表
              <span className="text-gray-400 text-lg ml-3 font-semibold">{filteredContacts.length} 位</span>
            </h2>
            <button
              onClick={() => compareMode ? exitCompareMode() : setCompareMode(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                compareMode
                  ? 'bg-[#07c160] text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-[#e7f8f0] hover:text-[#07c160]'
              }`}
            >
              <GitCompareArrows size={14} />
              {compareMode ? '退出对比' : '对比模式'}
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              placeholder="搜索联系人..."
              value={search}
              onChange={e => onSearchChange(e.target.value)}
              className="pl-9 pr-4 py-2 w-36 sm:w-56 bg-white dk-input border border-gray-200 dk-border rounded-xl text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#07c160]/20 focus:border-[#07c160] transition-all"
            />
          </div>
        </div>
        {statsLoading && contacts.length === 0 ? (
          <div className="bg-white dk-card rounded-3xl border border-gray-100 dk-border p-20 text-center">
            <div className="text-gray-300 font-bold text-lg animate-pulse">加载中...</div>
          </div>
        ) : (
          <ContactTable
            contacts={filteredContacts}
            onContactClick={onContactClick}
            compareMode={compareMode}
            compareSelected={compareSelected}
            onCompareToggle={handleCompareToggle}
          />
        )}
      </div>

      {/* Compare floating bar */}
      {compareMode && compareSelected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40
          bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700
          shadow-2xl rounded-2xl px-5 py-3 flex items-center gap-4 animate-in slide-in-from-bottom duration-200">
          <span className="text-sm font-bold dk-text">
            已选 <span className="text-[#07c160]">{compareSelected.size}</span> 人
            <span className="text-gray-400 font-normal ml-1">（最多 6 人）</span>
          </span>
          <button
            onClick={() => { if (compareSelected.size >= 2) setShowCompare(true); }}
            disabled={compareSelected.size < 2}
            className="px-4 py-2 bg-[#07c160] text-white rounded-xl text-sm font-bold
              disabled:opacity-40 hover:bg-[#06ad56] transition-colors"
          >
            开始对比
          </button>
          <button onClick={exitCompareMode} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X size={18} />
          </button>
        </div>
      )}

      {/* Compare panel */}
      {showCompare && compareContacts.length >= 2 && (
        <ComparePanel
          contacts={compareContacts}
          onClose={() => setShowCompare(false)}
        />
      )}
    </div>
  );
};
