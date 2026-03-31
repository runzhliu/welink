/**
 * 渐行渐远的人 — 近期消息量比历史峰值下降超过 80% 的联系人
 */

import React, { useMemo } from 'react';
import { TrendingDown, CheckCircle2 } from 'lucide-react';
import type { ContactStats } from '../../types';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';
import { avatarSrc } from '../../utils/avatar';

interface Props {
  contacts: ContactStats[];
  onContactClick?: (c: ContactStats) => void;
}

export const DriftingApart: React.FC<Props> = ({ contacts, onContactClick }) => {
  const { privacyMode } = usePrivacyMode();

  const drifting = useMemo(() => {
    return contacts
      .filter((c) => {
        if (!c.peak_monthly || c.peak_monthly <= 0) return false;
        if (c.recent_monthly == null) return false;
        const dropRatio = (c.peak_monthly - c.recent_monthly) / c.peak_monthly;
        return dropRatio >= 0.8;
      })
      .map((c) => ({
        contact: c,
        dropRatio: (c.peak_monthly! - (c.recent_monthly ?? 0)) / c.peak_monthly!,
      }))
      .sort((a, b) => b.dropRatio - a.dropRatio)
      .slice(0, 8);
  }, [contacts]);

  return (
    <div className="dk-card bg-white dk-border border border-gray-100 rounded-2xl p-5">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 bg-red-500 rounded-xl flex items-center justify-center flex-shrink-0">
          <TrendingDown size={18} className="text-white" strokeWidth={2.5} />
        </div>
        <div>
          <h3 className="dk-text text-lg font-black text-[#1d1d1f]">渐行渐远的人</h3>
          <p className="text-xs text-gray-400 mt-0.5">近一月消息量比历史峰值下降超过 80%</p>
        </div>
      </div>

      {drifting.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <CheckCircle2 size={36} className="text-[#07c160] mb-3" />
          <p className="text-sm font-semibold text-[#1d1d1f]">所有关系都很健康</p>
          <p className="text-xs text-gray-400 mt-1">没有联系人出现大幅下降，继续保持吧</p>
        </div>
      ) : (
        <div className="space-y-3">
          {drifting.map(({ contact, dropRatio }) => {
            const displayName = contact.remark || contact.nickname || contact.username;
            const url = avatarSrc(contact.small_head_url || contact.big_head_url);
            const dropPct = Math.round(dropRatio * 100);

            return (
              <div
                key={contact.username}
                className={`flex items-center gap-3 rounded-xl px-2 py-1.5 transition-colors ${
                  onContactClick ? 'cursor-pointer hover:bg-gray-50' : ''
                }`}
                onClick={() => onContactClick?.(contact)}
              >
                {/* Avatar */}
                <div className="w-9 h-9 rounded-xl flex-shrink-0 overflow-hidden">
                  {url ? (
                    <img
                      src={url}
                      alt={displayName}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                        ((e.target as HTMLImageElement).nextElementSibling as HTMLElement)?.style.removeProperty('display');
                      }}
                    />
                  ) : null}
                  <div
                    className="w-full h-full bg-gradient-to-br from-[#07c160] to-[#06ad56] flex items-center justify-center text-white text-xs font-bold"
                    style={url ? { display: 'none' } : {}}
                  >
                    {displayName.charAt(0)}
                  </div>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-sm font-semibold dk-text text-[#1d1d1f] truncate${
                      privacyMode ? ' privacy-blur' : ''
                    }`}
                  >
                    {displayName}
                  </p>
                  <div className="flex items-center gap-2 text-[10px] text-gray-400 mt-0.5">
                    <span>
                      峰值{' '}
                      <span className="font-bold text-gray-600">
                        {Math.round(contact.peak_monthly!)}
                      </span>
                      /月
                      {contact.peak_period && (
                        <span className="text-gray-300"> ({contact.peak_period})</span>
                      )}
                    </span>
                    <span className="text-gray-200">|</span>
                    <span>
                      近期{' '}
                      <span className="font-bold text-gray-600">
                        {Math.round(contact.recent_monthly ?? 0)}
                      </span>
                      /月
                    </span>
                  </div>
                </div>

                {/* Drop badge */}
                <span className="flex-shrink-0 text-xs font-black text-red-500 bg-red-50 px-2 py-0.5 rounded-full">
                  -{dropPct}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
