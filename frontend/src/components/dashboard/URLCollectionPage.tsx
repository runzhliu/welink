/**
 * URL 收藏夹 — 所有聊天中发过/收过的链接
 */

import React, { useEffect, useState, useMemo } from 'react';
import { Loader2, Link2, Search, ArrowUpRight, ArrowDownLeft, Download, User, Users, Calendar, X } from 'lucide-react';
import type { URLCollectionResult } from '../../types';
import { contactsApi } from '../../services/api';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';

const isWebView = () => {
  const ua = navigator.userAgent;
  return ua.includes('AppleWebKit') && !ua.includes('Safari') && !ua.includes('Chrome') && !ua.includes('Firefox');
};

const openExternal = (url: string) => {
  if (isWebView()) {
    fetch(`/api/open-url?url=${encodeURIComponent(url)}`);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
};

interface Props {
  blockedUsers?: string[];
  blockedDisplayNames?: Set<string>;
}

export const URLCollectionPage: React.FC<Props> = ({ blockedUsers = [], blockedDisplayNames }) => {
  const { privacyMode } = usePrivacyMode();
  const [rawData, setRawData] = useState<URLCollectionResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [domainFilter, setDomainFilter] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'contact' | 'group'>('all');
  const [directionFilter, setDirectionFilter] = useState<'all' | 'mine' | 'theirs'>('all');
  const [contactFilter, setContactFilter] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  useEffect(() => {
    let cancelled = false;
    contactsApi.getURLs().then(res => {
      if (!cancelled) { setRawData(res); setLoading(false); }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // 屏蔽过滤
  const data = useMemo(() => {
    if (!rawData) return null;
    const blockedUsernames = new Set(blockedUsers);
    const blockedNames = blockedDisplayNames ?? new Set<string>();
    if (blockedUsernames.size === 0 && blockedNames.size === 0) return rawData;
    const filteredUrls = rawData.urls.filter(u =>
      !blockedUsernames.has(u.username) && !blockedNames.has(u.contact)
    );
    // 重新计算 domain 分布
    const domainCount: Record<string, number> = {};
    for (const u of filteredUrls) {
      domainCount[u.domain] = (domainCount[u.domain] ?? 0) + 1;
    }
    return {
      total: filteredUrls.length,
      urls: filteredUrls,
      domains: domainCount,
    };
  }, [rawData, blockedUsers, blockedDisplayNames]);

  const topDomains = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.domains)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 15);
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.toLowerCase();
    return data.urls.filter(u => {
      const isGroup = u.username.endsWith('@chatroom');
      // 域名
      if (domainFilter && u.domain !== domainFilter) return false;
      // 来源类型
      if (sourceFilter === 'contact' && isGroup) return false;
      if (sourceFilter === 'group' && !isGroup) return false;
      // 方向
      if (directionFilter === 'mine' && !u.is_mine) return false;
      if (directionFilter === 'theirs' && u.is_mine) return false;
      // 联系人
      if (contactFilter && u.username !== contactFilter) return false;
      // 时间范围
      if (dateFrom && u.time.slice(0, 10) < dateFrom) return false;
      if (dateTo && u.time.slice(0, 10) > dateTo) return false;
      // 关键词
      if (!q) return true;
      return u.url.toLowerCase().includes(q) ||
        u.context.toLowerCase().includes(q) ||
        u.contact.toLowerCase().includes(q);
    });
  }, [data, search, domainFilter, sourceFilter, directionFilter, contactFilter, dateFrom, dateTo]);

  // 可用的联系人列表（按 URL 数量降序，top 30）
  const topContacts = useMemo(() => {
    if (!data) return [];
    const count: Record<string, { name: string; n: number; isGroup: boolean }> = {};
    for (const u of data.urls) {
      const k = u.username;
      if (!count[k]) count[k] = { name: u.contact, n: 0, isGroup: u.username.endsWith('@chatroom') };
      count[k].n++;
    }
    return Object.entries(count)
      .sort(([, a], [, b]) => b.n - a.n)
      .slice(0, 30)
      .map(([username, info]) => ({ username, ...info }));
  }, [data]);

  const hasActiveFilter = domainFilter !== null || sourceFilter !== 'all' ||
    directionFilter !== 'all' || contactFilter !== null || dateFrom || dateTo || search;

  const resetFilters = () => {
    setSearch('');
    setDomainFilter(null);
    setSourceFilter('all');
    setDirectionFilter('all');
    setContactFilter(null);
    setDateFrom('');
    setDateTo('');
  };

  const pageUrls = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page]);

  const totalPages = Math.ceil(filtered.length / pageSize);

  useEffect(() => { setPage(1); }, [search, domainFilter, sourceFilter, directionFilter, contactFilter, dateFrom, dateTo]);

  const exportCsv = () => {
    if (!data) return;
    const header = '时间,联系人,方向,域名,URL,消息原文\n';
    const rows = filtered.map(u =>
      [u.time, `"${u.contact.replace(/"/g, '""')}"`, u.is_mine ? '发出' : '收到', u.domain, `"${u.url}"`, `"${u.context.replace(/"/g, '""')}"`].join(',')
    ).join('\n');
    const blob = new Blob(['\uFEFF' + header + rows], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `welink_urls_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-3">
        <Loader2 size={32} className="text-[#07c160] animate-spin" />
        <div className="text-center">
          <p className="text-sm text-gray-400">正在扫描所有聊天中的链接…</p>
          <p className="text-[10px] text-gray-300 mt-1">消息量大时首次加载可能需要一些时间</p>
        </div>
      </div>
    );
  }

  if (!data || data.total === 0) {
    return (
      <div>
        <div className="mb-6 sm:mb-8">
          <h2 className="text-2xl font-black text-[#1d1d1f] dk-text mb-1">链接收藏夹</h2>
          <p className="text-sm text-gray-400">所有聊天中发过和收过的链接</p>
        </div>
        <div className="text-center text-gray-300 py-20">暂无链接记录</div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 sm:mb-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black text-[#1d1d1f] dk-text mb-1">链接收藏夹</h2>
          <p className="text-sm text-gray-400">共 {data.total.toLocaleString()} 个链接 · {Object.keys(data.domains).length} 个域名</p>
        </div>
        <button
          onClick={exportCsv}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-gray-100 dark:bg-white/10 text-gray-500 hover:bg-[#e7f8f0] hover:text-[#07c160] transition-all"
        >
          <Download size={13} /> 导出 CSV
        </button>
      </div>

      {/* 搜索 */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
        <input
          type="text"
          placeholder="搜索 URL 或消息内容..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-9 py-2.5 bg-white dk-input border border-gray-200 dk-border rounded-2xl text-sm focus:outline-none focus:border-[#07c160]"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
            <X size={14} />
          </button>
        )}
      </div>

      {/* 快速筛选行：来源类型 + 方向 + 高级筛选开关 */}
      <div className="flex flex-wrap items-center gap-3 mb-3 text-xs">
        <div className="flex items-center gap-1">
          <span className="text-gray-400">来源:</span>
          {([
            ['all', '全部'],
            ['contact', '私聊'],
            ['group', '群聊'],
          ] as const).map(([key, label]) => (
            <button key={key} onClick={() => setSourceFilter(key)}
              className={`px-2 py-0.5 rounded-lg font-bold transition-all ${
                sourceFilter === key ? 'bg-[#07c160] text-white' : 'bg-gray-100 dark:bg-white/10 text-gray-500 hover:bg-gray-200'
              }`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-gray-400">方向:</span>
          {([
            ['all', '全部'],
            ['mine', '我发出'],
            ['theirs', '我收到'],
          ] as const).map(([key, label]) => (
            <button key={key} onClick={() => setDirectionFilter(key)}
              className={`px-2 py-0.5 rounded-lg font-bold transition-all ${
                directionFilter === key ? 'bg-[#07c160] text-white' : 'bg-gray-100 dark:bg-white/10 text-gray-500 hover:bg-gray-200'
              }`}>
              {label}
            </button>
          ))}
        </div>
        <button onClick={() => setShowAdvanced(v => !v)}
          className={`px-2 py-0.5 rounded-lg font-bold transition-all ${
            showAdvanced ? 'bg-[#576b95] text-white' : 'text-gray-400 hover:text-[#07c160]'
          }`}>
          {showAdvanced ? '收起高级筛选' : '高级筛选'}
        </button>
        {hasActiveFilter && (
          <button onClick={resetFilters} className="text-red-400 hover:text-red-500 font-bold">
            重置全部
          </button>
        )}
      </div>

      {/* 高级筛选：时间范围 + 联系人 */}
      {showAdvanced && (
        <div className="mb-3 p-3 bg-[#f8f9fb] dark:bg-white/5 rounded-xl space-y-3">
          {/* 时间范围 */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="flex items-center gap-1 text-gray-400">
              <Calendar size={12} /> 时间:
            </div>
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
                  className="px-2 py-0.5 rounded-lg font-bold bg-white dark:bg-gray-800 text-gray-500 hover:bg-[#e7f8f0] hover:text-[#07c160]">
                  {p.label}
                </button>
              ))}
            </div>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="text-[11px] border border-gray-200 rounded-lg px-2 py-1 dk-input" />
            <span className="text-gray-300">~</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="text-[11px] border border-gray-200 rounded-lg px-2 py-1 dk-input" />
          </div>

          {/* 联系人/群聊快捷筛选 */}
          {topContacts.length > 0 && (
            <div>
              <div className="text-[10px] text-gray-400 mb-1.5">联系人/群聊 (按链接数排序):</div>
              <div className="flex flex-wrap gap-1.5">
                {topContacts.map(c => (
                  <button
                    key={c.username}
                    onClick={() => setContactFilter(c.username === contactFilter ? null : c.username)}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold transition-all truncate max-w-[200px] ${
                      contactFilter === c.username
                        ? 'bg-[#07c160] text-white'
                        : c.isGroup
                          ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-300 hover:bg-blue-100'
                          : 'bg-white dark:bg-gray-800 text-gray-500 hover:bg-[#e7f8f0] hover:text-[#07c160]'
                    }`}
                    title={`${c.name} · ${c.n} 个链接`}
                  >
                    {c.isGroup ? <Users size={9} /> : <User size={9} />}
                    <span className={`truncate ${privacyMode ? 'privacy-blur' : ''}`}>{c.name}</span>
                    <span className="opacity-60 font-normal">{c.n}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 域名快捷筛选 */}
      <div className="flex flex-wrap gap-1.5 mb-5">
        <button
          onClick={() => setDomainFilter(null)}
          className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
            domainFilter === null ? 'bg-[#07c160] text-white' : 'bg-gray-100 dark:bg-white/10 text-gray-500 hover:bg-gray-200'
          }`}
        >
          全部 {data.total}
        </button>
        {topDomains.map(([d, n]) => (
          <button
            key={d}
            onClick={() => setDomainFilter(d === domainFilter ? null : d)}
            className={`px-3 py-1 rounded-full text-xs font-bold transition-all truncate max-w-[200px] ${
              domainFilter === d ? 'bg-[#07c160] text-white' : 'bg-gray-100 dark:bg-white/10 text-gray-500 hover:bg-gray-200'
            }`}
            title={`${d} (${n} 个)`}
          >
            {d} <span className="opacity-60 font-normal">{n}</span>
          </button>
        ))}
      </div>

      {/* URL 列表 */}
      {filtered.length === 0 ? (
        <div className="text-center text-gray-300 py-12 text-sm">没有匹配的链接</div>
      ) : (
        <>
          <div className="space-y-2">
            {pageUrls.map((u, i) => (
              <div
                key={`${u.url}-${i}`}
                className="group bg-white dk-card border border-gray-100 dk-border rounded-2xl p-4 hover:border-[#07c160]/40 transition-all"
              >
                <div className="flex items-start gap-3">
                  <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
                    u.is_mine ? 'bg-blue-50 text-blue-500' : 'bg-green-50 text-[#07c160]'
                  }`}>
                    {u.is_mine ? <ArrowUpRight size={14} /> : <ArrowDownLeft size={14} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className={`text-xs font-bold text-[#1d1d1f] dk-text${privacyMode ? ' privacy-blur' : ''}`}>
                        {u.contact}
                      </span>
                      <span className="text-[10px] text-gray-300">{u.time}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/10 text-gray-500">
                        {u.domain}
                      </span>
                    </div>
                    <button
                      onClick={() => openExternal(u.url)}
                      className="text-sm text-[#07c160] hover:underline break-all text-left font-mono"
                    >
                      <Link2 size={11} className="inline mr-1" />
                      {u.url.length > 100 ? u.url.slice(0, 100) + '…' : u.url}
                    </button>
                    {u.context && u.context !== u.url && (
                      <div className="text-[11px] text-gray-400 mt-1 line-clamp-2">
                        {u.context}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-gray-100 dark:bg-white/10 disabled:opacity-40 hover:bg-gray-200"
              >
                上一页
              </button>
              <span className="text-xs text-gray-400">{page} / {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-gray-100 dark:bg-white/10 disabled:opacity-40 hover:bg-gray-200"
              >
                下一页
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
