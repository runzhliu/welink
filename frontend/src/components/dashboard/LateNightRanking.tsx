/**
 * 深夜密友排行榜
 */

import React from 'react';
import { Moon } from 'lucide-react';
import type { GlobalStats, ContactStats } from '../../types';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';
import { avatarSrc } from '../../utils/avatar';

interface Props {
  data: GlobalStats | null;
  contacts?: ContactStats[];
  onContactClick?: (contact: ContactStats) => void;
}

export const LateNightRanking: React.FC<Props> = ({ data, contacts = [], onContactClick }) => {
  const { privacyMode } = usePrivacyMode();
  const ranking = data?.late_night_ranking;
  if (!ranking?.length) return null;

  const max = ranking[0]?.late_night_count || 1;

  const findContact = (name: string) =>
    contacts.find((c) => (c.remark || c.nickname || c.username) === name);

  return (
    <div className="bg-[#1d1d1f] rounded-3xl p-4 sm:p-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 bg-[#576b95] rounded-xl flex items-center justify-center">
          <Moon size={18} className="text-white" strokeWidth={2.5} />
        </div>
        <h3 className="text-lg font-black text-white">深夜密友排行</h3>
        <span className="text-xs text-gray-500 ml-auto">0–5 点消息量</span>
      </div>

      <div className="space-y-3">
        {ranking.slice(0, 10).map((entry, i) => {
          const contact = findContact(entry.name);
          const avatarUrl = contact?.small_head_url || contact?.big_head_url;
          return (
            <div
              key={entry.name}
              className={`flex items-center gap-3 ${contact && onContactClick ? 'cursor-pointer' : ''}`}
              onClick={() => contact && onContactClick?.(contact)}
            >
              <span className={`w-5 text-right text-xs font-black flex-shrink-0 ${
                i === 0 ? 'text-yellow-400' : i === 1 ? 'text-gray-300' : i === 2 ? 'text-orange-400' : 'text-gray-600'
              }`}>
                {i + 1}
              </span>
              {/* 头像 */}
              <div className="w-7 h-7 rounded-full flex-shrink-0 overflow-hidden ring-1 ring-white/10">
                {avatarUrl ? (
                  <img src={avatarSrc(avatarUrl)} alt={entry.name} className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                ) : (
                  <div className="w-full h-full bg-[#576b95] flex items-center justify-center text-white text-[10px] font-black">
                    {entry.name.charAt(0)}
                  </div>
                )}
              </div>
              <span className={`text-sm font-semibold text-gray-200 w-14 sm:w-20 truncate flex-shrink-0${privacyMode ? ' privacy-blur' : ''}`}>
                {entry.name}
              </span>
              <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#576b95] rounded-full transition-all duration-500"
                  style={{ width: `${(entry.late_night_count / max) * 100}%` }}
                />
              </div>
              <span className="text-xs text-gray-400 w-8 sm:w-12 text-right flex-shrink-0">
                {entry.late_night_count.toLocaleString()}
              </span>
              <span className="text-xs text-[#576b95] w-8 sm:w-10 text-right flex-shrink-0 font-bold">
                {entry.ratio.toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
