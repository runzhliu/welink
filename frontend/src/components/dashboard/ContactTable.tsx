/**
 * 联系人表格组件
 */

import React, { useState } from 'react';
import { MessageCircle, Clock, TrendingUp, Users, ChevronUp, ChevronDown } from 'lucide-react';
import type { ContactStats } from '../../types';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';

interface ContactTableProps {
  contacts: ContactStats[];
  onContactClick: (contact: ContactStats) => void;
}

type SortKey = 'name' | 'total_messages' | 'shared_groups' | 'last_message_time' | 'status' | 'peak_monthly' | 'recent_monthly' | 'avg_msg_len';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

const getStatusTier = (contact: ContactStats): 0 | 1 | 2 | 3 | 4 => {
  if (contact.total_messages === 0) return 4;
  const days = (Date.now() - new Date(contact.last_message_time).getTime()) / 86400000;
  if (days < 7)   return 0;
  if (days < 30)  return 1;
  if (days < 180) return 2;
  return 3;
};

const STATUS_BADGES = [
  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-[#e7f8f0] text-[#07c160]">活跃</span>,
  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-[#f0fce8] text-[#7bc934]">温热</span>,
  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-orange-50 text-[#ff9500]">渐冷</span>,
  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-[#eef1f7] text-[#576b95]">沉寂</span>,
  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-400">零消息</span>,
];

const getStatusBadge = (contact: ContactStats) => STATUS_BADGES[getStatusTier(contact)];

export const ContactTable: React.FC<ContactTableProps> = ({ contacts, onContactClick }) => {
  const { privacyMode } = usePrivacyMode();
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [sortKey, setSortKey] = useState<SortKey>('total_messages');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
    setCurrentPage(1);
  };

  const sorted = [...contacts].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case 'name':
        cmp = (a.remark || a.nickname || a.username).localeCompare(b.remark || b.nickname || b.username, 'zh');
        break;
      case 'total_messages':
        cmp = a.total_messages - b.total_messages;
        break;
      case 'shared_groups':
        cmp = (a.shared_groups_count ?? 0) - (b.shared_groups_count ?? 0);
        break;
      case 'last_message_time':
        cmp = (a.last_message_time || '').localeCompare(b.last_message_time || '');
        break;
      case 'peak_monthly':
        cmp = (a.peak_monthly ?? 0) - (b.peak_monthly ?? 0);
        break;
      case 'recent_monthly':
        cmp = (a.recent_monthly ?? 0) - (b.recent_monthly ?? 0);
        break;
      case 'avg_msg_len':
        cmp = (a.avg_msg_len ?? 0) - (b.avg_msg_len ?? 0);
        break;
      case 'status':
        cmp = getStatusTier(a) - getStatusTier(b);
        break;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const totalPages = Math.ceil(sorted.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentContacts = sorted.slice(startIndex, startIndex + itemsPerPage);

  const handlePageSizeChange = (size: number) => {
    setItemsPerPage(size);
    setCurrentPage(1);
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <span className="opacity-20 ml-1"><ChevronUp size={11} /></span>;
    return sortDir === 'asc'
      ? <ChevronUp size={11} className="ml-1 text-[#07c160]" />
      : <ChevronDown size={11} className="ml-1 text-[#07c160]" />;
  };

  const thClass = "px-8 py-5 text-left text-xs font-black text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-[#07c160] transition-colors";

  return (
    <div className="bg-white rounded-2xl sm:rounded-3xl border border-gray-100 overflow-hidden">
      {/* 桌面表格 */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="dk-thead bg-[#f8f9fb] dk-border border-b border-gray-100">
              <th className={thClass} onClick={() => handleSort('name')}>
                <div className="flex items-center">联系人<SortIcon col="name" /></div>
              </th>
              <th className={thClass} onClick={() => handleSort('total_messages')}>
                <div className="flex items-center gap-1"><MessageCircle size={14} />消息总数<SortIcon col="total_messages" /></div>
              </th>
              <th className={thClass} onClick={() => handleSort('shared_groups')}>
                <div className="flex items-center gap-1"><Users size={14} />共同群聊<SortIcon col="shared_groups" /></div>
              </th>
              <th className={thClass} onClick={() => handleSort('peak_monthly')}>
                <div className="flex items-center gap-1"><TrendingUp size={14} />历史峰值月<SortIcon col="peak_monthly" /></div>
              </th>
              <th className={thClass} onClick={() => handleSort('recent_monthly')}>
                <div className="flex items-center gap-1"><Clock size={14} />近一个月<SortIcon col="recent_monthly" /></div>
              </th>
              <th className={thClass} onClick={() => handleSort('avg_msg_len')}>
                <div className="flex items-center gap-1">均消息长<SortIcon col="avg_msg_len" /></div>
              </th>
              <th className={thClass} onClick={() => handleSort('last_message_time')}>
                <div className="flex items-center gap-1">最后联系<SortIcon col="last_message_time" /></div>
              </th>
              <th className={thClass} onClick={() => handleSort('status')}>
                <div className="flex items-center gap-1">状态<SortIcon col="status" /></div>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {currentContacts.map((contact) => (
              <tr
                key={contact.username}
                onClick={() => onContactClick(contact)}
                className="dk-row-hover hover:bg-[#f8f9fb] cursor-pointer transition-colors duration-150"
              >
                <td className="px-8 py-5">
                  <div className="flex items-center gap-3">
                    {(contact.small_head_url || contact.big_head_url) ? (
                      <img src={contact.small_head_url || contact.big_head_url} alt="" className="w-9 h-9 rounded-xl object-cover flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display='none'; }} />
                    ) : (
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#07c160] to-[#06ad56] flex items-center justify-center text-white text-sm font-black flex-shrink-0">
                        {(contact.remark || contact.nickname || contact.username).charAt(0)}
                      </div>
                    )}
                    <div>
                      <div className={`font-bold text-[#1d1d1f]${privacyMode ? ' privacy-blur' : ''}`}>{contact.remark || contact.nickname || contact.username}</div>
                      {contact.remark && contact.nickname && (
                        <div className={`text-xs text-gray-400 mt-0.5${privacyMode ? ' privacy-blur' : ''}`}>{contact.nickname}</div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-8 py-5">
                  <span className="font-bold text-[#1d1d1f]">{contact.total_messages.toLocaleString()}</span>
                </td>
                <td className="px-8 py-5">
                  {(contact.shared_groups_count ?? 0) > 0 ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-600">
                      <Users size={11} />{contact.shared_groups_count}
                    </span>
                  ) : (
                    <span className="text-sm text-gray-300">-</span>
                  )}
                </td>
                <td className="px-8 py-5">
                  {(contact.peak_monthly ?? 0) > 0 ? (
                    <div>
                      <span className="font-bold text-[#1d1d1f]">{contact.peak_monthly!.toLocaleString()}</span>
                      <span className="text-xs text-gray-400 ml-1">条</span>
                      {contact.peak_period && (
                        <div className="text-[10px] text-gray-400 mt-0.5">{contact.peak_period}</div>
                      )}
                    </div>
                  ) : (
                    <span className="text-sm text-gray-300">-</span>
                  )}
                </td>
                <td className="px-8 py-5">
                  {(contact.recent_monthly ?? 0) > 0 ? (
                    <span className="font-bold text-[#07c160]">{contact.recent_monthly!.toLocaleString()}<span className="text-xs text-gray-400 ml-1 font-normal">条</span></span>
                  ) : (
                    <span className="text-sm text-gray-300">0</span>
                  )}
                </td>
                <td className="px-8 py-5">
                  {(contact.avg_msg_len ?? 0) > 0 ? (
                    <span className="font-bold text-[#1d1d1f]">{contact.avg_msg_len!.toFixed(1)}<span className="text-xs text-gray-400 ml-1 font-normal">字</span></span>
                  ) : (
                    <span className="text-sm text-gray-300">-</span>
                  )}
                </td>
                <td className="px-8 py-5">
                  <span className="text-sm font-medium text-gray-600">{contact.last_message_time || '-'}</span>
                </td>
                <td className="px-8 py-5">{getStatusBadge(contact)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 手机卡片列表 */}
      <div className="sm:hidden divide-y divide-gray-100">
        {currentContacts.map((contact) => (
          <div
            key={contact.username}
            onClick={() => onContactClick(contact)}
            className="dk-row-hover flex items-center justify-between px-4 py-4 active:bg-[#f8f9fb] cursor-pointer"
          >
            <div className="flex items-center gap-3 min-w-0">
              {(contact.small_head_url || contact.big_head_url) ? (
                <img src={contact.small_head_url || contact.big_head_url} alt="" className="w-10 h-10 rounded-xl object-cover flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display='none'; }} />
              ) : (
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#07c160] to-[#06ad56] flex items-center justify-center text-white text-sm font-black flex-shrink-0">
                  {(contact.remark || contact.nickname || contact.username).charAt(0)}
                </div>
              )}
              <div className="min-w-0">
                <div className={`font-bold text-[#1d1d1f] truncate${privacyMode ? ' privacy-blur' : ''}`}>{contact.remark || contact.nickname || contact.username}</div>
                <div className="text-xs text-gray-400 mt-0.5">{contact.last_message_time || '-'}</div>
              </div>
            </div>
            <div className="flex items-center gap-3 ml-3 flex-shrink-0">
              <span className="text-sm font-bold text-[#1d1d1f]">{contact.total_messages.toLocaleString()}</span>
              {getStatusBadge(contact)}
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      <div className="dk-thead dk-border px-4 sm:px-8 py-4 sm:py-5 bg-[#f8f9fb] border-t border-gray-100 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-xs sm:text-sm text-gray-600 font-medium">
            {startIndex + 1}–{Math.min(startIndex + itemsPerPage, sorted.length)} / {sorted.length}
          </span>
          {/* 每页条数选择 */}
          <div className="hidden sm:flex items-center gap-1">
            {PAGE_SIZE_OPTIONS.map(size => (
              <button
                key={size}
                onClick={() => handlePageSizeChange(size)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                  itemsPerPage === size
                    ? 'bg-[#07c160] text-white'
                    : 'text-gray-400 hover:bg-white hover:text-gray-600'
                }`}
              >
                {size}
              </button>
            ))}
            <span className="text-xs text-gray-300 ml-1">条/页</span>
          </div>
        </div>

        <div className="flex gap-1 sm:gap-2">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="px-3 sm:px-4 py-2 rounded-xl font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white"
          >
            上一页
          </button>
          <div className="hidden sm:flex items-center gap-1">
            {(() => {
              const pages: (number | '...')[] = [];
              const delta = 2;
              const left = currentPage - delta;
              const right = currentPage + delta;
              let last = 0;
              for (let p = 1; p <= totalPages; p++) {
                if (p === 1 || p === totalPages || (p >= left && p <= right)) {
                  if (last && p - last > 1) pages.push('...');
                  pages.push(p);
                  last = p;
                }
              }
              return pages.map((p, idx) =>
                p === '...' ? (
                  <span key={`ellipsis-${idx}`} className="w-8 text-center text-gray-400 text-sm">…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setCurrentPage(p as number)}
                    className={`w-10 h-10 rounded-xl font-bold text-sm transition-all ${
                      currentPage === p ? 'bg-[#07c160] text-white shadow-lg shadow-green-100/50' : 'hover:bg-white hover:shadow-sm'
                    }`}
                  >
                    {p}
                  </button>
                )
              );
            })()}
          </div>
          <span className="sm:hidden flex items-center text-sm text-gray-500 px-2">{currentPage}/{totalPages}</span>
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="px-3 sm:px-4 py-2 rounded-xl font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white"
          >
            下一页
          </button>
        </div>
      </div>
    </div>
  );
};
