import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Clock, Trash2, Loader2 } from 'lucide-react';
import { conversationFetch, deleteConversation } from '../../services/conversationStore';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';
import { Dialog } from '../common/Dialog';

interface ConversationEntry { key: string; updated_at: number; preview: string; msg_count: number }
interface Props {
  prefix: string;
  currentKey: string | null;
  onSelect: (key: string) => void;
  onNew: () => void;
  className?: string;
  busy?: boolean;
}

const formatTime = (unix: number) => {
  const d = new Date(unix * 1000), diffDays = Math.floor((Date.now() - d.getTime()) / 86400000);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (diffDays === 0) return `今天 ${time}`;
  if (diffDays === 1) return `昨天 ${time}`;
  if (diffDays < 7) return `${diffDays}天前`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

export const ConversationHistory: React.FC<Props> = ({ prefix, currentKey, onSelect, onNew, className, busy = false }) => {
  const { privacyMode } = usePrivacyMode();
  const [list, setList] = useState<ConversationEntry[]>([]), [loading, setLoading] = useState(false);
  const [managing, setManaging] = useState(false), [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmKeys, setConfirmKeys] = useState<string[] | null>(null), [deleting, setDeleting] = useState(false), [error, setError] = useState('');
  const requestVersion = useRef(0);

  const loadList = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      const resp = await conversationFetch(`?prefix=${encodeURIComponent(prefix)}`);
      if (!resp.ok) throw new Error('加载历史记录失败');
      const data = await resp.json();
      if (version === requestVersion.current) { setList(data.conversations ?? []); setError(''); }
    } catch { if (version === requestVersion.current) setError('加载历史记录失败，请稍后重试。'); }
    finally { if (version === requestVersion.current) setLoading(false); }
  }, [prefix]);

  useEffect(() => { void loadList(); return () => { requestVersion.current++; }; }, [loadList]);
  useEffect(() => {
    const handler = () => { void loadList(); };
    window.addEventListener('welink:conversation-saved', handler);
    return () => window.removeEventListener('welink:conversation-saved', handler);
  }, [loadList]);

  const toggle = (key: string) => setSelected(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const selectedKeys = list.filter(item => selected.has(item.key)).map(item => item.key);
  const allSelected = list.length > 0 && selectedKeys.length === list.length;

  const handleDelete = async () => {
    if (!confirmKeys?.length || deleting || busy) return;
    const keys = confirmKeys;
    setDeleting(true); setError('');
    const succeeded: string[] = [], failed: string[] = [];
    // Limit concurrency to avoid overwhelming the server when many items are selected.
    for (let i = 0; i < keys.length; i += 8) {
      const batch = keys.slice(i, i + 8);
      const results = await Promise.allSettled(batch.map(key => deleteConversation(key)));
      results.forEach((result, index) => (result.status === 'fulfilled' ? succeeded : failed).push(batch[index]));
    }
    requestVersion.current++;
    setLoading(false);
    setList(prev => prev.filter(item => !succeeded.includes(item.key)));
    if (currentKey && succeeded.includes(currentKey)) onNew();
    setSelected(new Set(failed));
    setConfirmKeys(null); setDeleting(false);
    if (failed.length) { setManaging(true); setError(`已删除 ${succeeded.length} 条，${failed.length} 条删除失败，请重试。`); }
    else { setManaging(false); setError(''); }
  };

  if (loading && list.length === 0 && !error) return <div className={`text-xs text-gray-400 p-3 ${className ?? ''}`}><Loader2 size={12} className="animate-spin inline mr-1" />加载中...</div>;
  if (list.length === 0 && !error) return null;

  return <div className={className ?? ''}>
    <div className="flex items-center justify-between gap-3 mb-2">
      <div className="flex items-center gap-1 text-[10px] font-semibold text-[var(--text-muted)] tracking-wide"><Clock size={11} />历史记录</div>
      <div className="flex items-center gap-3 text-xs">
        {list.length > 0 && <button type="button" disabled={busy || deleting} onClick={() => { setManaging(!managing); setSelected(new Set()); setError(''); }} className="text-[var(--text-secondary)] hover:text-[var(--accent-text)] disabled:opacity-50">{managing ? '取消管理' : '批量管理'}</button>}
        <button type="button" disabled={busy || deleting} onClick={onNew} className="font-medium text-[var(--accent-text)] hover:underline disabled:opacity-50">+ 新对话</button>
      </div>
    </div>
    {managing && <div className="flex items-center justify-between gap-3 py-2 text-xs">
      <label className="flex items-center gap-2 text-[var(--text-secondary)]"><input type="checkbox" checked={allSelected} disabled={deleting || busy} onChange={() => setSelected(allSelected ? new Set() : new Set(list.map(item => item.key)))} />全选（{selectedKeys.length}/{list.length}）</label>
      <button type="button" disabled={!selectedKeys.length || deleting || busy} onClick={() => setConfirmKeys(selectedKeys)} className="inline-flex items-center gap-1 text-red-600 hover:text-red-700 disabled:opacity-40"><Trash2 size={13} />删除所选</button>
    </div>}
    {error && <div role="alert" className="mb-2 flex items-center justify-between gap-2 text-xs text-red-600"><span>{error}</span>{!list.length && <button type="button" onClick={() => void loadList()} className="underline">重试</button>}</div>}
    <div className="space-y-1 max-h-48 overflow-y-auto">
      {list.map(item => <div key={item.key} className={`flex items-center gap-2 rounded-lg px-2.5 transition-colors group ${currentKey === item.key ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--bg-subtle)]'}`}>
        {managing && <input type="checkbox" aria-label={`选择 ${item.preview || '空对话'}`} checked={selected.has(item.key)} disabled={busy || deleting} onChange={() => toggle(item.key)} />}
        <button type="button" disabled={busy || deleting} onClick={() => managing ? toggle(item.key) : onSelect(item.key)} className={`min-w-0 flex flex-1 items-center justify-between gap-3 py-2 text-left text-xs disabled:opacity-50 ${currentKey === item.key ? 'text-[var(--accent-text)] font-semibold' : 'text-[var(--text-secondary)]'}`}>
          <span className={`truncate ${privacyMode ? 'privacy-blur' : ''}`}>{item.preview || '(空对话)'}</span><span className="shrink-0 text-[10px] text-[var(--text-muted)]">{formatTime(item.updated_at)}</span>
        </button>
        {!managing && <button type="button" disabled={busy || deleting} onClick={() => setConfirmKeys([item.key])} aria-label={`删除 ${item.preview || '空对话'}`} className="p-1 text-[var(--text-muted)] hover:text-red-600 disabled:opacity-40"><Trash2 size={13} /></button>}
      </div>)}
    </div>
    <Dialog open={!!confirmKeys} title="删除对话记录" onClose={() => { if (!deleting) setConfirmKeys(null); }}>
      <p className="text-sm text-[var(--text-secondary)] leading-relaxed">确定删除选中的 {confirmKeys?.length ?? 0} 条 AI 对话？此操作不可撤销，原始微信聊天记录不会被删除。</p>
      <div className="mt-5 flex justify-end gap-2"><button type="button" className="ui-button ui-button-secondary" disabled={deleting} onClick={() => setConfirmKeys(null)}>取消</button><button type="button" className="ui-button bg-red-600 text-white hover:bg-red-700" disabled={deleting || busy} onClick={() => void handleDelete()}>{deleting ? <><Loader2 size={14} className="animate-spin" />正在删除</> : '确认删除'}</button></div>
    </Dialog>
  </div>;
};
