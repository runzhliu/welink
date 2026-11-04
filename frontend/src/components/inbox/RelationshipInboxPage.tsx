/**
 * 关系收件箱
 *
 * 聚合已有信号：关系预测、纪念日、定时任务结果、沉睡老友。
 * 首版只读，不引入新的已处理状态表；每条消息都提供直接行动入口。
 */

import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Bell, Cake, CheckCircle2, ChevronRight, Clock, Heart, Inbox, Loader2, MailOpen, MoonStar, RefreshCw, Snowflake, FileText } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { anniversaryApi, forecastApi, tasksApi } from '../../services/api';
import type {
  AnniversaryResponse,
  ContactStats,
  ForecastEntry,
  TaskRun,
} from '../../types';
import { Avatar } from '../common/Avatar';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';

interface Props {
  contacts: ContactStats[];
  onContactClick?: (contact: ContactStats) => void;
  onNavigateTasks?: () => void;
  onNavigateAnniversary?: () => void;
}

type UpcomingItem = {
  id: string;
  type: 'birthday' | 'milestone' | 'custom';
  title: string;
  subtitle: string;
  daysUntil: number;
  username?: string;
  avatar?: string;
};

type SleepingItem = {
  username: string;
  name: string;
  avatar?: string;
  totalMessages: number;
  daysSince: number;
};

const daysUntilMMDD = (mmdd: string): number => {
  const [m, d] = mmdd.split('-').map(Number);
  if (!m || !d) return 9999;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let target = new Date(now.getFullYear(), m - 1, d);
  if (target < today) target = new Date(now.getFullYear() + 1, m - 1, d);
  return Math.ceil((target.getTime() - today.getTime()) / 86400000);
};

const daysUntilDate = (dateStr: string, recurring: boolean): number => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (recurring) {
    const [, m, d] = dateStr.split('-').map(Number);
    if (!m || !d) return 9999;
    let target = new Date(now.getFullYear(), m - 1, d);
    if (target < today) target = new Date(now.getFullYear() + 1, m - 1, d);
    return Math.ceil((target.getTime() - today.getTime()) / 86400000);
  }
  const target = new Date(dateStr);
  return Math.ceil((target.getTime() - today.getTime()) / 86400000);
};

