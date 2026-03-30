/**
 * 认识时间线 — 拖动时间轴，看到你在哪个时间点认识了哪些人
 */

import React, { useMemo, useState, useRef } from 'react';
import { Users } from 'lucide-react';
import type { ContactStats } from '../../types';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';
import { avatarSrc } from '../../utils/avatar';

interface Props {
  contacts: ContactStats[];
  onContactClick?: (contact: ContactStats) => void;
}

export const TimelineView: React.FC<Props> = ({ contacts, onContactClick }) => {
  const { privacyMode } = usePrivacyMode();
  const sliderRef = useRef<HTMLInputElement>(null);

  // 过滤有效联系人（有首次消息时间）
  const validContacts = useMemo(() =>
    contacts
      .filter(c => c.first_message_time && c.first_message_time !== '-' && c.total_messages > 0)
      .sort((a, b) => a.first_message_time.localeCompare(b.first_message_time)),
    [contacts]
  );

  // 时间范围（月级别，格式 YYYY-MM）
  const { minMonth, maxMonth, allMonths } = useMemo(() => {
    if (validContacts.length === 0) return { minMonth: '', maxMonth: '', allMonths: [] };
    const min = validContacts[0].first_message_time.slice(0, 7);
    const max = validContacts[validContacts.length - 1].first_message_time.slice(0, 7);

    // 生成所有月份
    const months: string[] = [];
    let cur = min;
    while (cur <= max) {
      months.push(cur);
      const [y, m] = cur.split('-').map(Number);
      const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
      cur = next;
    }
    return { minMonth: min, maxMonth: max, allMonths: months };
  }, [validContacts]);

  const [sliderIdx, setSliderIdx] = useState<number>(() => allMonths.length - 1);
  const currentMonth = allMonths[Math.min(sliderIdx, allMonths.length - 1)] ?? maxMonth;

  // 截止到当前月份认识的联系人
  const visibleContacts = useMemo(() =>
    validContacts.filter(c => c.first_message_time.slice(0, 7) <= currentMonth),
    [validContacts, currentMonth]
  );

  // 当月新认识的人（高亮）
  const newThisMonth = useMemo(() =>
    new Set(validContacts
      .filter(c => c.first_message_time.slice(0, 7) === currentMonth)
      .map(c => c.username)),
    [validContacts, currentMonth]
  );

  const formatMonth = (ym: string) => {
    if (!ym) return '';
    const [y, m] = ym.split('-');
    return `${y} 年 ${parseInt(m)} 月`;
  };

  if (validContacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-gray-300">
        <Users size={48} className="mb-4" />
        <p className="font-semibold">暂无聊天记录</p>
      </div>
    );
  }

  const pct = allMonths.length > 1 ? (sliderIdx / (allMonths.length - 1)) * 100 : 100;

  return (
    <div className="max-w-4xl">
      {/* 标题 */}
      <div className="mb-8">
        <h1 className="dk-text text-3xl sm:text-5xl font-black tracking-tight text-[#1d1d1f] mb-1">认识时间线</h1>
        <p className="text-gray-400 text-sm">
          拖动时间轴，查看你在不同时期认识了哪些人
        </p>
      </div>

      {/* 时间轴控制区 */}
      <div className="dk-card bg-white dk-border border border-gray-100 rounded-3xl p-6 mb-8 shadow-sm">
        {/* 当前时间点 + 人数 */}
        <div className="flex items-end justify-between mb-5">
          <div>
            <div className="text-3xl font-black text-[#07c160]">{formatMonth(currentMonth)}</div>
            <div className="text-sm text-gray-400 mt-1">
              共认识了
              <span className="font-bold text-[#1d1d1f] dk-text mx-1">{visibleContacts.length}</span>
              位联系人
              {newThisMonth.size > 0 && (
                <span className="ml-2 text-xs font-bold px-2 py-0.5 rounded-full bg-[#e7f8f0] text-[#07c160]">
                  本月新增 {newThisMonth.size} 位
                </span>
              )}
            </div>
          </div>
          <div className="text-right text-xs text-gray-400">
            <div>{formatMonth(minMonth)}</div>
            <div className="text-gray-200 my-0.5">→</div>
            <div>{formatMonth(maxMonth)}</div>
          </div>
        </div>

        {/* Slider */}
        <div className="relative">
          <input
            ref={sliderRef}
            type="range"
            min={0}
            max={Math.max(0, allMonths.length - 1)}
            value={sliderIdx}
            onChange={e => setSliderIdx(Number(e.target.value))}
            className="w-full h-2 rounded-full appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, #07c160 ${pct}%, #e5e7eb ${pct}%)`,
            }}
          />
          {/* 年份刻度 */}
          <div className="flex justify-between mt-2 px-0.5">
            {Array.from(new Set(allMonths.map(m => m.slice(0, 4)))).map(year => {
              const firstIdx = allMonths.findIndex(m => m.startsWith(year));
              const pos = allMonths.length > 1 ? (firstIdx / (allMonths.length - 1)) * 100 : 0;
              return (
                <button
                  key={year}
                  onClick={() => setSliderIdx(firstIdx)}
                  className="text-[10px] text-gray-300 hover:text-[#07c160] font-bold transition-colors"
                  style={{ position: 'absolute', left: `${pos}%`, transform: 'translateX(-50%)' }}
                >
                  {year}
                </button>
              );
            })}
          </div>
        </div>
        <div className="mt-6" />
      </div>

      {/* 头像网格 */}
      <div className="flex flex-wrap gap-4">
        {visibleContacts.map(contact => {
          const name = contact.remark || contact.nickname || contact.username;
          const avatarUrl = contact.small_head_url || contact.big_head_url;
          const isNew = newThisMonth.has(contact.username);
          return (
            <button
              key={contact.username}
              onClick={() => onContactClick?.(contact)}
              title={`${name}\n认识于 ${contact.first_message_time}`}
              className={`flex flex-col items-center gap-1.5 group transition-all duration-300 ${
                isNew ? 'scale-110' : 'opacity-90 hover:opacity-100'
              }`}
            >
              {/* 头像 */}
              <div className={`relative w-14 h-14 rounded-2xl overflow-hidden flex-shrink-0 shadow-sm transition-all duration-300 ${
                isNew
                  ? 'ring-2 ring-[#07c160] ring-offset-2 shadow-lg shadow-green-100'
                  : 'group-hover:ring-2 group-hover:ring-[#07c160]/40 group-hover:ring-offset-1'
              }`}>
                {avatarUrl ? (
                  <img
                    src={avatarSrc(avatarUrl)}
                    alt={name}
                    className="w-full h-full object-cover"
                    onError={e => {
                      const el = e.target as HTMLImageElement;
                      el.style.display = 'none';
                      el.parentElement!.classList.add('bg-gradient-to-br', 'from-[#07c160]', 'to-[#06ad56]');
                    }}
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-[#07c160] to-[#06ad56] flex items-center justify-center text-white text-lg font-black">
                    {[...name][0]}
                  </div>
                )}
                {/* 新认识标记 */}
                {isNew && (
                  <div className="absolute -top-1 -right-1 w-4 h-4 bg-[#07c160] rounded-full flex items-center justify-center shadow-sm">
                    <span className="text-white text-[8px] font-black">新</span>
                  </div>
                )}
              </div>

              {/* 名字 */}
              <span className={`text-xs font-semibold text-center leading-tight max-w-[60px] truncate dk-text ${
                isNew ? 'text-[#07c160]' : 'text-gray-600 dark:text-gray-300'
              }${privacyMode ? ' privacy-blur' : ''}`}>
                {name}
              </span>

              {/* 认识时间（新认识时显示） */}
              {isNew && (
                <span className="text-[9px] text-gray-400 -mt-1">
                  {contact.first_message_time.slice(5, 10)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {visibleContacts.length === 0 && (
        <div className="text-center py-20 text-gray-300 text-sm">
          向右拖动时间轴，开始探索
        </div>
      )}
    </div>
  );
};
