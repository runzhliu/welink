/**
 * Dashboard — KPI + 图表 + 关系热力图
 */

import React, { useMemo } from 'react';
import { Users, MessageSquare, Flame, Snowflake } from 'lucide-react';
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
import { formatCompactNumber } from '../../utils/formatters';

interface StatsPageProps {
  contacts: ContactStats[];
  globalStats: GlobalStats | null;
  healthStatus: HealthStatus;
  onContactClick: (c: ContactStats) => void;
}

export const StatsPage: React.FC<StatsPageProps> = ({
  contacts,
  globalStats,
  healthStatus,
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
        <h2 className="text-2xl font-black text-[#1d1d1f] dk-text mb-1">Dashboard</h2>
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

      {/* 谁最像谁 + 红包转账总览 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-8 mb-6 sm:mb-8">
        <SimilarityCard />
        <MoneyOverviewCard />
      </div>
    </div>
  );
};
