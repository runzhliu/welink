import { Select } from '../common/Select';
import { TimePicker } from '../common/TimePicker';
/**
 * 定时任务 新建/编辑表单弹窗。
 */

import React, { useMemo, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import type {
  ScheduledTask, TaskType, TaskTargetKind, TaskScheduleKind,
  ContactStats, GroupInfo,
} from '../../types';
import { tasksApi } from '../../services/api';
import { useToast } from '../common/Toast';

interface Props {
  task: ScheduledTask | null; // null = 新建
  contacts: ContactStats[];
  groups: GroupInfo[];
  onClose: () => void;
  onSaved: () => void;
}

const TYPE_OPTIONS: { value: TaskType; label: string; hint: string }[] = [
  { value: 'summary', label: '定时总结', hint: '提炼这段时间聊了什么、有什么重要信息' },
  { value: 'todo', label: '待办挖掘', hint: '找出需要跟进的事：未回复、答应过的、约定' },
  { value: 'watch', label: '关键词盯梢', hint: '盯住你关心的话题/关键词，有动静就归纳' },
  { value: 'mood', label: '情绪变化', hint: '分析对方/群的情绪与关系氛围变化' },
  { value: 'custom', label: '自定义', hint: '你自己写一条指令，AI 照着做' },
];

const TARGET_OPTIONS: { value: TaskTargetKind; label: string }[] = [
  { value: 'contact', label: '某个私聊' },
  { value: 'group', label: '某个群' },
  { value: 'all_private', label: '全部私聊' },
  { value: 'all_group', label: '全部群聊' },
];

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function contactName(c: ContactStats): string {
  return c.remark || c.nickname || c.username;
}

export const TaskEditModal: React.FC<Props> = ({ task, contacts, groups, onClose, onSaved }) => {
  const toast = useToast();
  const [name, setName] = useState(task?.name ?? '');
  const [taskType, setTaskType] = useState<TaskType>(task?.task_type ?? 'summary');
  const [prompt, setPrompt] = useState(task?.prompt ?? '');
  const [targetKind, setTargetKind] = useState<TaskTargetKind>(task?.target_kind ?? 'contact');
  const [targetId, setTargetId] = useState(task?.target_id ?? '');
  const [scheduleKind, setScheduleKind] = useState<TaskScheduleKind>(task?.schedule_kind ?? 'daily');
  const [timeOfDay, setTimeOfDay] = useState(task?.time_of_day ?? '09:00');
  const [weekday, setWeekday] = useState(task?.weekday ?? 1);
  const [intervalHours, setIntervalHours] = useState(task?.interval_hours ?? 24);
  const [saving, setSaving] = useState(false);

  const sortedContacts = useMemo(
    () => [...contacts].sort((a, b) => (b.total_messages || 0) - (a.total_messages || 0)),
    [contacts],
  );
  const sortedGroups = useMemo(
    () => [...groups].sort((a, b) => (b.total_messages || 0) - (a.total_messages || 0)),
    [groups],
  );

  const needTarget = targetKind === 'contact' || targetKind === 'group';
  const promptLabel = taskType === 'watch' ? '关注的关键词 / 话题' : taskType === 'custom' ? '你的指令' : '额外要求（可选）';
  const promptPlaceholder = taskType === 'watch' ? '例如：出差、报销、面试、孩子上学'
    : taskType === 'custom' ? '例如：把对方提到的所有餐厅名字列出来，附上日期'
    : '例如：重点关注跟工作有关的部分';

  const save = async () => {
    if (!name.trim()) { toast.error('请填写任务名'); return; }
    if (needTarget && !targetId) { toast.error('请选择目标会话'); return; }
    if (taskType === 'custom' && !prompt.trim()) { toast.error('自定义任务需要填写指令'); return; }
    if (taskType === 'watch' && !prompt.trim()) { toast.error('关键词盯梢需要填写关注内容'); return; }

    // 目标名快照
    let targetName = '';
    if (targetKind === 'contact') targetName = contactName(sortedContacts.find(c => c.username === targetId) || ({} as ContactStats)) || targetId;
    else if (targetKind === 'group') targetName = (sortedGroups.find(g => g.username === targetId)?.name) || targetId;

    const payload: Partial<ScheduledTask> = {
      name: name.trim(),
      task_type: taskType,
      prompt: prompt.trim(),
      target_kind: targetKind,
      target_id: needTarget ? targetId : '',
      target_name: targetName,
      schedule_kind: scheduleKind,
      time_of_day: timeOfDay,
      weekday,
      interval_hours: intervalHours,
      enabled: task?.enabled ?? true,
    };

    setSaving(true);
    try {
      if (task) await tasksApi.update(task.id, payload);
      else await tasksApi.create(payload);
      toast.success(task ? '已保存' : '任务已创建');
      onSaved();
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } }; message?: string })
        ?.response?.data?.error || (e as Error).message || '保存失败';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const fieldCls = 'w-full border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm bg-white dark:bg-white/5 text-[#1d1d1f] dark:text-gray-100 focus:outline-none focus:border-[#07c160]';

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[88vh] overflow-y-auto bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white/90 dark:bg-[#1c1c1e]/90 backdrop-blur px-5 py-3.5 border-b border-gray-100 dark:border-white/10 flex items-center">
          <div className="text-base font-black text-[#1d1d1f] dark:text-gray-100 flex-1">{task ? '编辑任务' : '新建定时任务'}</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* 任务名 */}
          <div>
            <label className="block text-xs font-bold text-gray-600 dark:text-gray-300 mb-1.5">任务名</label>
            <input className={fieldCls} value={name} onChange={e => setName(e.target.value)} placeholder="例如：老板聊天待办盯梢" />
          </div>

          {/* 任务类型 */}
          <div>
            <label className="block text-xs font-bold text-gray-600 dark:text-gray-300 mb-1.5">做什么</label>
            <div className="grid grid-cols-2 gap-1.5">
              {TYPE_OPTIONS.map(o => (
                <button key={o.value} onClick={() => setTaskType(o.value)}
                  className={`text-left px-2.5 py-2 rounded-lg border text-xs transition-colors ${
                    taskType === o.value ? 'border-[#07c160] bg-[#07c160]/5' : 'border-gray-200 dark:border-white/10 hover:border-gray-300'
                  }`}>
                  <div className={`font-bold ${taskType === o.value ? 'text-[#07c160]' : 'text-[#1d1d1f] dark:text-gray-200'}`}>{o.label}</div>
                  <div className="text-[10px] text-gray-400 mt-0.5 leading-tight">{o.hint}</div>
                </button>
              ))}
            </div>
          </div>

          {/* prompt */}
          <div>
            <label className="block text-xs font-bold text-gray-600 dark:text-gray-300 mb-1.5">
              {promptLabel}{(taskType === 'watch' || taskType === 'custom') && <span className="text-red-400"> *</span>}
            </label>
            <textarea className={`${fieldCls} resize-none`} rows={taskType === 'custom' ? 3 : 2}
              value={prompt} onChange={e => setPrompt(e.target.value)} placeholder={promptPlaceholder} />
          </div>

          {/* 目标 */}
          <div>
            <label className="block text-xs font-bold text-gray-600 dark:text-gray-300 mb-1.5">分析范围</label>
            <div className="flex gap-1.5 mb-2 flex-wrap">
              {TARGET_OPTIONS.map(o => (
                <button key={o.value} onClick={() => { setTargetKind(o.value); setTargetId(''); }}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                    targetKind === o.value ? 'bg-[#07c160] text-white' : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-gray-200'
                  }`}>{o.label}</button>
              ))}
            </div>
            {needTarget && (
              <Select className={fieldCls} value={targetId} onValueChange={nextValue => setTargetId(nextValue)}>
                <option value="">— 选择{targetKind === 'contact' ? '联系人' : '群'} —</option>
                {targetKind === 'contact'
                  ? sortedContacts.map(c => <option key={c.username} value={c.username}>{contactName(c)}</option>)
                  : sortedGroups.map(g => <option key={g.username} value={g.username}>{g.name}</option>)}
              </Select>
            )}
          </div>

          {/* 调度 */}
          <div>
            <label className="block text-xs font-bold text-gray-600 dark:text-gray-300 mb-1.5">多久执行一次</label>
            <div className="flex gap-1.5 mb-2">
              {([['daily', '每天'], ['weekly', '每周'], ['interval', '按间隔']] as [TaskScheduleKind, string][]).map(([v, l]) => (
                <button key={v} onClick={() => setScheduleKind(v)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                    scheduleKind === v ? 'bg-[#10aeff] text-white' : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-gray-200'
                  }`}>{l}</button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              {scheduleKind === 'weekly' && (
                <Select className={fieldCls + ' flex-1'} value={weekday} onValueChange={nextValue => setWeekday(Number(nextValue))}>
                  {WEEK.map((w, i) => <option key={i} value={i}>{w}</option>)}
                </Select>
              )}
              {scheduleKind === 'interval' ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">每</span>
                  <input type="number" min={1} max={720} className={fieldCls + ' w-20'} value={intervalHours}
                    onChange={e => setIntervalHours(Math.max(1, Number(e.target.value)))} />
                  <span className="text-sm text-gray-500">小时</span>
                </div>
              ) : (
                <TimePicker aria-label="执行时间"  className={fieldCls + ' flex-1'} value={timeOfDay} onValueChange={nextValue => setTimeOfDay(nextValue)} />
              )}
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 bg-white/90 dark:bg-[#1c1c1e]/90 backdrop-blur px-5 py-3 border-t border-gray-100 dark:border-white/10 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">取消</button>
          <button onClick={save} disabled={saving}
            className="flex items-center gap-1.5 px-5 py-2 rounded-lg text-sm font-bold bg-[var(--accent)] text-[var(--on-accent)] hover:opacity-90 disabled:opacity-50 transition-opacity">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {task ? '保存' : '创建'}
          </button>
        </div>
      </div>
    </div>
  );
};
