/**
 * 对话历史侧栏 — AI 首页和跨联系人问答共用
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Clock, Trash2, Loader2, MessageSquare, X } from 'lucide-react';

interface ConversationEntry {
  key: string;
  updated_at: number;
  preview: string;
  msg_count: number;
}

interface Props {
  prefix: string; // e.g. 'ai-home:' or 'cross-qa:'
  currentKey: string | null;
  onSelect: (key: string) => void;
  onNew: () => void;
  className?: string;
}

const formatTime = (unix: number) => {
  const d = new Date(unix * 1000);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (diffDays === 0) return `今天 ${time}`;
  if (diffDays === 1) return `昨天 ${time}`;
  if (diffDays < 7) return `${diffDays}天前`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

export const ConversationHistory: React.FC<Props> = ({ prefix, currentKey, onSelect, onNew, className }) => {
  const [list, setList] = useState<ConversationEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch(`/api/ai/conversations?prefix=${encodeURIComponent(prefix)}`);
      const data = await resp.json();
      setList(data.conversations ?? []);
    } catch {} finally { setLoading(false); }
  }, [prefix]);

  useEffect(() => { loadList(); }, [loadList]);

  // 外部保存后刷新
  useEffect(() => {
    const handler = () => loadList();
    window.addEventListener('welink:conversation-saved', handler);
    return () => window.removeEventListener('welink:conversation-saved', handler);
  }, [loadList]);

  const handleDelete = async (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetch(`/api/ai/conversations?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
      setList(prev => prev.filter(c => c.key !== key));
    } catch {}
  };

  if (loading && list.length === 0) {
    return <div className={`text-xs text-gray-400 p-3 ${className ?? ''}`}><Loader2 size={12} className="animate-spin inline mr-1" />加载中...</div>;
  }

  if (list.length === 0) return null;

  return (
    <div className={`${className ?? ''}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
          <Clock size={10} /> 历史记录
        </div>
        <button onClick={onNew} className="text-[10px] text-[#07c160] hover:underline font-bold">
          + 新对话
        </button>
      </div>
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {list.map(c => (
          <button
            key={c.key}
            onClick={() => onSelect(c.key)}
            className={`w-full text-left px-2.5 py-2 rounded-lg text-xs transition-all group ${
              currentKey === c.key
                ? 'bg-[#07c160]/10 text-[#07c160] font-bold'
                : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="truncate flex-1 mr-2">{c.preview || '(空对话)'}</span>
              <div className="flex items-center gap-1 flex-shrink-0">
                <span className="text-[9px] text-gray-300">{formatTime(c.updated_at)}</span>
                <button
                  onClick={(e) => handleDelete(c.key, e)}
                  className="p-0.5 rounded text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
