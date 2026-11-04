/**
 * 定时任务 —— 用户写指令 + 选目标 + 选周期，系统定时跑总结/挖掘，结果进收件箱。
 *
 * 生命周期提示：本地 app，后端只在 app 开着时跑。错过的任务下次开 app 补跑一次。
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Clock, Plus, Play, Trash2, Pencil, Loader2, Inbox, AlertCircle, CalendarClock, Power, FileText } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ScheduledTask, TaskRun, ContactStats, GroupInfo } from '../../types';
import { tasksApi } from '../../services/api';
import { useToast } from '../common/Toast';
import { TaskEditModal } from './TaskEditModal';

interface Props {
  contacts: ContactStats[];
  groups: GroupInfo[];
}

const TYPE_LABEL: Record<string, string> = {
  summary: '定时总结', todo: '待办挖掘', watch: '关键词盯梢', mood: '情绪变化', custom: '自定义',
};
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function scheduleText(t: ScheduledTask): string {
  if (t.schedule_kind === 'interval') return `每 ${t.interval_hours} 小时`;
  if (t.schedule_kind === 'weekly') return `每${WEEK[t.weekday]} ${t.time_of_day}`;
  return `每天 ${t.time_of_day}`;
}
function targetText(t: ScheduledTask): string {
  if (t.target_kind === 'all_private') return '全部私聊';
  if (t.target_kind === 'all_group') return '全部群聊';
  return t.target_name || t.target_id;
}
function fmtTime(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export const SchedulerPage: React.FC<Props> = ({ contacts, groups }) => {
  const toast = useToast();
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [feed, setFeed] = useState<TaskRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ScheduledTask | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [openRun, setOpenRun] = useState<TaskRun | null>(null);

  const load = useCallback(async () => {
    try {
      const [tr, fr] = await Promise.all([tasksApi.list(), tasksApi.feed(50)]);
      setTasks(tr.tasks ?? []);
      setFeed(fr.runs ?? []);
    } catch (e) {
      toast.error('加载失败：' + ((e as Error).message || ''));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  // 标记收件箱已读
  useEffect(() => {
    if (feed.some(r => !r.read && r.status === 'success')) {
      tasksApi.markRead().catch(() => {});
    }
  }, [feed]);

  const openCreate = () => { setEditing(null); setShowEdit(true); };
  const openEdit = (t: ScheduledTask) => { setEditing(t); setShowEdit(true); };

  const onSaved = async () => { setShowEdit(false); await load(); };

  const toggleEnabled = async (t: ScheduledTask) => {
    try {
      await tasksApi.update(t.id, { ...t, enabled: !t.enabled });
      setTasks(prev => prev.map(x => x.id === t.id ? { ...x, enabled: !x.enabled } : x));
    } catch (e) {
      toast.error('操作失败：' + ((e as Error).message || ''));
    }
  };

  const runNow = async (t: ScheduledTask) => {
    setRunningId(t.id);
    try {
      const run = await tasksApi.runNow(t.id);
      if (run.status === 'success') {
        toast.success('已执行，结果已生成');
        setOpenRun(run);
      } else if (run.status === 'skipped') {
        toast.info('这段时间没有新消息，已跳过');
      } else {
        toast.error('执行失败：' + (run.error || '未知错误'));
      }
      await load();
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } }; message?: string })
        ?.response?.data?.error || (e as Error).message || '未知错误';
      toast.error('执行失败：' + msg);
    } finally {
      setRunningId(null);
    }
  };

  const remove = async (t: ScheduledTask) => {
    if (!confirm(`删除任务「${t.name}」？历史结果一并删除。`)) return;
    try {
      await tasksApi.remove(t.id);
      await load();
    } catch (e) {
      toast.error('删除失败：' + ((e as Error).message || ''));
    }
  };

  return (
    <div className="min-h-full max-w-5xl mx-auto">
      {/* 头部 */}
      <div className="flex items-center gap-2 mb-2">
        <div className="w-10 h-10 rounded-2xl bg-[#087f5b] flex items-center justify-center shadow-sm">
          <CalendarClock size={20} className="text-white" />
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-black text-[#1d1d1f] dark:text-gray-100">定时任务</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">让 AI 定时帮你总结、挖掘、盯梢，结果自动进收件箱</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-bold bg-[#087f5b] text-white hover:opacity-90 transition-opacity"
        >
          <Plus size={15} /> 新建任务
        </button>
      </div>

      {/* 生命周期提示 */}
      <div className="rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-2.5 mb-4 flex items-start gap-2 text-[11px] text-amber-700 dark:text-amber-300">
        <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
        <span>任务只在 <strong>应用打开时</strong> 执行；关闭期间错过的，下次打开会自动补跑一次。每次执行会调用 LLM（产生 token 费用）。</span>
      </div>

      {loading ? (
        <div className="py-20 text-center text-gray-400 text-sm flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" /> 加载中…
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 左：任务列表 */}
          <div>
            <div className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1.5">
              <Clock size={12} /> 我的任务（{tasks.length}）
            </div>
            {tasks.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-200 dark:border-white/10 p-8 text-center text-sm text-gray-400">
                还没有任务，点右上角「新建任务」<br />
                <span className="text-xs text-gray-300">比如：每天 9 点总结我和老板的聊天有没有待办</span>
              </div>
            ) : (
              <div className="space-y-2.5">
                {tasks.map(t => (
                  <div key={t.id} className={`rounded-2xl border p-3.5 transition-colors ${
                    t.enabled ? 'border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e]' : 'border-gray-100 dark:border-white/5 bg-gray-50/50 dark:bg-white/[0.02] opacity-70'
                  }`}>
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-bold text-[#1d1d1f] dark:text-gray-100 truncate">{t.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#07c160]/10 text-[#07c160] font-bold">{TYPE_LABEL[t.task_type]}</span>
                        </div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 flex items-center gap-2 flex-wrap">
                          <span className="inline-flex items-center gap-0.5"><CalendarClock size={10} /> {scheduleText(t)}</span>
                          <span className="text-gray-300">·</span>
                          <span className="truncate">{targetText(t)}</span>
                        </div>
                        {t.prompt && <div className="text-[11px] text-gray-400 mt-1 line-clamp-1">「{t.prompt}」</div>}
                        <div className="text-[10px] text-gray-300 mt-1">
                          下次：{fmtTime(t.next_run_at)}
                          {t.last_run && <> · 上次：{t.last_run.status === 'success' ? '成功' : t.last_run.status === 'skipped' ? '无新消息' : '失败'} {fmtTime(t.last_run.created_at)}</>}
                        </div>
                      </div>
                      <div className="flex flex-col items-center gap-1 flex-shrink-0">
                        <button onClick={() => toggleEnabled(t)} title={t.enabled ? '已启用，点击暂停' : '已暂停，点击启用'}
                          className={`p-1.5 rounded-lg transition-colors ${t.enabled ? 'text-[#07c160] hover:bg-[#07c160]/10' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10'}`}>
                          <Power size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 mt-2.5 pt-2.5 border-t border-gray-100 dark:border-white/5">
                      <button onClick={() => runNow(t)} disabled={runningId === t.id}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-[#07c160] text-white hover:bg-[#06ad56] disabled:opacity-50 transition-colors">
                        {runningId === t.id ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                        立即执行
                      </button>
                      <button onClick={() => openEdit(t)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
                        <Pencil size={11} /> 编辑
                      </button>
                      <button onClick={() => remove(t)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors ml-auto">
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 右：收件箱 */}
          <div>
            <div className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1.5">
              <Inbox size={12} /> 收件箱（最近结果）
            </div>
            {feed.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-200 dark:border-white/10 p-8 text-center text-sm text-gray-400">
                还没有执行结果<br />
                <span className="text-xs text-gray-300">任务到点或点「立即执行」后，结果会出现在这里</span>
              </div>
            ) : (
              <div className="space-y-2">
                {feed.map(r => (
                  <button key={r.id} onClick={() => r.status === 'success' && setOpenRun(r)}
                    className={`w-full text-left rounded-xl border p-3 transition-colors ${
                      r.status === 'success'
                        ? 'border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] hover:border-[#07c160]/40 cursor-pointer'
                        : 'border-gray-100 dark:border-white/5 bg-gray-50/50 dark:bg-white/[0.02]'
                    }`}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-[#1d1d1f] dark:text-gray-100 truncate flex-1">{r.task_name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                        r.status === 'success' ? 'bg-[#07c160]/10 text-[#07c160]'
                          : r.status === 'skipped' ? 'bg-gray-100 dark:bg-white/10 text-gray-400'
                          : 'bg-red-50 dark:bg-red-500/10 text-red-400'
                      }`}>
                        {r.status === 'success' ? `${r.msg_count} 条` : r.status === 'skipped' ? '无新消息' : '失败'}
                      </span>
                    </div>
                    {r.status === 'success' && (
                      <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{r.result.replace(/[#*`>-]/g, '').slice(0, 120)}</div>
                    )}
                    {r.status === 'error' && <div className="text-[11px] text-red-400 mt-1 line-clamp-1">{r.error}</div>}
                    <div className="text-[10px] text-gray-300 mt-1">{fmtTime(r.created_at)}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 编辑/新建弹窗 */}
      {showEdit && (
        <TaskEditModal
          task={editing}
          contacts={contacts}
          groups={groups}
          onClose={() => setShowEdit(false)}
          onSaved={onSaved}
        />
      )}

      {/* 结果详情弹窗 */}
      {openRun && (
        <div className="fixed inset-0 z-[160] flex items-center justify-center p-4 bg-black/50" onClick={() => setOpenRun(null)}>
          <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white/90 dark:bg-[#1c1c1e]/90 backdrop-blur px-5 py-3.5 border-b border-gray-100 dark:border-white/10 flex items-center gap-2">
              <FileText size={15} className="text-[#07c160]" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-black text-[#1d1d1f] dark:text-gray-100 truncate">{openRun.task_name}</div>
                <div className="text-[10px] text-gray-400">{fmtTime(openRun.created_at)} · 分析了 {openRun.msg_count} 条消息</div>
              </div>
              <button onClick={() => { tasksApi.markRead().catch(() => {}); setOpenRun(null); }} className="text-gray-400 hover:text-gray-600 text-sm px-2">关闭</button>
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
