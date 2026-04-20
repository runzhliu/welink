import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Brain, Pin, PinOff, Pencil, Trash2, Search, Loader2, Check, X as XIcon } from 'lucide-react';
import axios from 'axios';
import type { ContactStats, GroupInfo } from '../../types';
import { avatarSrc } from '../../utils/avatar';
import { RelativeTime } from '../common/RelativeTime';

interface MemFact {
  id: number;
  contact_key: string;
  fact: string;
  source_from: number;
  source_to: number;
  pinned: boolean;
  created_at?: number;
  updated_at?: number;
}

interface ContactStat {
  contact_key: string;
  count: number;
  pinned_count: number;
}

interface Props {
  contacts: ContactStats[];
  groups: GroupInfo[];
}

// Memory 库主页 — 浏览 / 搜索 / 编辑 / 置顶 / 删除 LLM 提炼的记忆事实。
// 置顶事实会在 AI 对话时自动塞进 context（由后端 BuildPinnedMemoryBlock 处理）。
export const MemoryLibraryPage: React.FC<Props> = ({ contacts, groups }) => {
  const [facts, setFacts] = useState<MemFact[]>([]);
  const [contactStats, setContactStats] = useState<ContactStat[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [activeContact, setActiveContact] = useState<string>(''); // '' = 全部
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');

  // 用于把 contact_key 映射到头像 / 名称
  const contactMap = useMemo(() => {
    const m = new Map<string, { name: string; avatar: string | undefined; isGroup: boolean }>();
    for (const c of contacts) {
      m.set(c.username, {
        name: c.remark || c.nickname || c.username,
        avatar: avatarSrc(c.small_head_url),
        isGroup: false,
      });
    }
    for (const g of groups) {
      m.set(g.username, {
        name: g.name || g.username,
        avatar: avatarSrc(g.small_head_url),
        isGroup: true,
      });
    }
    return m;
  }, [contacts, groups]);

  const fetchFacts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (activeContact) params.set('contact', activeContact);
      if (q.trim()) params.set('q', q.trim());
      if (pinnedOnly) params.set('pinned', '1');
      params.set('limit', '200');
      const r = await axios.get<{ facts: MemFact[]; total: number }>(`/api/memory/list?${params}`);
      setFacts(r.data.facts || []);
      setTotal(r.data.total || 0);
    } catch {
      setFacts([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [activeContact, q, pinnedOnly]);

  const fetchContactStats = useCallback(async () => {
    try {
      const r = await axios.get<{ contacts: ContactStat[] }>('/api/memory/contacts');
      setContactStats(r.data.contacts || []);
    } catch {
      setContactStats([]);
    }
  }, []);

  useEffect(() => { void fetchContactStats(); }, [fetchContactStats]);
  useEffect(() => {
    // 搜索 debounce
    const t = setTimeout(() => { void fetchFacts(); }, 200);
    return () => clearTimeout(t);
  }, [fetchFacts]);

  const togglePin = async (f: MemFact) => {
    await axios.put(`/api/memory/${f.id}/pin`, { pinned: !f.pinned });
    setFacts(list => list.map(x => x.id === f.id ? { ...x, pinned: !x.pinned } : x));
    void fetchContactStats();
  };

  const deleteFact = async (f: MemFact) => {
    if (!confirm(`删除这条记忆？\n\n"${f.fact.slice(0, 60)}${f.fact.length > 60 ? '…' : ''}"`)) return;
    await axios.delete(`/api/memory/${f.id}`);
    setFacts(list => list.filter(x => x.id !== f.id));
    setTotal(t => Math.max(0, t - 1));
    void fetchContactStats();
  };

  const startEdit = (f: MemFact) => { setEditingId(f.id); setEditDraft(f.fact); };
  const cancelEdit = () => { setEditingId(null); setEditDraft(''); };
  const saveEdit = async (id: number) => {
    const v = editDraft.trim();
    if (!v) return;
    await axios.put(`/api/memory/${id}`, { fact: v });
    setFacts(list => list.map(x => x.id === id ? { ...x, fact: v } : x));
    cancelEdit();
  };

  const totalAll = contactStats.reduce((s, c) => s + c.count, 0);
  const pinnedAll = contactStats.reduce((s, c) => s + c.pinned_count, 0);

  return (
    <div className="p-4 sm:p-10 pb-20">
      <header className="mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#07c160] to-[#06ad56] flex items-center justify-center shadow-md">
            <Brain size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight dk-text">记忆库</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              共 {totalAll} 条 AI 提炼事实 · {pinnedAll} 条已置顶（AI 对话自动引用）
            </p>
          </div>
        </div>
      </header>

      <div className="flex gap-4 flex-col lg:flex-row">
        {/* 左栏：联系人筛选 */}
        <aside className="lg:w-64 shrink-0 bg-white dark:bg-[#1d1d1f] rounded-2xl border border-gray-100 dark:border-white/10 p-3 h-fit">
          <button
            onClick={() => setActiveContact('')}
            className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium flex items-center justify-between transition-colors ${
              activeContact === '' ? 'bg-[#07c160]/10 text-[#07c160]' : 'hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-300'
            }`}
          >
            <span>全部</span>
            <span className="text-xs text-gray-400">{totalAll}</span>
          </button>
          <div className="mt-2 max-h-[calc(100vh-320px)] overflow-y-auto space-y-0.5">
            {contactStats.map(s => {
              const info = contactMap.get(s.contact_key);
              const active = activeContact === s.contact_key;
              return (
                <button
                  key={s.contact_key}
                  onClick={() => setActiveContact(s.contact_key)}
                  className={`w-full text-left px-2 py-1.5 rounded-xl text-sm flex items-center gap-2 transition-colors ${
                    active ? 'bg-[#07c160]/10 text-[#07c160]' : 'hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-300'
                  }`}
                >
                  {info ? (
                    <img src={info.avatar} alt="" className="w-6 h-6 rounded-lg object-cover shrink-0" />
                  ) : (
                    <div className="w-6 h-6 rounded-lg bg-gray-200 dark:bg-white/10 shrink-0" />
                  )}
                  <span className="truncate flex-1">{info?.name || s.contact_key}</span>
                  {s.pinned_count > 0 && (
                    <span className="text-[10px] text-amber-500">📌{s.pinned_count}</span>
                  )}
                  <span className="text-xs text-gray-400">{s.count}</span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* 右栏：搜索 + 事实列表 */}
        <main className="flex-1 min-w-0">
          <div className="bg-white dark:bg-[#1d1d1f] rounded-2xl border border-gray-100 dark:border-white/10 p-3 mb-3 flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <Search size={16} className="text-gray-400 shrink-0" />
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="搜索记忆内容..."
                className="flex-1 bg-transparent outline-none text-sm dk-text placeholder-gray-400"
              />
              {q && (
                <button onClick={() => setQ('')} className="text-gray-400 hover:text-gray-600">
                  <XIcon size={14} />
                </button>
              )}
            </div>
            <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={pinnedOnly}
                onChange={e => setPinnedOnly(e.target.checked)}
                className="accent-[#07c160]"
              />
              只看置顶
            </label>
            <span className="text-xs text-gray-400">{total} 条</span>
          </div>

          {loading ? (
            <div className="py-12 text-center text-gray-400">
              <Loader2 size={20} className="animate-spin inline" />
            </div>
          ) : facts.length === 0 ? (
            <div className="bg-white dark:bg-[#1d1d1f] rounded-2xl border border-gray-100 dark:border-white/10 p-12 text-center">
              <Brain size={36} className="text-gray-300 dark:text-white/20 mx-auto mb-3" />
              <p className="text-sm text-gray-500">
                {q ? '没有匹配的记忆' : activeContact ? '这个联系人还没有提炼的记忆' : '还没有记忆。到联系人详情页开启「记忆提炼」功能即可'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {facts.map(f => {
                const info = contactMap.get(f.contact_key);
                const isEditing = editingId === f.id;
                return (
                  <div key={f.id} className={`bg-white dark:bg-[#1d1d1f] rounded-2xl border p-4 transition-colors ${
                    f.pinned ? 'border-amber-300 dark:border-amber-500/40' : 'border-gray-100 dark:border-white/10'
                  }`}>
                    <div className="flex items-start gap-3">
                      {info ? (
                        <img src={info.avatar} alt="" className="w-8 h-8 rounded-xl object-cover shrink-0" title={info.name} />
                      ) : (
                        <div className="w-8 h-8 rounded-xl bg-gray-200 dark:bg-white/10 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                            {info?.name || f.contact_key}
                          </span>
                          {f.pinned && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-semibold">
                              📌 置顶 · AI 对话自动引用
                            </span>
                          )}
                          {f.updated_at ? (
                            <span className="text-[10px] text-gray-400">
                              更新于 <RelativeTime ts={f.updated_at} />
                            </span>
                          ) : null}
                        </div>
                        {isEditing ? (
                          <>
                            <textarea
                              value={editDraft}
                              onChange={e => setEditDraft(e.target.value)}
                              rows={3}
                              autoFocus
                              className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-sm dk-text outline-none focus:border-[#07c160]"
                            />
                            <div className="flex gap-2 mt-2">
                              <button onClick={() => saveEdit(f.id)} className="px-3 py-1 rounded-lg bg-[#07c160] text-white text-xs font-semibold hover:bg-[#06ad56] flex items-center gap-1">
                                <Check size={12} />保存
                              </button>
                              <button onClick={cancelEdit} className="px-3 py-1 rounded-lg bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 text-xs font-semibold">
                                取消
                              </button>
                            </div>
                          </>
                        ) : (
                          <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed break-words">
                            {f.fact}
                          </p>
                        )}
                      </div>
                      {!isEditing && (
                        <div className="flex gap-1 shrink-0">
                          <button
                            onClick={() => togglePin(f)}
                            title={f.pinned ? '取消置顶' : '置顶'}
                            className={`p-1.5 rounded-lg transition-colors ${
                              f.pinned
                                ? 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                                : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5'
                            }`}
                          >
                            {f.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                          </button>
                          <button
                            onClick={() => startEdit(f)}
                            title="编辑"
                            className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => deleteFact(f)}
                            title="删除"
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
