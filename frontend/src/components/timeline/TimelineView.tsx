/**
 * 认识时间线 — 按首次聊天时间展示联系人认识历史
 */

import React, { useMemo, useState } from 'react';
import { Calendar, MessageSquare } from 'lucide-react';
import type { ContactStats } from '../../types';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';
import { avatarSrc } from '../../utils/avatar';

interface Props {
  contacts: ContactStats[];
  onContactClick?: (contact: ContactStats) => void;
}

interface YearGroup {
  year: string;
  contacts: ContactStats[];
}

export const TimelineView: React.FC<Props> = ({ contacts, onContactClick }) => {
  const { privacyMode } = usePrivacyMode();
  const [expandedYears, setExpandedYears] = useState<Set<string>>(new Set());

  const yearGroups: YearGroup[] = useMemo(() => {
    const withFirst = contacts.filter(
      (c) => c.first_message_time && c.first_message_time !== '-' && c.total_messages > 0
    );
    const byYear = new Map<string, ContactStats[]>();
    for (const c of withFirst) {
      const year = c.first_message_time.slice(0, 4);
      if (!byYear.has(year)) byYear.set(year, []);
      byYear.get(year)!.push(c);
    }
    return Array.from(byYear.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([year, cs]) => ({
        year,
        contacts: cs.sort((a, b) => a.first_message_time.localeCompare(b.first_message_time)),
      }));
  }, [contacts]);

  const totalWithFirst = yearGroups.reduce((s, g) => s + g.contacts.length, 0);

  const toggleYear = (year: string) => {
    setExpandedYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  };

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="dk-text text-3xl sm:text-5xl font-black tracking-tight text-[#1d1d1f] mb-1">认识时间线</h1>
        <p className="text-gray-400 text-sm">
          共 <span className="font-bold text-[#1d1d1f] dk-text">{totalWithFirst}</span> 位联系人，按第一条消息时间排列
        </p>
      </div>

      <div className="relative">
        {/* 竖线 */}
        <div className="absolute left-[22px] top-0 bottom-0 w-0.5 bg-gray-100 dark:bg-white/10" />

        <div className="space-y-8">
          {yearGroups.map((group) => {
            const isExpanded = expandedYears.has(group.year);
            const preview = group.contacts.slice(0, 5);
            const overflow = group.contacts.length - preview.length;

            return (
              <div key={group.year} className="relative pl-14">
                {/* 年份圆点 */}
                <div className="absolute left-0 w-11 h-11 rounded-full bg-[#07c160] flex items-center justify-center shadow-lg shadow-green-100/50 z-10">
                  <Calendar size={18} className="text-white" strokeWidth={2.5} />
                </div>

                {/* 年份标题 */}
                <div
                  className="flex items-center gap-3 mb-4 cursor-pointer group"
                  onClick={() => toggleYear(group.year)}
                >
                  <h2 className="text-2xl font-black text-[#1d1d1f] dk-text group-hover:text-[#07c160] transition-colors">
                    {group.year}
                  </h2>
                  <span className="text-sm font-semibold text-gray-400 bg-gray-100 dark:bg-white/10 px-2.5 py-0.5 rounded-full">
                    {group.contacts.length} 位
                  </span>
                  <span className="text-xs text-gray-300 ml-auto">
                    {isExpanded ? '收起' : '展开全部'}
                  </span>
                </div>

                {/* 联系人卡片列表 */}
                <div className="space-y-2">
                  {(isExpanded ? group.contacts : preview).map((contact) => {
                    const name = contact.remark || contact.nickname || contact.username;
                    const avatarUrl = contact.small_head_url || contact.big_head_url;
                    return (
                      <div
                        key={contact.username}
                        onClick={() => onContactClick?.(contact)}
                        className="dk-card bg-white dk-border border border-gray-100 rounded-2xl px-4 py-3 flex items-center gap-3 cursor-pointer hover:border-[#07c160]/30 hover:shadow-sm transition-all duration-200"
                      >
                        {/* 头像 */}
                        <div className="w-9 h-9 rounded-xl overflow-hidden flex-shrink-0">
                          {avatarUrl ? (
                            <img src={avatarSrc(avatarUrl)} alt={name} className="w-full h-full object-cover"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                          ) : (
                            <div className="w-full h-full bg-gradient-to-br from-[#07c160] to-[#06ad56] flex items-center justify-center text-white text-sm font-black">
                              {name.charAt(0)}
                            </div>
                          )}
                        </div>

                        {/* 名字 + 日期 */}
                        <div className="flex-1 min-w-0">
                          <div className={`font-bold text-sm text-[#1d1d1f] dk-text truncate${privacyMode ? ' privacy-blur' : ''}`}>{name}</div>
                          <div className="text-xs text-gray-400 mt-0.5">{contact.first_message_time}</div>
                        </div>

                        {/* 总消息数 */}
                        <div className="flex items-center gap-1 text-xs text-gray-400 flex-shrink-0">
                          <MessageSquare size={11} strokeWidth={2} />
                          <span className="font-semibold">{contact.total_messages.toLocaleString()}</span>
                        </div>

                        {/* 热度标签 */}
                        <HeatBadge contact={contact} />
                      </div>
                    );
                  })}

                  {!isExpanded && overflow > 0 && (
                    <button
                      onClick={() => toggleYear(group.year)}
                      className="w-full text-center text-xs text-[#07c160] font-semibold py-2 rounded-xl border border-dashed border-[#07c16030] hover:bg-[#07c16008] transition-colors"
                    >
                      还有 {overflow} 位，点击展开
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const HeatBadge: React.FC<{ contact: ContactStats }> = ({ contact }) => {
  if (contact.total_messages === 0) return null;
  const days = (Date.now() - new Date(contact.last_message_time).getTime()) / 86400000;
  if (days < 7)   return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#e7f8f0] text-[#07c160] flex-shrink-0">活跃</span>;
  if (days < 30)  return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#f0fce8] text-[#7bc934] flex-shrink-0">温热</span>;
  if (days < 180) return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-50 text-[#ff9500] flex-shrink-0">渐冷</span>;
  return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#eef1f7] text-[#576b95] flex-shrink-0">沉寂</span>;
};
