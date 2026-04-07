/**
 * 全局跨联系人/群聊消息搜索
 * 增强版：时间范围筛选、结果排序、统计摘要、即输即搜、空状态建议
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Search, Loader2, ChevronRight, Users, Download, Clock, X, Sparkles, Calendar, ArrowUpDown, BarChart3 } from 'lucide-react';
import type { GlobalSearchGroup, ContactStats } from '../../types';
import { searchApi } from '../../services/api';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';
import { SearchContextModal, type SearchContextTarget } from './SearchContextModal';
import { exportSearchResultsCsv, exportSearchResultsTxt, parseExportResult } from '../../utils/exportChat';
import { avatarSrc } from '../../utils/avatar';

interface Props {
  contacts: ContactStats[];
  onContactClick?: (contact: ContactStats) => void;
  onGroupClick?: (username: string) => void;
  blockedGroups?: string[];
}

const HISTORY_KEY = 'welink_search_history';
const MAX_HISTORY = 12;

const HOT_KEYWORDS = [
  '生日快乐', '在吗', '谢谢', '晚安', '红包', '哈哈哈',
  '好的', '吃饭', '回家', '加班', '开会', '想你',
];

type SortMode = 'match' | 'time' | 'total';

function loadHistory(): string[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }
  catch { return []; }
}

function saveHistory(list: string[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, MAX_HISTORY)));
}

export const SearchView: React.FC<Props> = ({ contacts, onContactClick, onGroupClick, blockedGroups = [] }) => {
  const { privacyMode } = usePrivacyMode();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GlobalSearchGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [includeContacts, setIncludeContacts] = useState(true);
  const [includeGroups, setIncludeGroups] = useState(true);
  const [contextTarget, setContextTarget] = useState<SearchContextTarget | null>(null);
  const [exportMsg, setExportMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [history, setHistory] = useState<string[]>(loadHistory);
  const [sortMode, setSortMode] = useState<SortMode>('match');
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleExport = async (format: 'csv' | 'txt') => {
    const result = format === 'csv'
      ? await exportSearchResultsCsv(sortedResults, query)
      : await exportSearchResultsTxt(sortedResults, query);
    const parsed = parseExportResult(result);
    setExportMsg(parsed);
    setTimeout(() => setExportMsg(null), 4000);
  };

  const searchType = includeContacts && includeGroups ? 'all' : includeContacts ? 'contact' : 'group';

  const addToHistory = useCallback((q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setHistory(prev => {
      const next = [trimmed, ...prev.filter(h => h !== trimmed)].slice(0, MAX_HISTORY);
      saveHistory(next);
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => { setHistory([]); saveHistory([]); }, []);

  const removeHistoryItem = useCallback((item: string) => {
    setHistory(prev => { const next = prev.filter(h => h !== item); saveHistory(next); return next; });
  }, []);

  const doSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || !(includeContacts || includeGroups)) return;
    addToHistory(trimmed);
    setLoading(true);
    setSearched(false);
    try {
      const data = await searchApi.global(trimmed, searchType);
      setResults(data ?? []);
      setSearched(true);
    } catch {
      setResults([]);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  }, [includeContacts, includeGroups, searchType, addToHistory]);

  // 即输即搜（500ms debounce）
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length >= 2) {
      debounceRef.current = setTimeout(() => doSearch(query), 500);
    }
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, doSearch]);

  const findContact = (username: string) => contacts.find((c) => c.username === username);

  // 过滤 + 时间范围
  const visibleResults = useMemo(() => {
    let filtered = results.filter((g) =>
      g.is_group ? !blockedGroups.includes(g.username) : findContact(g.username) != null
    );
    // 时间范围过滤（基于消息日期）
    if (dateFrom || dateTo) {
      filtered = filtered.map(g => {
        const msgs = g.messages.filter(m => {
          if (!m.date) return true;
          if (dateFrom && m.date < dateFrom) return false;
          if (dateTo && m.date > dateTo) return false;
          return true;
        });
        return msgs.length > 0 ? { ...g, messages: msgs } : null;
      }).filter(Boolean) as GlobalSearchGroup[];
    }
    return filtered;
  }, [results, blockedGroups, contacts, dateFrom, dateTo]);

  // 排序
  const sortedResults = useMemo(() => {
    const list = [...visibleResults];
    switch (sortMode) {
      case 'match': list.sort((a, b) => b.messages.length - a.messages.length); break;
      case 'time': list.sort((a, b) => {
        const lastA = a.messages[a.messages.length - 1]?.date ?? '';
        const lastB = b.messages[b.messages.length - 1]?.date ?? '';
        return lastB.localeCompare(lastA);
      }); break;
      case 'total': list.sort((a, b) => {
        const ca = findContact(a.username);
        const cb = findContact(b.username);
        return (cb?.total_messages ?? 0) - (ca?.total_messages ?? 0);
      }); break;
    }
    return list;
  }, [visibleResults, sortMode, contacts]);

  const totalMsgs = sortedResults.reduce((s, g) => s + g.messages.length, 0);
  const contactCount = sortedResults.filter(g => !g.is_group).length;
  const groupCount = sortedResults.filter(g => g.is_group).length;

  // Top 5 匹配
  const top5 = useMemo(() =>
    [...sortedResults].sort((a, b) => b.messages.length - a.messages.length).slice(0, 5),
    [sortedResults]
  );

  return (
    <div className="max-w-3xl">
      {/* 标题 */}
      <div className="mb-6">
        <h1 className="dk-text text-3xl sm:text-5xl font-black tracking-tight text-[#1d1d1f] mb-1">全局搜索</h1>
        <p className="text-gray-400 text-sm">跨所有联系人和群聊搜索聊天记录，输入 2 字以上自动搜索</p>
      </div>

      {/* 搜索框 */}
      <form onSubmit={(e) => { e.preventDefault(); doSearch(query); }} className="flex gap-2 mb-3">
        <div className="flex-1 relative">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" strokeWidth={2.5} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索关键词，如：生日快乐、在吗、谢谢..."
            className="w-full pl-11 pr-4 py-3 rounded-2xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#07c160]/20 focus:border-[#07c160] transition-all bg-white dk-card dk-border"
            autoFocus
          />
          {query && (
            <button onClick={() => { setQuery(''); setResults([]); setSearched(false); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
              <X size={14} />
            </button>
          )}
        </div>
        <button
          type="submit"
          disabled={!query.trim() || loading}
          className="px-6 py-3 bg-[#07c160] text-white rounded-2xl text-sm font-bold disabled:opacity-40 hover:bg-[#06ad56] transition-colors flex-shrink-0"
        >
          搜索
        </button>
      </form>

      {/* 搜索范围 + 时间筛选 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setIncludeContacts(v => !v)}
            className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all select-none ${includeContacts ? 'bg-[#07c160] text-white border-[#07c160]' : 'bg-white dark:bg-white/5 text-gray-400 border-gray-200'}`}>
            私聊
          </button>
          <button type="button" onClick={() => setIncludeGroups(v => !v)}
            className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all select-none ${includeGroups ? 'bg-[#07c160] text-white border-[#07c160]' : 'bg-white dark:bg-white/5 text-gray-400 border-gray-200'}`}>
            群聊
          </button>
        </div>
        <button onClick={() => setShowDateFilter(v => !v)}
          className={`flex items-center gap-1 text-xs transition-colors ${showDateFilter ? 'text-[#07c160] font-bold' : 'text-gray-400 hover:text-[#07c160]'}`}>
          <Calendar size={12} />
          {showDateFilter ? '隐藏时间筛选' : '时间筛选'}
        </button>
      </div>

      {/* 时间范围 */}
      {showDateFilter && (
        <div className="flex flex-wrap items-center gap-2 mb-4 p-3 bg-[#f8f9fb] dark:bg-white/5 rounded-xl">
          <div className="flex gap-1">
            {[
              { label: '最近一周', days: 7 },
              { label: '最近一月', days: 30 },
              { label: '最近三月', days: 90 },
              { label: '最近一年', days: 365 },
              { label: '全部', days: 0 },
            ].map(p => (
              <button key={p.label} onClick={() => {
                if (p.days === 0) { setDateFrom(''); setDateTo(''); }
                else {
                  const to = new Date().toISOString().slice(0, 10);
                  const from = new Date(Date.now() - p.days * 86400000).toISOString().slice(0, 10);
                  setDateFrom(from); setDateTo(to);
                }
              }}
                className="px-2 py-1 rounded-lg text-[10px] font-bold bg-white dark:bg-gray-800 text-gray-500 hover:bg-[#e7f8f0] hover:text-[#07c160] transition-colors">
                {p.label}
              </button>
            ))}
          </div>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1 dk-input" />
          <span className="text-xs text-gray-400">至</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1 dk-input" />
        </div>
      )}

      {/* 热门搜索 + 搜索历史 */}
      {!loading && !searched && (
        <div className="space-y-6">
          {history.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-1.5 text-xs font-bold text-gray-400"><Clock size={12} /> 搜索历史</div>
                <button onClick={clearHistory} className="text-[10px] text-gray-300 hover:text-red-400 transition-colors">清除全部</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {history.map(item => (
                  <span key={item} className="group inline-flex items-center gap-1 pl-3 pr-1.5 py-1.5 rounded-full text-sm bg-white dark:bg-white/5 border border-gray-200 dark:border-gray-700 hover:border-[#07c160] hover:text-[#07c160] transition-all cursor-pointer">
                    <span onClick={() => { setQuery(item); doSearch(item); }}>{item}</span>
                    <button onClick={(e) => { e.stopPropagation(); removeHistoryItem(item); }}
                      className="p-0.5 rounded-full text-gray-300 hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all">
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="flex items-center gap-1.5 text-xs font-bold text-gray-400 mb-2.5"><Sparkles size={12} /> 试试搜索</div>
            <div className="flex flex-wrap gap-2">
              {HOT_KEYWORDS.map(kw => (
                <button key={kw} onClick={() => { setQuery(kw); doSearch(kw); }}
                  className="px-3 py-1.5 rounded-full text-sm bg-[#f8f9fb] dark:bg-white/5 text-gray-500 hover:bg-[#e7f8f0] hover:text-[#07c160] border border-transparent hover:border-[#07c160]/30 transition-all">
                  {kw}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex flex-col items-center justify-center h-48 gap-3">
          <Loader2 size={32} className="text-[#07c160] animate-spin" />
          <p className="text-xs text-gray-400">正在搜索，群聊数据量大可能需要几秒...</p>
        </div>
      )}

      {/* 空结果 + 建议 */}
      {!loading && searched && sortedResults.length === 0 && (
        <div className="text-center py-16 space-y-3">
          <p className="text-gray-300 font-semibold">没有找到「{query}」的相关消息</p>
          <div className="text-xs text-gray-400 space-y-1">
            <p>试试：缩短关键词、换个近义词、或扩大时间范围</p>
            {(dateFrom || dateTo) && (
              <button onClick={() => { setDateFrom(''); setDateTo(''); }}
                className="text-[#07c160] underline">清除时间筛选重新搜索</button>
            )}
          </div>
        </div>
      )}

      {/* 搜索结果 */}
      {!loading && sortedResults.length > 0 && (
        <>
          {/* 统计摘要条 */}
          <div className="bg-[#f8f9fb] dark:bg-white/5 rounded-2xl p-4 mb-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-gray-500">
                找到 <span className="font-bold text-[#07c160]">{totalMsgs}</span> 条消息
                {contactCount > 0 && <span>，<span className="font-bold">{contactCount}</span> 位联系人</span>}
                {groupCount > 0 && <span>，<span className="font-bold">{groupCount}</span> 个群聊</span>}
              </p>
              <div className="flex items-center gap-2">
                {/* 排序 */}
                <div className="flex items-center gap-1">
                  <ArrowUpDown size={10} className="text-gray-400" />
                  {([['match', '匹配数'], ['time', '最新'], ['total', '消息量']] as const).map(([key, label]) => (
                    <button key={key} onClick={() => setSortMode(key)}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-all ${sortMode === key ? 'bg-[#07c160] text-white' : 'text-gray-400 hover:bg-gray-200'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                {/* 导出 */}
                <div className="flex items-center gap-1 border-l border-gray-200 dark:border-gray-700 pl-2 ml-1">
                  <Download size={10} className="text-gray-300" />
                  <button onClick={() => handleExport('csv')} className="text-[10px] text-gray-400 hover:text-[#07c160] font-medium">CSV</button>
                  <button onClick={() => handleExport('txt')} className="text-[10px] text-gray-400 hover:text-[#07c160] font-medium">TXT</button>
                </div>
              </div>
            </div>
            {exportMsg && (
              <p className={`text-[10px] ${exportMsg.ok ? 'text-[#07c160]' : 'text-red-500'}`}>{exportMsg.ok ? '✓' : '✕'} {exportMsg.message}</p>
            )}

            {/* Top 5 迷你柱状图 */}
            {top5.length > 1 && (
              <div className="flex items-end gap-1.5 mt-2 h-8">
                {top5.map(g => {
                  const pct = Math.max(15, (g.messages.length / top5[0].messages.length) * 100);
                  return (
                    <div key={g.username} className="flex-1 flex flex-col items-center gap-0.5" title={`${g.display_name}: ${g.messages.length} 条`}>
                      <div className="w-full bg-[#07c160] rounded-t-sm transition-all" style={{ height: `${pct}%`, minHeight: 4 }} />
                      <span className={`text-[8px] text-gray-400 truncate w-full text-center ${privacyMode ? 'privacy-blur' : ''}`}>
                        {g.display_name.length > 4 ? g.display_name.slice(0, 4) + '..' : g.display_name}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 结果列表 */}
          <div className="space-y-3">
            {sortedResults.map((group) => {
              const contact = findContact(group.username);
              const clickable = group.is_group ? !!onGroupClick : !!(contact && onContactClick);
              return (
                <div key={group.username} className="dk-card bg-white dk-border border border-gray-100 rounded-2xl overflow-hidden">
                  <div
                    className={`flex items-center gap-3 px-5 py-3 bg-[#f8f9fb] dk-subtle border-b border-gray-100 dk-border ${clickable ? 'cursor-pointer hover:bg-[#eef8f4] dark:hover:bg-[#07c160]/10 transition-colors' : ''}`}
                    onClick={() => { if (group.is_group) onGroupClick?.(group.username); else if (contact) onContactClick?.(contact); }}
                  >
                    <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 ring-1 ring-gray-200">
                      {group.small_head_url ? (
                        <img src={avatarSrc(group.small_head_url)} alt="" className="w-full h-full object-cover"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      ) : (
                        <div className={`w-full h-full flex items-center justify-center text-white text-xs font-black
                          ${group.is_group ? 'bg-gradient-to-br from-[#576b95] to-[#3d4f77]' : 'bg-gradient-to-br from-[#07c160] to-[#06ad56]'}`}>
                          {group.is_group ? <Users size={14} /> : group.display_name.charAt(0)}
                        </div>
                      )}
                    </div>
                    <span className={`font-bold text-sm dk-text text-[#1d1d1f]${privacyMode ? ' privacy-blur' : ''}`}>
                      {group.display_name}
                    </span>
                    {group.is_group && (
                      <span className="text-[10px] font-bold text-[#576b95] bg-[#576b9520] px-1.5 py-0.5 rounded-full">群</span>
                    )}
                    <span className="ml-auto text-xs text-gray-400">{group.messages.length} 条</span>
                    {clickable && <ChevronRight size={14} className="text-gray-300 flex-shrink-0" />}
                  </div>

                  <div className="divide-y divide-gray-50 dark:divide-white/5">
                    {group.messages.map((msg, i) => (
                      <div
                        key={i}
                        className={`px-5 py-3 flex gap-3 cursor-pointer hover:bg-[#f8f9fb] dark:hover:bg-white/5 transition-colors ${msg.is_mine ? 'flex-row-reverse' : 'flex-row'}`}
                        onClick={() => msg.date && setContextTarget({
                          username: group.username,
                          displayName: group.display_name,
                          date: msg.date,
                          targetTime: msg.time,
                          targetContent: msg.content,
                          isGroup: group.is_group,
                        })}
                        title="点击查看当天完整对话"
                      >
                        <div className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-white text-[9px] font-black mt-0.5 ${msg.is_mine ? 'bg-[#07c160]' : 'bg-[#576b95]'}`}>
                          {msg.is_mine ? '我' : group.is_group ? <Users size={10} /> : group.display_name.charAt(0)}
                        </div>
                        <div className={`flex flex-col gap-0.5 max-w-[80%] ${msg.is_mine ? 'items-end' : 'items-start'}`}>
                          <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed break-words whitespace-pre-wrap
                            ${msg.is_mine ? 'bg-[#07c160] text-white rounded-br-sm' : 'bg-[#f0f0f0] dark:bg-white/10 text-[#1d1d1f] dark:text-gray-100 rounded-bl-sm'}`}>
                            <HighlightText text={msg.content} keyword={query} />
                          </div>
                          <span className="text-[10px] text-gray-300 px-1">{msg.date} {msg.time}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {contextTarget && (
        <SearchContextModal {...contextTarget} onClose={() => setContextTarget(null)} />
      )}
    </div>
  );
};

const HighlightText: React.FC<{ text: string; keyword: string }> = ({ text, keyword }) => {
  if (!keyword.trim()) return <>{text}</>;
  const parts = text.split(new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === keyword.toLowerCase()
          ? <mark key={i} className="bg-yellow-200 dark:bg-yellow-500/40 text-[#1d1d1f] dark:text-gray-100 rounded px-0.5">{part}</mark>
          : part
      )}
    </>
  );
};
