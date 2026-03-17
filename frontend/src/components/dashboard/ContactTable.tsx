/**
 * 联系人表格组件
 */

import React, { useState } from 'react';
import { MessageCircle, Clock, TrendingUp } from 'lucide-react';
import type { ContactStats } from '../../types';

interface ContactTableProps {
  contacts: ContactStats[];
  onContactClick: (contact: ContactStats) => void;
}

export const ContactTable: React.FC<ContactTableProps> = ({
  contacts,
  onContactClick,
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const totalPages = Math.ceil(contacts.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentContacts = contacts.slice(startIndex, endIndex);

  const getStatusBadge = (contact: ContactStats) => {
    const daysSince = Math.floor(
      (Date.now() - new Date(contact.last_message_time).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (contact.total_messages === 0)
      return <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-500">冷淡</span>;
    if (daysSince < 7)
      return <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-[#e7f8f0] text-[#07c160]">活跃</span>;
    return <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-orange-50 text-[#ff9500]">温热</span>;
  };

  return (
    <div className="bg-white rounded-2xl sm:rounded-3xl border border-gray-100 overflow-hidden">
      {/* 桌面表格 */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="dk-thead bg-[#f8f9fb] dk-border border-b border-gray-100">
              <th className="px-8 py-5 text-left text-xs font-black text-gray-500 uppercase tracking-wider">联系人</th>
              <th className="px-8 py-5 text-left text-xs font-black text-gray-500 uppercase tracking-wider">
                <div className="flex items-center gap-2"><MessageCircle size={14} />消息总数</div>
              </th>
              <th className="px-8 py-5 text-left text-xs font-black text-gray-500 uppercase tracking-wider">
                <div className="flex items-center gap-2"><Clock size={14} />最后联系</div>
              </th>
              <th className="px-8 py-5 text-left text-xs font-black text-gray-500 uppercase tracking-wider">
                <div className="flex items-center gap-2"><TrendingUp size={14} />状态</div>
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
                      <div className="font-bold text-[#1d1d1f]">{contact.remark || contact.nickname || contact.username}</div>
                      {contact.remark && contact.nickname && (
                        <div className="text-xs text-gray-400 mt-0.5">{contact.nickname}</div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-8 py-5">
                  <span className="font-bold text-[#1d1d1f]">{contact.total_messages.toLocaleString()}</span>
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
                <div className="font-bold text-[#1d1d1f] truncate">
                  {contact.remark || contact.nickname || contact.username}
                </div>
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
      {totalPages > 1 && (
        <div className="dk-thead dk-border px-4 sm:px-8 py-4 sm:py-5 bg-[#f8f9fb] border-t border-gray-100 flex items-center justify-between">
          <div className="text-xs sm:text-sm text-gray-600 font-medium">
            {startIndex + 1}–{Math.min(endIndex, contacts.length)} / {contacts.length}
          </div>
          <div className="flex gap-1 sm:gap-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
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
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 sm:px-4 py-2 rounded-xl font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white"
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
