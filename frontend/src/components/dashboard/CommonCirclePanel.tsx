/**
 * 共同社交圈 — 选两个联系人，找共同群和共同好友
 */

import React, { useState, useMemo, useEffect } from 'react';
import { X, Users, Search, Loader2, UserCheck, ArrowLeftRight } from 'lucide-react';
import type { ContactStats, CommonCircleResult } from '../../types';
import { contactsApi } from '../../services/api';
import { avatarSrc } from '../../utils/avatar';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';

interface Props {
  contacts: ContactStats[];
  onClose: () => void;
}

export const CommonCirclePanel: React.FC<Props> = ({ contacts, onClose }) => {
  const { privacyMode } = usePrivacyMode();
  const [user1, setUser1] = useState<ContactStats | null>(null);
  const [user2, setUser2] = useState<ContactStats | null>(null);
  const [search1, setSearch1] = useState('');
  const [search2, setSearch2] = useState('');
  const [data, setData] = useState<CommonCircleResult | null>(null);
  const [loading, setLoading] = useState(false);

  // 当两个联系人都选择后自动加载
  useEffect(() => {
    if (!user1 || !user2) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    contactsApi.getCommonCircle(user1.username, user2.username).then(res => {
      if (!cancelled) { setData(res); setLoading(false); }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user1, user2]);

  const filter1 = useMemo(() => {
    const q = search1.toLowerCase();
    return contacts.filter(c => (c.remark || c.nickname || '').toLowerCase().includes(q)).slice(0, 20);
  }, [contacts, search1]);

  const filter2 = useMemo(() => {
    const q = search2.toLowerCase();
    return contacts.filter(c => (c.remark || c.nickname || '').toLowerCase().includes(q)).slice(0, 20);
  }, [contacts, search2]);

  const renderContactPicker = (
    selected: ContactStats | null,
    setSelected: (c: ContactStats | null) => void,
    search: string,
    setSearch: (s: string) => void,
    filtered: ContactStats[],
    placeholder: string,
  ) => {
    if (selected) {
      const name = selected.remark || selected.nickname || selected.username;
      return (
        <div className="bg-[#f8f9fb] dark:bg-white/5 rounded-2xl p-3 flex items-center gap-3">
          <img loading="lazy" src={avatarSrc(selected.small_head_url)} className="w-10 h-10 rounded-full flex-shrink-0" alt="" />
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-bold text-[#1d1d1f] dk-text truncate${privacyMode ? ' privacy-blur' : ''}`}>
              {name}
            </div>
            <div className="text-[10px] text-gray-400">{selected.total_messages.toLocaleString()} 条消息</div>
          </div>
          <button
            onClick={() => { setSelected(null); setSearch(''); }}
            className="p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-white/10 text-gray-400"
          >
            <X size={14} />
          </button>
        </div>
      );
    }
    return (
      <div>
        <div className="relative mb-2">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={placeholder}
            className="w-full pl-9 pr-3 py-2 bg-[#f8f9fb] dark:bg-white/5 border border-gray-200 dk-border rounded-xl text-sm focus:outline-none focus:border-[#07c160]"
          />
        </div>
        {search && (
          <div className="max-h-40 overflow-y-auto space-y-1 border border-gray-100 dk-border rounded-xl p-1">
            {filtered.length === 0 ? (
              <div className="text-center text-gray-300 text-xs py-4">未找到联系人</div>
            ) : filtered.map(c => {
              const name = c.remark || c.nickname || c.username;
              return (
                <button
                  key={c.username}
                  onClick={() => { setSelected(c); setSearch(''); }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5 text-left transition-colors"
                >
                  <img loading="lazy" src={avatarSrc(c.small_head_url)} className="w-6 h-6 rounded-full flex-shrink-0" alt="" />
                  <span className={`text-sm text-[#1d1d1f] dk-text truncate${privacyMode ? ' privacy-blur' : ''}`}>
                    {name}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white dark:bg-[#1d1d1f] rounded-3xl shadow-2xl w-[92vw] max-w-3xl max-h-[88vh] overflow-y-auto p-6 sm:p-8"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-black text-[#1d1d1f] dk-text flex items-center gap-2">
            <Users size={20} className="text-[#8b5cf6]" />
            共同社交圈
          </h2>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
            <X size={18} className="text-gray-400" />
          </button>
        </div>
        <p className="text-xs text-gray-400 mb-4">选择两个联系人，基于共同所在的群聊推测他们的共同朋友圈</p>

        {/* 联系人选择器 */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 mb-6">
          {renderContactPicker(user1, setUser1, search1, setSearch1, filter1, '选择第一个联系人')}
          <ArrowLeftRight size={16} className="text-gray-300" />
          {renderContactPicker(user2, setUser2, search2, setSearch2, filter2, '选择第二个联系人')}
        </div>

        {/* 结果展示 */}
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 size={28} className="text-[#8b5cf6] animate-spin" />
          </div>
        ) : !user1 || !user2 ? (
          <div className="text-center text-gray-300 py-16 text-sm">请先选择两个联系人</div>
        ) : !data || data.shared_groups.length === 0 ? (
          <div className="text-center text-gray-300 py-16 text-sm">他们没有共同的群聊</div>
        ) : (
          <div className="space-y-5">
            {/* 汇总 */}
            <div className="bg-gradient-to-r from-[#8b5cf610] to-[#07c16010] rounded-2xl px-4 py-3 flex flex-wrap items-center gap-3">
              <span className="text-sm font-bold text-[#1d1d1f] dk-text">
                <span className={privacyMode ? 'privacy-blur' : ''}>{data.user1_name}</span>
                <span className="text-gray-400 mx-1">&</span>
                <span className={privacyMode ? 'privacy-blur' : ''}>{data.user2_name}</span>
              </span>
              <span className="text-xs text-gray-500">
                共同所在 <b className="text-[#8b5cf6]">{data.shared_groups.length}</b> 个群 ·
                推测共同好友 <b className="text-[#07c160]">{data.common_friends.length}</b> 人
              </span>
            </div>

            {/* 共同好友 */}
            {data.common_friends.length > 0 && (
              <div>
                <div className="text-xs font-bold text-gray-500 dk-text mb-2">推测的共同好友（按共同群数降序）</div>
                <div className="flex flex-wrap gap-1.5 max-h-[150px] overflow-y-auto">
                  {data.common_friends.slice(0, 80).map(f => (
                    <span
                      key={f.name + f.username}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs ${
                        f.is_my_contact
                          ? 'bg-[#07c160]/10 text-[#07c160]'
                          : 'bg-gray-100 dark:bg-white/10 text-gray-500 dk-text'
                      }${privacyMode ? ' privacy-blur' : ''}`}
                      title={f.is_my_contact ? '你的好友' : '非好友'}
                    >
                      {f.is_my_contact && <UserCheck size={10} />}
                      {f.name}
                      {f.group_count > 1 && <span className="text-[9px] opacity-70 ml-0.5">×{f.group_count}</span>}
                    </span>
                  ))}
                  {data.common_friends.length > 80 && (
                    <span className="text-[10px] text-gray-400 py-1 px-2">…还有 {data.common_friends.length - 80} 人</span>
                  )}
                </div>
              </div>
            )}

            {/* 共同群聊列表 */}
            <div>
              <div className="text-xs font-bold text-gray-500 dk-text mb-2">共同所在的群聊（按人数升序，紧密小群在前）</div>
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {data.shared_groups.map(g => (
                  <div key={g.username} className="bg-[#f8f9fb] dark:bg-white/5 rounded-2xl px-4 py-3">
                    <div className="flex items-center gap-3">
                      {g.small_head_url && (
                        <img loading="lazy" src={avatarSrc(g.small_head_url)} className="w-8 h-8 rounded-lg flex-shrink-0" alt=""
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm font-bold text-[#1d1d1f] dk-text truncate${privacyMode ? ' privacy-blur' : ''}`}>
                          {g.name}
                        </div>
                        <div className="text-[10px] text-gray-400">{g.member_count} 人</div>
                      </div>
                    </div>
                    {g.other_members.length > 0 && g.member_count <= 20 && (
                      <div className="mt-2 pt-2 border-t border-gray-200/50 dark:border-white/10">
                        <div className="text-[10px] text-gray-400 mb-1">其他成员：</div>
                        <div className="flex flex-wrap gap-1">
                          {g.other_members.slice(0, 30).map(m => (
                            <span key={m} className={`text-[10px] px-1.5 py-0.5 rounded bg-white dark:bg-white/10 text-gray-500${privacyMode ? ' privacy-blur' : ''}`}>
                              {m}
                            </span>
                          ))}
                          {g.other_members.length > 30 && (
                            <span className="text-[10px] text-gray-300">…+{g.other_members.length - 30}</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
