/**
 * 数据概览页 — KPI + 图表 + 关系热力图 + 联系人表格
 */

import React, { useMemo } from 'react';
import { Users, MessageSquare, Flame, Snowflake, Search } from 'lucide-react';
import type { ContactStats, GlobalStats, HealthStatus } from '../../types';
import { KPICard } from './KPICard';
import { RelationshipHeatmap } from './RelationshipHeatmap';
import { MonthlyTrendChart } from './MonthlyTrendChart';
import { HourlyHeatmap } from './HourlyHeatmap';
import { LateNightRanking } from './LateNightRanking';
import { ContactTable } from './ContactTable';
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
  const kpis = useMemo(() => [
    { title: '总好友数',  value: globalStats?.total_friends || 0,                           subtitle: 'Total Friends',  icon: Users,         color: 'green'  as const },
    { title: '总消息量',  value: formatCompactNumber(globalStats?.total_messages || 0),     subtitle: 'Total Messages', icon: MessageSquare, color: 'blue'   as const },
    { title: '活跃好友',  value: healthStatus.hot,                                          subtitle: '7 天内有消息',    icon: Flame,         color: 'orange' as const },
    { title: '零消息',    value: healthStatus.cold,                                         subtitle: '从未聊天',        icon: Snowflake,     color: 'purple' as const },
  ], [globalStats, healthStatus]);

  return (
    <div>
      <div className="mb-6 sm:mb-8">
        <h2 className="text-2xl font-black text-[#1d1d1f] mb-1">数据概览</h2>
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

      {/* Late Night Ranking */}
      <div className="mb-6 sm:mb-8">
        <LateNightRanking data={globalStats} contacts={contacts} onContactClick={onContactClick} />
      </div>

      {/* Contact Table */}
      <div className="mb-8">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <h2 className="text-2xl font-black text-[#1d1d1f]">
            联系人列表
            <span className="text-gray-400 text-lg ml-3 font-semibold">{filteredContacts.length} 位</span>
          </h2>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              placeholder="搜索联系人..."
              value={search}
              onChange={e => onSearchChange(e.target.value)}
              className="pl-9 pr-4 py-2 w-36 sm:w-56 bg-white border border-gray-200 rounded-xl text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#07c160]/20 focus:border-[#07c160] transition-all"
            />
          </div>
        </div>
        {statsLoading && contacts.length === 0 ? (
          <div className="bg-white rounded-3xl border border-gray-100 p-20 text-center">
            <div className="text-gray-300 font-bold text-lg animate-pulse">加载中...</div>
          </div>
        ) : (
          <ContactTable contacts={filteredContacts} onContactClick={onContactClick} />
        )}
      </div>
    </div>
  );
};
