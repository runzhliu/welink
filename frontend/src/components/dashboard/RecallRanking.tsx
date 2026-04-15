/**
 * 消息撤回排行榜
 */

import React, { useMemo, useState } from 'react';
import { Undo2, ChevronDown, ChevronUp } from 'lucide-react';
import type { ContactStats } from '../../types';
import { avatarSrc } from '../../utils/avatar';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';

interface Props {
  contacts: ContactStats[];
  onContactClick: (c: ContactStats) => void;
}

export const RecallRanking: React.FC<Props> = ({ contacts, onContactClick }) => {
  const { privacyMode } = usePrivacyMode();
  const [expanded, setExpanded] = useState(false);

  const ranked = useMemo(() => {
    return contacts
      .filter(c => (c.recall_count ?? 0) > 0)
      .map(c => ({
        ...c,
        recall: c.recall_count ?? 0,
        rate: c.total_messages > 0 ? (c.recall_count ?? 0) / c.total_messages * 100 : 0,
      }))
      .sort((a, b) => b.recall - a.recall);
  }, [contacts]);

  if (ranked.length === 0) {
    return null;
  }

  const display = expanded ? ranked : ranked.slice(0, 10);
  const maxRecall = ranked[0]?.recall ?? 1;

  return (
    <div className="bg-white dk-card rounded-3xl border border-gray-100 dk-border p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Undo2 size={18} className="text-[#fa5151]" />
          <h3 className="text-lg font-black text-[#1d1d1f] dk-text">消息撤回排行</h3>
        </div>
        <span className="text-xs text-gray-400">{ranked.length} 人有撤回记录</span>
      </div>

      <div className="space-y-2">
        {display.map((c, i) => {
          const name = c.remark || c.nickname || c.username;
          return (
            <div
              key={c.username}
              className="flex items-center gap-3 px-3 py-2 bg-[#f8f9fb] dark:bg-white/5 rounded-xl cursor-pointer hover:bg-[#f0f0f0] dark:hover:bg-white/10 transition-colors"
              onClick={() => onContactClick(c)}
            >
              <span className={`text-xs font-black w-5 text-center flex-shrink-0 ${
                i === 0 ? 'text-[#fa5151]' : i === 1 ? 'text-[#ff9500]' : i === 2 ? 'text-[#8b5cf6]' : 'text-gray-300'
              }`}>{i + 1}</span>
              <img loading="lazy" src={avatarSrc(c.small_head_url)} className="w-7 h-7 rounded-full flex-shrink-0" alt="" />
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-bold text-[#1d1d1f] dk-text truncate${privacyMode ? ' privacy-blur' : ''}`}>
                  {name}
                </div>
                <div className="h-1 bg-gray-200/60 dark:bg-gray-700 rounded-full overflow-hidden mt-1">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(3, (c.recall / maxRecall) * 100)}%`,
                      backgroundColor: i === 0 ? '#fa5151' : i === 1 ? '#ff9500' : i === 2 ? '#8b5cf6' : '#d1d5db',
                    }}
                  />
                </div>
              </div>
              <div className="flex-shrink-0 text-right">
                <div className="text-sm font-black text-[#1d1d1f] dk-text">{c.recall}</div>
                <div className="text-[10px] text-gray-400">{c.rate.toFixed(1)}%</div>
              </div>
            </div>
          );
        })}
      </div>

      {ranked.length > 10 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full mt-2 flex items-center justify-center gap-1 text-xs text-gray-400 hover:text-[#fa5151] transition-colors py-2"
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {expanded ? '收起' : `查看全部 ${ranked.length} 人`}
        </button>
      )}
    </div>
  );
};
