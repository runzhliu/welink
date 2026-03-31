/**
 * 全局跨联系人/群聊消息搜索
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Search, Loader2, ChevronRight, Users, Download, Clock, X, Sparkles } from 'lucide-react';
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
  const inputRef = useRef<HTMLInputElement>(null);

  const handleExport = async (format: 'csv' | 'txt') => {
    const result = format === 'csv'
      ? await exportSearchResultsCsv(visibleResults, query)
      : await exportSearchResultsTxt(visibleResults, query);
    const parsed = parseExportResult(result);
    setExportMsg(parsed);
    setTimeout(() => setExportMsg(null), 4000);
  };

  const searchType = includeContacts && includeGroups ? 'all' : includeContacts ? 'contact' : 'group';
  const canSearch = query.trim() && (includeContacts || includeGroups);

  const addToHistory = useCallback((q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setHistory(prev => {
      const next = [trimmed, ...prev.filter(h => h !== trimmed)].slice(0, MAX_HISTORY);
      saveHistory(next);
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    saveHistory([]);
  }, []);

  const removeHistoryItem = useCallback((item: string) => {
    setHistory(prev => {
      const next = prev.filter(h => h !== item);
      saveHistory(next);
      return next;
    });
  }, []);

  const handleSearch = async (q: string) => {
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
  };

  const quickSearch = useCallback((keyword: string) => {
    setQuery(keyword);
    // defer to next tick so query state is set
    setTimeout(() => {
      const trimmed = keyword.trim();
      if (!trimmed) return;
      addToHistory(trimmed);
      setLoading(true);
      setSearched(false);
      const type = includeContacts && includeGroups ? 'all' : includeContacts ? 'contact' : 'group';
      searchApi.global(trimmed, type).then(data => {
        setResults(data ?? []);
        setSearched(true);
      }).catch(() => {
        setResults([]);
        setSearched(true);
      }).finally(() => setLoading(false));
    }, 0);
  }, [includeContacts, includeGroups, addToHistory]);

  const findContact = (username: string) =>
    contacts.find((c) => c.username === username);

  const visibleResults = results.filter((g) =>
    g.is_group
      ? !blockedGroups.includes(g.username)
      : findContact(g.username) != null
  );

  const totalMsgs = visibleResults.reduce((s, g) => s + g.messages.length, 0);
  const contactCount = visibleResults.filter(g => !g.is_group).length;
  const groupCount = visibleResults.filter(g => g.is_group).length;

  return (
    <div className="max-w-3xl">
      {/* 标题 */}
      <div className="mb-6">
        <h1 className="dk-text text-3xl sm:text-5xl font-black tracking-tight text-[#1d1d1f] mb-1">全局搜索</h1>
        <p className="text-gray-400 text-sm">跨所有联系人和群聊搜索聊天记录，每个最多显示 5 条匹配</p>
      </div>

      {/* 搜索框 */}
      <form
        onSubmit={(e) => { e.preventDefault(); handleSearch(query); }}
        className="flex gap-2 mb-3"
      >
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
        </div>
        <button
          type="submit"
          disabled={!canSearch || loading}
          className="px-6 py-3 bg-[#07c160] text-white rounded-2xl text-sm font-bold disabled:opacity-40 hover:bg-[#06ad56] transition-colors flex-shrink-0"
        >
          搜索
        </button>
      </form>

      {/* 搜索范围选择 */}
      <div className="flex items-center gap-2 mb-8">
        <button
          type="button"
          onClick={() => setIncludeContacts(v => !v)}
          className={`px-4 py-1.5 rounded-full text-sm font-semibold border transition-all select-none
            ${includeContacts
              ? 'bg-[#07c160] text-white border-[#07c160]'
              : 'bg-white dark:bg-white/5 text-gray-400 border-gray-200 hover:border-gray-300'}`}
        >
          私聊
        </button>
        <button
          type="button"
          onClick={() => setIncludeGroups(v => !v)}
          className={`px-4 py-1.5 rounded-full text-sm font-semibold border transition-all select-none
            ${includeGroups
              ? 'bg-[#07c160] text-white border-[#07c160]'
              : 'bg-white dark:bg-white/5 text-gray-400 border-gray-200 hover:border-gray-300'}`}
        >
          群聊
        </button>
        {includeGroups && (
          <span className="text-xs text-gray-400 ml-1">· 群聊数据量大，搜索可能需要较长时间</span>
        )}
      </div>

      {/* 热门搜索 + 搜索历史（未搜索或无结果时显示） */}
      {!loading && !searched && (
        <div className="space-y-6">
          {/* 搜索历史 */}
          {history.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-1.5 text-xs font-bold text-gray-400">
                  <Clock size={12} />
                  搜索历史
                </div>
                <button
                  onClick={clearHistory}
                  className="text-[10px] text-gray-300 hover:text-red-400 transition-colors"
                >
                  清除全部
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {history.map(item => (
                  <span key={item} className="group inline-flex items-center gap-1 pl-3 pr-1.5 py-1.5 rounded-full text-sm
                    bg-white dark:bg-white/5 border border-gray-200 dark:border-gray-700
                    hover:border-[#07c160] hover:text-[#07c160] transition-all cursor-pointer">
                    <span onClick={() => quickSearch(item)}>{item}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeHistoryItem(item); }}
                      className="p-0.5 rounded-full text-gray-300 hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 热门搜索词 */}
          <div>
            <div className="flex items-center gap-1.5 text-xs font-bold text-gray-400 mb-2.5">
              <Sparkles size={12} />
              试试搜索
            </div>
            <div className="flex flex-wrap gap-2">
              {HOT_KEYWORDS.map(kw => (
                <button
                  key={kw}
                  onClick={() => quickSearch(kw)}
                  className="px-3 py-1.5 rounded-full text-sm
                    bg-[#f8f9fb] dark:bg-white/5 text-gray-500 dark:text-gray-400
                    hover:bg-[#e7f8f0] hover:text-[#07c160] dark:hover:bg-[#07c160]/15
                    border border-transparent hover:border-[#07c160]/30
                    transition-all"
                >
                  {kw}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 状态 */}
      {loading && (
        <div className="flex items-center justify-center h-48">
          <Loader2 size={32} className="text-[#07c160] animate-spin" />
        </div>
      )}

      {!loading && searched && visibleResults.length === 0 && (
        <div className="text-center py-20 text-gray-300 font-semibold">没有找到相关消息</div>
      )}

      {!loading && visibleResults.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-gray-400">
              找到约 <span className="font-bold text-gray-600 dark:text-gray-300">{totalMsgs}</span> 条消息
              {contactCount > 0 && <span>，<span className="font-bold text-gray-600 dark:text-gray-300">{contactCount}</span> 位联系人</span>}
              {groupCount > 0 && <span>，<span className="font-bold text-gray-600 dark:text-gray-300">{groupCount}</span> 个群聊</span>}
              （每个最多显示 5 条）
            </p>
            <div className="flex items-center gap-1 flex-shrink-0 ml-3">
              <Download size={12} className="text-gray-300" />
              <button onClick={() => handleExport('csv')} className="text-xs text-gray-400 hover:text-[#07c160] font-medium px-2 py-1 rounded-lg hover:bg-[#f0faf4] dark:hover:bg-[#07c160]/10 transition-colors">CSV</button>
              <button onClick={() => handleExport('txt')} className="text-xs text-gray-400 hover:text-[#07c160] font-medium px-2 py-1 rounded-lg hover:bg-[#f0faf4] dark:hover:bg-[#07c160]/10 transition-colors">TXT</button>
              {exportMsg && (
                <span className={`text-[10px] font-medium ${exportMsg.ok ? 'text-[#07c160]' : 'text-red-500'}`}>
                  {exportMsg.ok ? '✓' : '✕'} {exportMsg.message}
                </span>
              )}
            </div>
          </div>

          <div className="space-y-3">
            {visibleResults.map((group) => {
              const contact = findContact(group.username);
              const clickable = group.is_group ? !!onGroupClick : !!(contact && onContactClick);
              return (
                <div key={group.username} className="dk-card bg-white dk-border border border-gray-100 rounded-2xl overflow-hidden">
                  {/* 头部 */}
                  <div
                    className={`flex items-center gap-3 px-5 py-3 bg-[#f8f9fb] dk-subtle border-b border-gray-100 dk-border ${clickable ? 'cursor-pointer hover:bg-[#eef8f4] dark:hover:bg-[#07c160]/10 transition-colors' : ''}`}
                    onClick={() => {
                      if (group.is_group) onGroupClick?.(group.username);
                      else if (contact) onContactClick?.(contact);
                    }}
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
                    {clickable && (
                      <ChevronRight size={14} className="text-gray-300 flex-shrink-0" />
                    )}
                  </div>

                  {/* 消息列表 */}
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
                        <div
                          className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-white text-[9px] font-black mt-0.5
                            ${msg.is_mine ? 'bg-[#07c160]' : 'bg-[#576b95]'}`}
                        >
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
        <SearchContextModal
          {...contextTarget}
          onClose={() => setContextTarget(null)}
        />
      )}
    </div>
  );
};

// 高亮关键词
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