const fmtTime = (ts: number): string => {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const daysLabel = (days: number) => {
  if (days === 0) return '今天';
  if (days === 1) return '明天';
  if (days === 2) return '后天';
  return `${days} 天后`;
};

const contactName = (c: ContactStats) => c.remark || c.nickname || c.username;

export const RelationshipInboxPage: React.FC<Props> = ({
  contacts,
  onContactClick,
  onNavigateTasks,
  onNavigateAnniversary,
}) => {
  const { privacyMode } = usePrivacyMode();
  const [forecasts, setForecasts] = useState<ForecastEntry[]>([]);
  const [anniversary, setAnniversary] = useState<AnniversaryResponse | null>(null);
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [taskUnread, setTaskUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [openRun, setOpenRun] = useState<TaskRun | null>(null);

  const contactsByUsername = useMemo(() => {
    const map = new Map<string, ContactStats>();
    contacts.forEach(c => map.set(c.username, c));
    return map;
  }, [contacts]);

  const load = async () => {
    setLoading(true);
    try {
      const [f, a, t] = await Promise.all([
        forecastApi.get(12).catch(() => null),
        anniversaryApi.getAll().catch(() => null),
        tasksApi.feed(20).catch(() => null),
      ]);
      setForecasts(f?.suggest_contact ?? []);
      setAnniversary(a);
      setRuns(t?.runs ?? []);
      setTaskUnread(t?.unread ?? 0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const upcoming = useMemo<UpcomingItem[]>(() => {
    if (!anniversary) return [];
    const allowed = new Set(contacts.map(c => c.username));
    const out: UpcomingItem[] = [];

    (anniversary.detected ?? [])
      .filter(e => allowed.has(e.username))
      .forEach(e => {
        const days = daysUntilMMDD(e.date);
        if (days <= 14) {
          out.push({
            id: `birthday:${e.username}:${e.date}`,
            type: 'birthday',
            title: `${e.display_name} 的生日`,
            subtitle: `${e.date}${e.years?.length ? ` · ${e.years.length} 年记录` : ''}`,
            daysUntil: days,
            username: e.username,
            avatar: e.avatar_url,
          });
        }
      });

    (anniversary.milestones ?? [])
      .filter(m => allowed.has(m.username))
      .forEach(m => {
        if (m.days_until <= 14) {
          out.push({
            id: `milestone:${m.username}:${m.next_milestone}`,
            type: 'milestone',
            title: `与 ${m.display_name} 相识 ${m.next_milestone} 天`,
            subtitle: `已认识 ${m.days_known} 天`,
            daysUntil: m.days_until,
            username: m.username,
            avatar: m.avatar_url,
          });
        }
      });

    (anniversary.custom ?? []).forEach(c => {
      const days = daysUntilDate(c.date, c.recurring);
      if (days >= 0 && days <= 14) {
        out.push({
          id: `custom:${c.id}`,
          type: 'custom',
          title: c.title,
          subtitle: c.recurring ? `每年 ${c.date.slice(5)}` : c.date,
          daysUntil: days,
          username: c.username,
        });
      }
    });

    return out.sort((a, b) => a.daysUntil - b.daysUntil).slice(0, 8);
  }, [anniversary, contacts]);

  const sleeping = useMemo<SleepingItem[]>(() => {
    const now = Date.now() / 1000;
    return contacts
      .map(c => {
        const last = c.last_message_ts || (c.last_message_time ? new Date(c.last_message_time).getTime() / 1000 : 0);
        const days = last > 0 ? Math.floor((now - last) / 86400) : 0;
        return {
          username: c.username,
          name: contactName(c),
          avatar: c.small_head_url || c.big_head_url,
          totalMessages: c.total_messages,
          daysSince: days,
        };
      })
      .filter(c => c.totalMessages >= 500 && c.daysSince >= 30)
      .sort((a, b) => (b.totalMessages * Math.min(b.daysSince, 365)) - (a.totalMessages * Math.min(a.daysSince, 365)))
      .slice(0, 8);
  }, [contacts]);

  const unreadRuns = runs.filter(r => !r.read && r.status === 'success');
  const totalItems = forecasts.length + upcoming.length + sleeping.length + unreadRuns.length;

  const openContact = (username?: string) => {
    if (!username || !onContactClick) return;
    const c = contactsByUsername.get(username);
    if (c) onContactClick(c);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 gap-2">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">正在整理关系收件箱…</span>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <header className="rounded-3xl border border-[#07c160]/15 bg-white dark:bg-[#1c1c1e] p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="w-12 h-12 rounded-xl dk-subtle text-[var(--text-secondary)] flex items-center justify-center shrink-0">
            <Inbox size={23} />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl sm:text-3xl font-black text-[#1d1d1f] dark:text-gray-100">关系收件箱</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              把关系降温、纪念日、沉睡老友和定时任务结果集中到一个行动清单。
            </p>
          </div>
          <button
            onClick={load}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-gray-100 dark:bg-white/10 text-gray-500 hover:text-[#07c160] transition-colors"
          >
            <RefreshCw size={13} /> 刷新
          </button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mt-5">
          <Metric label="待处理" value={totalItems} color="#07c160" />
          <Metric label="建议联系" value={forecasts.length} color="#fa5151" />
          <Metric label="14 天内纪念日" value={upcoming.length} color="#ff9500" />
          <Metric label="沉睡老友" value={sleeping.length} color="#576b95" />
          <Metric label="任务未读" value={taskUnread} color="#10aeff" />
        </div>
      </header>

      {totalItems === 0 && (
        <section className="rounded-2xl border border-dashed border-gray-200 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-10 text-center">
          <CheckCircle2 size={34} className="text-[#07c160] mx-auto mb-3" />
          <div className="text-sm font-bold text-[#1d1d1f] dark:text-gray-100">今天没有明显需要处理的关系事项</div>
          <div className="text-xs text-gray-400 mt-1">可以去今日简报或创意实验室看看其他发现。</div>
        </section>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Section
          icon={<AlertCircle size={15} className="text-[#fa5151]" />}
          title="建议主动联系"
          subtitle="关系预测里降温 / 濒危的人，优先按曾经互动强度排序。"
          empty={forecasts.length === 0}
        >
          {forecasts.map(f => (
            <ActionRow
              key={f.username}
              avatar={f.avatar_url}
              contact={contacts.find(c => c.username === f.username)}
              title={f.display_name}
              subtitle={`${f.days_since_last} 天未联系 · ${f.reason || f.suggestion || '关系趋冷'}`}
              tag={f.status === 'endangered' ? '濒危' : '降温'}
              tagTone={f.status === 'endangered' ? 'danger' : 'info'}
              privacyMode={privacyMode}
              onClick={() => openContact(f.username)}
            />
          ))}
        </Section>

        <Section
          icon={<Cake size={15} className="text-[#ff9500]" />}
          title="近期纪念日"
          subtitle="14 天内的生日、相识里程碑和自定义纪念日。"
          empty={upcoming.length === 0}
          actionLabel="管理纪念日"
          onAction={onNavigateAnniversary}
        >
          {upcoming.map(item => (
            <ActionRow
              key={item.id}
              avatar={item.avatar}
              contact={contacts.find(c => c.username === item.username)}
              fallbackIcon={item.username ? undefined : <Heart size={14} />}
              title={item.title}
              subtitle={`${daysLabel(item.daysUntil)} · ${item.subtitle}`}
              tag={daysLabel(item.daysUntil)}
              tagTone={item.daysUntil === 0 ? 'danger' : item.daysUntil <= 3 ? 'warn' : 'neutral'}
              privacyMode={privacyMode}
              onClick={() => item.username ? openContact(item.username) : onNavigateAnniversary?.()}
            />
          ))}
        </Section>

        <Section
          icon={<MoonStar size={15} className="text-[#576b95]" />}
          title="沉睡老友"
          subtitle="历史聊得多但近期安静的人，适合低频维护。"
          empty={sleeping.length === 0}
        >
          {sleeping.map(item => (
            <ActionRow
              key={item.username}
              avatar={item.avatar}
              contact={contacts.find(c => c.username === item.username)}
              title={item.name}
              subtitle={`${item.totalMessages.toLocaleString()} 条历史消息 · ${item.daysSince} 天未聊`}
              tag={`${item.daysSince} 天`}
              tagTone="neutral"
              privacyMode={privacyMode}
              onClick={() => openContact(item.username)}
            />
          ))}
        </Section>

        <Section
          icon={<MailOpen size={15} className="text-[#10aeff]" />}
          title="定时任务结果"
          subtitle="最近的总结、待办挖掘、关键词盯梢和情绪变化。"
          empty={runs.length === 0}
          actionLabel="查看任务"
          onAction={onNavigateTasks}
        >
          {runs.slice(0, 8).map(run => (
            <button
              key={run.id}
              onClick={() => run.status === 'success' ? setOpenRun(run) : onNavigateTasks?.()}
              className="w-full text-left rounded-xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#202023] p-3 hover:border-[#07c160]/40 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="flex-1 min-w-0 text-sm font-bold text-[#1d1d1f] dark:text-gray-100 truncate">
                  {run.task_name || `任务 #${run.task_id}`}
                </span>
                {!run.read && run.status === 'success' && (
                  <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" title="未读" />
                )}
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${run.status === 'success'
                  ? 'bg-[#07c160]/10 text-[#07c160]'
                  : run.status === 'skipped'
                    ? 'bg-gray-100 dark:bg-white/10 text-gray-400'
                    : 'bg-red-50 dark:bg-red-500/10 text-red-400'
                }`}>
                  {run.status === 'success' ? `${run.msg_count} 条` : run.status === 'skipped' ? '无新消息' : '失败'}
                </span>
              </div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                {run.status === 'success' ? run.result.replace(/[#*`>-]/g, '').slice(0, 120) : run.error || '无结果'}
              </div>
              <div className="text-[10px] text-gray-300 mt-1 inline-flex items-center gap-1">
                <Clock size={10} /> {fmtTime(run.created_at)}
              </div>
            </button>
          ))}
        </Section>
      </div>

      {openRun && (
        <div className="fixed inset-0 z-[160] flex items-center justify-center p-4 bg-black/50" onClick={() => setOpenRun(null)}>
          <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white/90 dark:bg-[#1c1c1e]/90 backdrop-blur px-5 py-3.5 border-b border-gray-100 dark:border-white/10 flex items-center gap-2">
              <FileText size={15} className="text-[#07c160]" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-black text-[#1d1d1f] dark:text-gray-100 truncate">{openRun.task_name || `任务 #${openRun.task_id}`}</div>
                <div className="text-[10px] text-gray-400">{fmtTime(openRun.created_at)} · 分析了 {openRun.msg_count} 条消息</div>
              </div>
              <button onClick={() => setOpenRun(null)} className="text-gray-400 hover:text-gray-600 text-sm px-2">关闭</button>
            </div>
            <div className="p-5 prose prose-sm dark:prose-invert max-w-none prose-headings:font-bold prose-p:my-1.5">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{openRun.result}</ReactMarkdown>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const Metric: React.FC<{ label: string; value: number; color: string }> = ({ label, value, color }) => (
  <div className="rounded-2xl bg-gray-50 dark:bg-white/[0.04] border border-gray-100 dark:border-white/5 px-3 py-2.5">
    <div className="text-2xl font-black tabular-nums" style={{ color }}>{value}</div>
    <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{label}</div>
  </div>
);

const Section: React.FC<{
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  empty: boolean;
  children: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}> = ({ icon, title, subtitle, empty, children, actionLabel, onAction }) => (
  <section className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-4">
    <div className="flex items-start gap-2 mb-3">
      <div className="mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <h2 className="text-sm font-black text-[#1d1d1f] dark:text-gray-100">{title}</h2>
        <p className="text-[11px] text-gray-400 mt-0.5">{subtitle}</p>
      </div>
      {actionLabel && onAction && (
        <button onClick={onAction} className="text-[11px] font-bold text-[#576b95] hover:text-[#07c160]">
          {actionLabel}
        </button>
      )}
    </div>
    {empty ? (
      <div className="rounded-xl border border-dashed border-gray-200 dark:border-white/10 text-center text-xs text-gray-400 py-8">
        暂无数据
      </div>
    ) : (
      <div className="space-y-2">{children}</div>
    )}
  </section>
);

const tagClass = (tone: 'danger' | 'warn' | 'info' | 'neutral') => {
  if (tone === 'danger') return 'bg-[#fa5151]/10 text-[#fa5151]';
  if (tone === 'warn') return 'bg-[#ff9500]/10 text-[#ff9500]';
  if (tone === 'info') return 'bg-[#10aeff]/10 text-[#10aeff]';
  return 'bg-gray-100 dark:bg-white/10 text-gray-400';
};

const ActionRow: React.FC<{
  avatar?: string;
  contact?: ContactStats;
  fallbackIcon?: React.ReactNode;
  title: string;
  subtitle: string;
  tag: string;
  tagTone: 'danger' | 'warn' | 'info' | 'neutral';
  privacyMode: boolean;
  onClick: () => void;
}> = ({ avatar, contact, fallbackIcon, title, subtitle, tag, tagTone, privacyMode, onClick }) => (
  <button
    onClick={onClick}
    className="w-full flex items-center gap-3 rounded-xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#202023] p-3 text-left hover:border-[#07c160]/40 transition-colors"
  >
    {fallbackIcon ? (
      <div className="w-9 h-9 rounded-full dk-subtle text-[var(--text-secondary)] flex items-center justify-center shrink-0">{fallbackIcon}</div>
    ) : <Avatar contact={contact} src={avatar} name={title} className="w-9 h-9" />}
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-1.5">
        <span className={`text-sm font-bold text-[#1d1d1f] dark:text-gray-100 truncate${privacyMode ? ' privacy-blur' : ''}`}>
          {title}
        </span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0 ${tagClass(tagTone)}`}>
          {tag}
        </span>
      </div>
      <div className={`text-[11px] text-gray-400 mt-0.5 line-clamp-1${privacyMode ? ' privacy-blur' : ''}`}>
        {subtitle}
      </div>
    </div>
    {tagTone === 'info' ? <Snowflake size={14} className="text-[#10aeff] shrink-0" /> : <ChevronRight size={14} className="text-gray-300 shrink-0" />}
  </button>
);

export default RelationshipInboxPage;
