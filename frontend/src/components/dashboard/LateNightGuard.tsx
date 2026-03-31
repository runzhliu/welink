/**
 * 深夜守护 — Late Night Guardian summary card
 */

import React, { useMemo } from 'react';
import { Moon, Clock, Star } from 'lucide-react';
import type { ContactStats, GlobalStats } from '../../types';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';
import { avatarSrc } from '../../utils/avatar';

interface Props {
  globalStats: GlobalStats | null;
  contacts: ContactStats[];
  onContactClick?: (c: ContactStats) => void;
}

export const LateNightGuard: React.FC<Props> = ({
  globalStats,
  contacts,
  onContactClick,
}) => {
  const { privacyMode } = usePrivacyMode();

  const nightHours = useMemo(() => {
    if (!globalStats?.hourly_heatmap) return [0, 0, 0, 0, 0];
    return globalStats.hourly_heatmap.slice(0, 5);
  }, [globalStats]);

  const nightTotal = useMemo(() => nightHours.reduce((a, b) => a + b, 0), [nightHours]);

  const nightRatio = useMemo(() => {
    if (!globalStats?.total_messages || globalStats.total_messages === 0) return 0;
    return (nightTotal / globalStats.total_messages) * 100;
  }, [nightTotal, globalStats]);

  const peakHour = useMemo(() => {
    let maxIdx = 0;
    let maxVal = nightHours[0];
    for (let i = 1; i < nightHours.length; i++) {
      if (nightHours[i] > maxVal) {
        maxVal = nightHours[i];
        maxIdx = i;
      }
    }
    return maxIdx;
  }, [nightHours]);

  const top3 = useMemo(() => {
    return (globalStats?.late_night_ranking ?? []).slice(0, 3);
  }, [globalStats]);

  const findContact = (name: string) =>
    contacts.find((c) => (c.remark || c.nickname || c.username) === name);

  const barMax = useMemo(() => Math.max(...nightHours, 1), [nightHours]);

  const isHealthy = nightTotal === 0;

  return (
    <div className="dk-card bg-white dk-border border border-gray-100 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#1a1a2e] to-[#16213e] px-5 py-4 flex items-center gap-3">
        <div className="w-9 h-9 bg-white/10 rounded-xl flex items-center justify-center">
          <Moon size={18} className="text-yellow-300" strokeWidth={2.5} />
        </div>
        <h3 className="text-lg font-bold text-white">深夜守护</h3>
      </div>

      <div className="p-5 space-y-5">
        {isHealthy ? (
          <div className="flex items-center justify-center py-8">
            <span className="inline-flex items-center gap-2 bg-green-50 text-green-600 text-sm font-semibold px-4 py-2 rounded-full">
              <Star size={16} />
              你的作息很健康！
            </span>
          </div>
        ) : (
          <>
            {/* Night Owl Stats */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">深夜消息占比</p>
                <p className="text-lg font-bold text-[#1a1a2e]">
                  {nightRatio.toFixed(1)}%
                </p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">深夜消息总数</p>
                <p className="text-lg font-bold text-[#1a1a2e]">
                  {nightTotal.toLocaleString()}
                </p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">最活跃时段</p>
                <p className="text-lg font-bold text-[#1a1a2e]">
                  凌晨 {peakHour} 点
                </p>
              </div>
            </div>

            {/* Top 3 Night Companions */}
            {top3.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
                  <Clock size={14} className="text-gray-400" />
                  深夜密友 Top 3
                </h4>
                <div className="space-y-2">
                  {top3.map((entry, i) => {
                    const contact = findContact(entry.name);
                    const avatarUrl = contact?.small_head_url || contact?.big_head_url;
                    const clickable = !!(contact && onContactClick);
                    return (
                      <div
                        key={entry.name}
                        className={`flex items-center gap-3 p-2 rounded-xl hover:bg-gray-50 transition-colors ${
                          clickable ? 'cursor-pointer' : ''
                        }`}
                        onClick={() => clickable && onContactClick!(contact!)}
                      >
                        <span
                          className={`w-5 text-center text-xs font-bold flex-shrink-0 ${
                            i === 0
                              ? 'text-yellow-500'
                              : i === 1
                                ? 'text-gray-400'
                                : 'text-orange-400'
                          }`}
                        >
                          {i + 1}
                        </span>
                        <div className="w-8 h-8 rounded-full flex-shrink-0 overflow-hidden ring-1 ring-gray-200">
                          {avatarUrl ? (
                            <img
                              src={avatarSrc(avatarUrl)}
                              alt={entry.name}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                              }}
                            />
                          ) : (
                            <div className="w-full h-full bg-[#1a1a2e] flex items-center justify-center text-white text-xs font-bold">
                              {entry.name.charAt(0)}
                            </div>
                          )}
                        </div>
                        <span
                          className={`text-sm font-medium text-gray-800 truncate flex-1${
                            privacyMode ? ' privacy-blur' : ''
                          }`}
                        >
                          {entry.name}
                        </span>
                        <span className="text-xs text-gray-500 flex-shrink-0">
                          {entry.late_night_count.toLocaleString()} 条
                        </span>
                        <span className="text-xs text-[#576b95] font-semibold flex-shrink-0">
                          {entry.ratio.toFixed(1)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Hourly Breakdown Mini Chart (0-4) */}
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-3">
                凌晨时段分布
              </h4>
              <div className="flex items-end gap-2 h-20">
                {nightHours.map((count, hour) => (
                  <div
                    key={hour}
                    className="flex-1 flex flex-col items-center gap-1"
                  >
                    <span className="text-[10px] text-gray-400">
                      {count > 0 ? count.toLocaleString() : ''}
                    </span>
                    <div className="w-full flex items-end" style={{ height: 48 }}>
                      <div
                        className="w-full bg-gradient-to-t from-[#1a1a2e] to-[#576b95] rounded-t-md transition-all duration-500"
                        style={{
                          height: `${(count / barMax) * 100}%`,
                          minHeight: count > 0 ? 4 : 0,
                        }}
                      />
                    </div>
                    <span className="text-[10px] text-gray-500 font-medium">
                      {hour}点
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
