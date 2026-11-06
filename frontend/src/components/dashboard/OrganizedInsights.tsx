import React, { useState } from 'react';
import { Activity, ArrowRight, CalendarDays, Clock3, LayoutDashboard, MessageSquare, Rewind, Settings2, Sparkles, Users } from 'lucide-react';
import type { StatsPageProps } from './StatsPage';
import { MonthlyTrendChart } from './MonthlyTrendChart';
import { HourlyHeatmap } from './HourlyHeatmap';
import { RelationshipHeatmap } from './RelationshipHeatmap';
import { RelationshipForecastSection } from './RelationshipForecastSection';
import { DriftingApart } from './DriftingApart';
import SocialReport from './SocialReport';
import { SimilarityCard } from './SimilarityCard';
import { LateNightGuard } from './LateNightGuard';
import { SelfPortraitCard } from './SelfPortraitCard';
import { SocialBreadthCard } from './SocialBreadthCard';
import { MoneyOverviewCard } from './MoneyOverviewCard';
import { RecallRanking } from './RecallRanking';
import { YearInReview } from './YearInReview';
import { CharCountCard, BusiestDayCard, InteractionTierCard, CompanionTimeCard, FirstEncountersCard, EmojiDensityCard, MonologueCard, WordAlmanacCard, InsomniaTopCard } from './FunStatsPage';
import { formatCompactNumber } from '../../utils/formatters';
import './insights.css';

type Section = 'overview' | 'relationships' | 'habits' | 'fun';
const sections: { id: Section; label: string; description: string; icon: typeof Users }[] = [
  { id: 'overview', label: '总览', description: '先看看整体变化', icon: LayoutDashboard },
  { id: 'relationships', label: '关系变化', description: '联系频率与变化', icon: Users },
  { id: 'habits', label: '聊天习惯', description: '时间与表达方式', icon: Clock3 },
  { id: 'fun', label: '有趣发现', description: '聊天里的小细节', icon: Sparkles },
];

const Heading: React.FC<{ title: string; description: string }> = ({ title, description }) => <div className="mb-4">
  <h3 className="text-lg font-bold text-[var(--text-primary)]">{title}</h3>
  <p className="mt-1 text-sm text-[var(--text-secondary)]">{description}</p>
</div>;

