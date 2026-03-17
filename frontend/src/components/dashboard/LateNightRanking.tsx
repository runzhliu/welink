/**
 * 深夜密友排行榜
 */

import React from 'react';
import { Moon } from 'lucide-react';
import type { GlobalStats } from '../../types';

interface Props {
  data: GlobalStats | null;
}

export const LateNightRanking: React.FC<Props> = ({ data }) => {
  const ranking = data?.late_night_ranking;
  if (!ranking?.length) return null;

  const max = ranking[0]?.late_night_count || 1;

  return (
    <div className="bg-[#1d1d1f] rounded-3xl p-6 sm:p-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 bg-[#576b95] rounded-xl flex items-center justify-center">
          <Moon size={18} className="text-white" strokeWidth={2.5} />
        </div>
        <h3 className="text-lg font-black text-white">深夜密友排行</h3>
        <span className="text-xs text-gray-500 ml-auto">0–5 点消息量</span>
      </div>

      <div className="space-y-3">
        {ranking.slice(0, 10).map((entry, i) => (
          <div key={entry.name} className="flex items-center gap-3">
            <span className={`w-6 text-right text-xs font-black flex-shrink-0 ${
              i === 0 ? 'text-yellow-400' : i === 1 ? 'text-gray-300' : i === 2 ? 'text-orange-400' : 'text-gray-600'
            }`}>
              {i + 1}
            </span>
            <span className="text-sm font-semibold text-gray-200 w-24 truncate flex-shrink-0">
              {entry.name}
            </span>
            <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#576b95] rounded-full transition-all duration-500"
                style={{ width: `${(entry.late_night_count / max) * 100}%` }}
              />
            </div>
            <span className="text-xs text-gray-400 w-12 text-right flex-shrink-0">
              {entry.late_night_count.toLocaleString()}
            </span>
            <span className="text-xs text-[#576b95] w-10 text-right flex-shrink-0 font-bold">
              {entry.ratio.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
