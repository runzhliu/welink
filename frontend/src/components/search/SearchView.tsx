/**
 * 全局跨联系人/群聊消息搜索
 */

import React, { useState, useRef } from 'react';
import { Search, Loader2, ChevronRight, Users } from 'lucide-react';
import type { GlobalSearchGroup, ContactStats } from '../../types';
import { searchApi } from '../../services/api';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';

interface Props {
  contacts: ContactStats[];
  onContactClick?: (contact: ContactStats) => void;
  onGroupClick?: (username: string) => void;
  blockedGroups?: string[];
}

export const SearchView: React.FC<Props> = ({ contacts, onContactClick, onGroupClick, blockedGroups = [] }) => {
  const { privacyMode } = usePrivacyMode();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GlobalSearchGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [includeContacts, setIncludeContacts] = useState(true);
  const [includeGroups, setIncludeGroups] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const searchType = includeContacts && includeGroups ? 'all' : includeContacts ? 'contact' : 'group';
  const canSearch = query.trim() && (includeContacts || includeGroups);

  const handleSearch = async (q: string) => {
    if (!canSearch) return;
    setLoading(true);
    setSearched(false);
    try {
      const data = await searchApi.global(q.trim(), searchType);
      setResults(data ?? []);
      setSearched(true);
    } catch {
      setResults([]);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  };

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

      {/* 搜索范围 checkbox */}
      <div className="flex items-center gap-5 mb-8">
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeContacts}
            onChange={(e) => setIncludeContacts(e.target.checked)}
            className="w-4 h-4 accent-[#07c160] rounded"
          />
          <span className="text-sm text-gray-600">私聊</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeGroups}
            onChange={(e) => setIncludeGroups(e.target.checked)}
            className="w-4 h-4 accent-[#07c160] rounded"
          />
          <span className="text-sm text-gray-600">群聊</span>
        </label>
      </div>

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
          <p className="text-xs text-gray-400 mb-4">
            找到约 <span className="font-bold text-gray-600">{totalMsgs}</span> 条消息
            {contactCount > 0 && <span>，<span className="font-bold text-gray-600">{contactCount}</span> 位联系人</span>}
            {groupCount > 0 && <span>，<span className="font-bold text-gray-600">{groupCount}</span> 个群聊</span>}
            （每个最多显示 5 条）
          </p>

          <div className="space-y-3">
            {visibleResults.map((group) => {
              const contact = findContact(group.username);
              const clickable = group.is_group ? !!onGroupClick : !!(contact && onContactClick);
              return (
                <div key={group.username} className="dk-card bg-white dk-border border border-gray-100 rounded-2xl overflow-hidden">
                  {/* 头部 */}
                  <div
                    className={`flex items-center gap-3 px-5 py-3 bg-[#f8f9fb] border-b border-gray-100 ${clickable ? 'cursor-pointer hover:bg-[#eef8f4] transition-colors' : ''}`}
                    onClick={() => {
                      if (group.is_group) onGroupClick?.(group.username);
                      else if (contact) onContactClick?.(contact);
                    }}
                  >
                    <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 ring-1 ring-gray-200">
                      {group.small_head_url ? (
                        <img src={group.small_head_url} alt="" className="w-full h-full object-cover"
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
                  <div className="divide-y divide-gray-50">
                    {group.messages.map((msg, i) => (
                      <div key={i} className={`px-5 py-3 flex gap-3 ${msg.is_mine ? 'flex-row-reverse' : 'flex-row'}`}>
                        <div
                          className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-white text-[9px] font-black mt-0.5
                            ${msg.is_mine ? 'bg-[#07c160]' : group.is_group ? 'bg-[#576b95]' : 'bg-[#576b95] cursor-pointer hover:opacity-80 transition-opacity'}`}
                          onClick={!msg.is_mine && !group.is_group && contact ? () => onContactClick?.(contact) : undefined}
                          title={!msg.is_mine ? group.display_name : undefined}
                        >
                          {msg.is_mine ? '我' : group.is_group ? <Users size={10} /> : group.display_name.charAt(0)}
                        </div>
                        <div className={`flex flex-col gap-0.5 max-w-[80%] ${msg.is_mine ? 'items-end' : 'items-start'}`}>
                          <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed break-words whitespace-pre-wrap
                            ${msg.is_mine ? 'bg-[#07c160] text-white rounded-br-sm' : 'bg-[#f0f0f0] text-[#1d1d1f] rounded-bl-sm'}`}>
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
          ? <mark key={i} className="bg-yellow-200 text-[#1d1d1f] rounded px-0.5">{part}</mark>
          : part
      )}
    </>
  );
};