export const OrganizedInsights: React.FC<StatsPageProps & { onCustomize: () => void }> = ({ contacts, globalStats, healthStatus, onContactClick, blockedUsers, blockedDisplayNames, onOpenSettings, timeRangeLabel, statsLoading, onReselect, onCustomize }) => {
  const [section, setSection] = useState<Section>('overview');
  const [showYearReview, setShowYearReview] = useState(false);
  const findContact = (username: string) => { const contact = contacts.find(c => c.username === username); if (contact) onContactClick(contact); };

  return <div className="insights-workspace max-w-[1440px] mx-auto pb-10">
    <header className="flex flex-wrap items-start justify-between gap-4 mb-6">
      <div>
        <p className="text-xs font-bold tracking-wide text-[var(--accent-text)] mb-2">聊天记录 · 数据洞察</p>
        <h1 className="ui-page-title">洞察</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">从聊天记录中，了解关系的变化和自己的表达习惯。</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onCustomize} className="ui-button ui-button-secondary"><Settings2 size={15} />自定义布局</button>
        <button type="button" onClick={() => setShowYearReview(true)} className="ui-button ui-button-primary"><Rewind size={15} />年度回顾</button>
      </div>
    </header>

    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-y border-[var(--border)] py-3 mb-5 text-xs text-[var(--text-secondary)]">
      <span className="inline-flex items-center gap-1.5 font-semibold"><CalendarDays size={14} />当前分析范围：{timeRangeLabel || '当前数据范围'}</span>
      <span>各指标的时间和对象范围以卡片说明为准</span>
      {onReselect && <button type="button" onClick={onReselect} className="text-[var(--accent-text)] font-semibold hover:underline">更改范围</button>}
    </div>

    <nav aria-label="洞察分区" className="flex gap-1 overflow-x-auto border-b border-[var(--border)] mb-6">
      {sections.map(item => <button key={item.id} type="button" onClick={() => setSection(item.id)} aria-current={section === item.id ? 'page' : undefined}
        className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${section === item.id ? 'border-[var(--accent)] text-[var(--accent-text)]' : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
        <item.icon size={16} />{item.label}
      </button>)}
    </nav>

    {section === 'overview' && <section aria-label="总览" className="space-y-6">
      <div><Heading title="先看整体" description="把聊天规模和近期联系情况放在一起看。" />
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-px overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--border)]">
          {[
            { icon: Users, title: '好友总数', value: globalStats ? globalStats.total_friends.toLocaleString() : '—', note: blockedUsers.length ? '数据源统计，包含已屏蔽联系人' : '数据源统计' },
            { icon: MessageSquare, title: '消息总量', value: globalStats ? formatCompactNumber(globalStats.total_messages) : '—', note: blockedUsers.length ? '数据源汇总，包含已屏蔽联系人' : '数据源汇总' },
            { icon: Activity, title: '近期有联系', value: statsLoading ? '—' : healthStatus.hot.toLocaleString(), note: '可见联系人 · 7 天内有消息' },
            { icon: Users, title: '尚无聊天', value: statsLoading ? '—' : healthStatus.cold.toLocaleString(), note: '可见联系人 · 从未聊天' },
          ].map(item => <article key={item.title} className="bg-[var(--bg-card)] p-4 sm:p-5 min-w-0">
            <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]"><item.icon size={15} className="text-[var(--accent-text)]" />{item.title}</div>
            <div className="mt-3 text-2xl font-bold text-[var(--text-primary)] tabular-nums">{item.value}</div>
            <p className="mt-2 text-xs text-[var(--text-muted)]">{item.note}</p>
          </article>)}
        </div>
      </div>
      <div><Heading title="聊天趋势" description="按月查看消息变化；有群聊数据时可切换范围。" /><div className="insights-widget"><MonthlyTrendChart data={globalStats} /></div></div>
      {!statsLoading && contacts.length > 0 && <div><Heading title="联系情况" description="按最近一次聊天时间统计，不代表关系好坏。" />
        <button type="button" onClick={() => setSection('relationships')} className="w-full border-y border-[var(--border)] py-4 text-left flex flex-wrap items-center gap-x-6 gap-y-2 hover:text-[var(--accent-text)] transition-colors">
          <span className="text-sm text-[var(--text-secondary)]">30–180 天未联系 <strong className="text-[var(--text-primary)]">{healthStatus.cooling} 人</strong></span>
          <span className="text-sm text-[var(--text-secondary)]">超过 180 天未联系 <strong className="text-[var(--text-primary)]">{healthStatus.silent} 人</strong></span>
          <span className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent-text)]">查看关系变化 <ArrowRight size={14} /></span>
        </button>
      </div>}
      <div><Heading title="继续探索" description="从一个问题出发，查看更具体的数据。" />
        <div className="grid md:grid-cols-3 border-y border-[var(--border)] divide-y md:divide-y-0 md:divide-x divide-[var(--border)]">
          {sections.slice(1).map(item => <button key={item.id} type="button" onClick={() => setSection(item.id)} className="text-left py-4 md:px-4 first:pl-0 flex items-start gap-3 hover:text-[var(--accent-text)] transition-colors">
            <span className="text-[var(--accent-text)] pt-0.5"><item.icon size={18} /></span>
            <span className="min-w-0 flex-1"><strong className="block text-sm text-[var(--text-primary)]">{item.label}</strong><span className="block mt-1 text-xs text-[var(--text-secondary)]">{item.description}</span></span><ArrowRight size={16} className="text-[var(--text-muted)]" />
          </button>)}
        </div>
      </div>
    </section>}

    {section === 'relationships' && <section aria-label="关系变化" className="space-y-6">
      <Heading title="关系变化" description="按最近联系时间和消息频率观察变化；这些统计不能单独代表关系好坏。" />
      <div className="insights-widget"><RelationshipHeatmap health={healthStatus} totalContacts={contacts.length} contacts={contacts} onContactClick={onContactClick} /></div>
      <div className="insights-widget"><RelationshipForecastSection contacts={contacts} onContactClick={onContactClick} /></div>
      <div className="grid grid-cols-1 lg:grid-cols-2 items-start gap-3"><div className="insights-widget"><DriftingApart contacts={contacts} onContactClick={onContactClick} /></div><div className="insights-widget"><SocialReport contacts={contacts} globalStats={globalStats} healthStatus={healthStatus} /></div></div>
      <div className="insights-widget"><SimilarityCard blockedUsers={blockedUsers} blockedDisplayNames={blockedDisplayNames} onContactClick={findContact} /></div>
    </section>}

    {section === 'habits' && <section aria-label="聊天习惯" className="space-y-6">
      <Heading title="聊天习惯" description="看看发言时间、表达方式，以及每天联系的人。" />
      <div className="grid grid-cols-1 lg:grid-cols-2 items-start gap-3">
        <div className="space-y-3"><div className="insights-widget"><SelfPortraitCard blockedDisplayNames={blockedDisplayNames} contacts={contacts} globalStats={globalStats} onOpenSettings={onOpenSettings} /></div><div className="insights-widget"><SocialBreadthCard /></div></div>
        <div className="space-y-3"><div className="insights-widget"><HourlyHeatmap data={globalStats} /></div><div className="insights-widget"><LateNightGuard globalStats={globalStats} contacts={contacts} onContactClick={onContactClick} /></div></div>
      </div>
    </section>}

    {section === 'fun' && <section aria-label="有趣发现" className="space-y-6">
      <Heading title="有趣发现" description="从聊天记录里找一些小细节，结果仅供探索和娱乐。" />
      <div className="insights-fun-grid">
        <CharCountCard contacts={contacts} /><BusiestDayCard /><InteractionTierCard contacts={contacts} /><CompanionTimeCard contacts={contacts} onContactClick={onContactClick} /><FirstEncountersCard contacts={contacts} onContactClick={onContactClick} /><EmojiDensityCard contacts={contacts} onContactClick={onContactClick} /><MonologueCard contacts={contacts} onContactClick={onContactClick} /><InsomniaTopCard contacts={contacts} onContactClick={onContactClick} /><WordAlmanacCard /><MoneyOverviewCard blockedUsers={blockedUsers} blockedDisplayNames={blockedDisplayNames} onContactClick={findContact} /><RecallRanking contacts={contacts} onContactClick={onContactClick} />
      </div>
    </section>}
    {showYearReview && <YearInReview contacts={contacts} globalStats={globalStats} onClose={() => setShowYearReview(false)} />}
  </div>;
};
