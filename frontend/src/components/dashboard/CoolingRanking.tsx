/**
 * 关系降温榜 — 历史热聊但逐渐沉寂的联系人
 */

import React, { useEffect, useState } from 'react';
import { Snowflake } from 'lucide-react';
import type { CoolingEntry, ContactStats } from '../../types';
import { contactsApi } from '../../services/api';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';
import { avatarSrc } from '../../utils/avatar';

interface Props {
  isInitialized: boolean;
  contacts: ContactStats[];
  onContactClick?: (contact: ContactStats) => void;
}

export const CoolingRanking: React.FC<Props> = ({ isInitialized, contacts, onContactClick }) => {
  const { privacyMode } = usePrivacyMode();
  const [ranking, setRanking] = useState<CoolingEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isInitialized) return;
    setLoading(true);
    contactsApi.getCooling()
      .then((d) => setRanking(d ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isInitialized]);

  if (loading) return null;
  if (!ranking.length) return null;

  const findContact = (username: string) =>
    contacts.find((c) => c.username === username);

  return (
    <div className="bg-white dk-border border border-gray-100 rounded-3xl p-4 sm:p-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 bg-[#576b95] rounded-xl flex items-center justify-center flex-shrink-0">
          <Snowflake size={18} className="text-white" strokeWidth={2.5} />
        </div>
        <div>
          <h3 className="dk-text text-lg font-black text-[#1d1d1f]">关系降温榜</h3>
          <p className="text-xs text-gray-400 mt-0.5">曾经热聊，现在沉寂——历史峰值月均 vs 近 3 个月月均</p>
        </div>
      </div>

      <div className="space-y-4">
        {ranking.map((entry, i) => {
          const contact = findContact(entry.username);
          const avatarUrl = entry.small_head_url;
          const dropPct = Math.round(entry.drop_ratio * 100);
          const barWidth = Math.min(100, Math.round((entry.recent_monthly / entry.peak_monthly) * 100));

          return (
            <div
              key={entry.username}
              className={`flex items-center gap-3 ${contact && onContactClick ? 'cursor-pointer group' : ''}`}
              onClick={() => contact && onContactClick?.(contact)}
            >
              {/* 排名 */}
              <span className={`w-5 text-right text-xs font-black flex-shrink-0 ${
                i === 0 ? 'text-yellow-400' : i === 1 ? 'text-gray-300' : i === 2 ? 'text-orange-400' : 'text-gray-300'
              }`}>{i + 1}</span>

              {/* 头像 */}
              <div className="w-8 h-8 rounded-full flex-shrink-0 overflow-hidden ring-1 ring-gray-100">
                {avatarUrl ? (
                  <img src={avatarSrc(avatarUrl)} alt={entry.display_name} className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                ) : (
                  <div className="w-full h-full bg-[#576b95] flex items-center justify-center text-white text-[10px] font-black">
                    {entry.display_name.charAt(0)}
                  </div>
                )}
              </div>

              {/* 名字 */}
              <span className={`text-sm font-semibold dk-text text-[#1d1d1f] w-16 sm:w-20 truncate flex-shrink-0 group-hover:text-[#07c160] transition-colors${privacyMode ? ' privacy-blur' : ''}`}>
                {entry.display_name}
              </span>

              {/* 进度条：展示现在相对于峰值的占比 */}
              <div className="flex-1 flex flex-col gap-1 min-w-0">
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#576b95] rounded-full transition-all duration-500"
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[10px] text-gray-400">
                  <span>峰值 <span className="font-bold text-gray-600">{Math.round(entry.peak_monthly)}</span> 条/月 <span className="text-gray-300">({entry.peak_period})</span></span>
                  <span>近期 <span className="font-bold text-gray-600">{Math.round(entry.recent_monthly)}</span> 条/月</span>
                </div>
              </div>

              {/* 降幅 */}
              <span className="text-xs font-black text-[#576b95] w-10 text-right flex-shrink-0">
                -{dropPct}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
