/**
 * 谁最像谁 — 联系人聊天风格相似度排行
 */

import React, { useEffect, useState } from 'react';
import { Loader2, Users2 } from 'lucide-react';
import type { SimilarityResult } from '../../types';
import { contactsApi } from '../../services/api';
import { avatarSrc } from '../../utils/avatar';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';

export const SimilarityCard: React.FC = () => {
  const { privacyMode } = usePrivacyMode();
  const [data, setData] = useState<SimilarityResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    contactsApi.getSimilarity(20).then(res => {
      if (!cancelled) { setData(res); setLoading(false); }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="bg-white dk-card rounded-3xl border border-gray-100 dk-border p-6">
        <div className="flex items-center gap-2 mb-4">
          <Users2 size={18} className="text-[#8b5cf6]" />
          <h3 className="text-lg font-black text-[#1d1d1f] dk-text">谁最像谁</h3>
        </div>
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="text-[#8b5cf6] animate-spin" />
        </div>
      </div>
    );
  }

  if (!data || data.pairs.length === 0) {
    return (
      <div className="bg-white dk-card rounded-3xl border border-gray-100 dk-border p-6">
        <div className="flex items-center gap-2 mb-4">
          <Users2 size={18} className="text-[#8b5cf6]" />
          <h3 className="text-lg font-black text-[#1d1d1f] dk-text">谁最像谁</h3>
        </div>
        <div className="text-center text-gray-300 py-8">数据不足</div>
      </div>
    );
  }

  const pairs = expanded ? data.pairs : data.pairs.slice(0, 5);

  return (
    <div className="bg-white dk-card rounded-3xl border border-gray-100 dk-border p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Users2 size={18} className="text-[#8b5cf6]" />
          <h3 className="text-lg font-black text-[#1d1d1f] dk-text">谁最像谁</h3>
          <span className="text-xs text-gray-400">{data.total} 位联系人参与对比</span>
        </div>
      </div>
      <p className="text-xs text-gray-400 mb-4">基于消息类型、平均长度、表情使用、互动方式等聊天风格特征计算相似度</p>

      <div className="space-y-3">
        {pairs.map((p, i) => (
          <div
            key={`${p.user1}-${p.user2}`}
            className="flex items-center gap-3 px-4 py-3 bg-[#f8f9fb] dark:bg-white/5 rounded-xl"
          >
            {/* Rank */}
            <span className={`text-sm font-black flex-shrink-0 w-6 text-center ${
              i === 0 ? 'text-[#ff9500]' : i === 1 ? 'text-[#8b5cf6]' : i === 2 ? 'text-[#10aeff]' : 'text-gray-300'
            }`}>
              {i + 1}
            </span>

            {/* Avatar pair */}
            <div className="flex items-center -space-x-2 flex-shrink-0">
              <img
                src={avatarSrc(p.avatar1)}
                className="w-8 h-8 rounded-full border-2 border-white dark:border-gray-800"
                alt=""
              />
              <img
                src={avatarSrc(p.avatar2)}
                className="w-8 h-8 rounded-full border-2 border-white dark:border-gray-800"
                alt=""
              />
            </div>

            {/* Names */}
            <div className="flex-1 min-w-0">
              <div className={`text-sm font-bold text-[#1d1d1f] dk-text truncate${privacyMode ? ' privacy-blur' : ''}`}>
                {p.name1} <span className="text-gray-300 font-normal mx-1">&</span> {p.name2}
              </div>
              {p.top_shared && p.top_shared.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {p.top_shared.map(w => (
                    <span key={w} className="text-[10px] px-1.5 py-0.5 rounded bg-[#8b5cf6]/10 text-[#8b5cf6]">{w}</span>
                  ))}
                </div>
              )}
            </div>

            {/* Score */}
            <div className="flex-shrink-0 text-right">
              <div className="text-lg font-black text-[#1d1d1f] dk-text">{Math.round(p.score * 100)}%</div>
              <div className="text-[10px] text-gray-400">相似度</div>
            </div>
          </div>
        ))}
      </div>

      {data.pairs.length > 5 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full mt-3 text-center text-xs text-gray-400 hover:text-[#8b5cf6] transition-colors py-2"
        >
          {expanded ? '收起' : `展开全部 ${data.pairs.length} 对`}
        </button>
      )}
    </div>
  );
};
