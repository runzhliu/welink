/**
 * 谁最像谁 —— 两个 tab：
 *   - 他 vs 他：联系人两两对比风格相似度（原行为）
 *   - 他 vs 我：每个联系人 vs "我的平均基线"（原有趣发现的 LikeMeCard，合并进来）
 */

import React, { useEffect, useState, useMemo } from 'react';
import { Loader2, Users2, UserCheck } from 'lucide-react';
import axios from 'axios';
import type { SimilarityResult } from '../../types';
import { contactsApi } from '../../services/api';
import { avatarSrc } from '../../utils/avatar';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';

interface Props {
  blockedUsers?: string[];
  blockedDisplayNames?: Set<string>;
  onContactClick?: (username: string) => void;
}

type Tab = 'pairs' | 'me';

interface LikeMeEntry { username: string; name: string; avatar: string; score: number; top_shared: string[] }
interface LikeMeResult { entries: LikeMeEntry[]; generated_at: number }

export const SimilarityCard: React.FC<Props> = ({ blockedUsers = [], blockedDisplayNames, onContactClick }) => {
  const { privacyMode } = usePrivacyMode();
  const [tab, setTab] = useState<Tab>('pairs');
  const [rawData, setRawData] = useState<SimilarityResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [likeMe, setLikeMe] = useState<LikeMeResult | null>(null);

  const data = useMemo(() => {
    if (!rawData) return null;
    const blockedUsernames = new Set(blockedUsers);
    const blockedNames = blockedDisplayNames ?? new Set<string>();
    if (blockedUsernames.size === 0 && blockedNames.size === 0) return rawData;
    return {
      ...rawData,
      pairs: rawData.pairs.filter(p =>
        !blockedUsernames.has(p.user1) && !blockedUsernames.has(p.user2) &&
        !blockedNames.has(p.name1) && !blockedNames.has(p.name2)
      ),
    };
  }, [rawData, blockedUsers, blockedDisplayNames]);

  useEffect(() => {
    let cancelled = false;
    contactsApi.getSimilarity(20).then(res => {
      if (!cancelled) { setRawData(res); setLoading(false); }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // 切到 "他 vs 我" 才拉数据，避免首屏额外请求
  useEffect(() => {
    if (tab === 'me' && likeMe === null) {
      axios.get<LikeMeResult>('/api/fun/like-me')
        .then(r => setLikeMe(r.data))
        .catch(() => setLikeMe({ entries: [], generated_at: 0 }));
    }
  }, [tab, likeMe]);

  if (loading) {
    return (
      <div className="bg-white dk-card rounded-3xl border border-gray-100 dk-border p-6">
        <div className="flex items-center gap-2 mb-4">
          <Users2 size={18} className="text-[#8b5cf6]" />
          <h3 className="text-lg font-black text-[#1d1d1f] dk-text">谁最像谁</h3>
        </div>
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <Loader2 size={24} className="text-[#8b5cf6] animate-spin" />
          <div className="text-center">
            <p className="text-xs text-gray-400">正在计算联系人相似度…</p>
            <p className="text-[10px] text-gray-300 mt-1">提取每人聊天特征向量并两两对比，结果会缓存加速下次访问</p>
          </div>
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

  const TabBtn: React.FC<{ id: Tab; icon: React.ReactNode; label: string }> = ({ id, icon, label }) => (
    <button
      onClick={() => setTab(id)}
      className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold transition-all ${
        tab === id
          ? 'bg-[#8b5cf6]/10 text-[#8b5cf6]'
          : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="bg-white dk-card rounded-3xl border border-gray-100 dk-border p-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Users2 size={18} className="text-[#8b5cf6]" />
          <h3 className="text-lg font-black text-[#1d1d1f] dk-text">谁最像谁</h3>
          <span className="text-xs text-gray-400">{data.total} 人参与</span>
        </div>
      </div>
      <div className="flex items-center gap-1 mb-4 -mx-1">
        <TabBtn id="pairs" icon={<Users2 size={12} />} label="他 vs 他" />
        <TabBtn id="me" icon={<UserCheck size={12} />} label="他 vs 我" />
      </div>

      {tab === 'pairs' && (
        <>
          <p className="text-xs text-gray-400 mb-4">基于消息类型、平均长度、表情使用、互动方式等聊天风格特征计算相似度</p>
          <div className="space-y-3">
            {pairs.map((p, i) => (
              <div
                key={`${p.user1}-${p.user2}`}
                className="flex items-center gap-3 px-4 py-3 bg-[#f8f9fb] dark:bg-white/5 rounded-xl"
              >
                <span className={`text-sm font-black flex-shrink-0 w-6 text-center ${
                  i === 0 ? 'text-[#ff9500]' : i === 1 ? 'text-[#8b5cf6]' : i === 2 ? 'text-[#10aeff]' : 'text-gray-300'
                }`}>
                  {i + 1}
                </span>
                <div className="flex items-center -space-x-2 flex-shrink-0">
                  <img src={avatarSrc(p.avatar1)} className="w-8 h-8 rounded-full border-2 border-white dark:border-gray-800" alt="" />
                  <img src={avatarSrc(p.avatar2)} className="w-8 h-8 rounded-full border-2 border-white dark:border-gray-800" alt="" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-bold text-[#1d1d1f] dk-text truncate${privacyMode ? ' privacy-blur' : ''}`}>
                    <button onClick={() => onContactClick?.(p.user1)} className="hover:text-[#07c160] transition-colors">{p.name1}</button>
                    <span className="text-gray-300 font-normal mx-1">&</span>
                    <button onClick={() => onContactClick?.(p.user2)} className="hover:text-[#07c160] transition-colors">{p.name2}</button>
                  </div>
                  {p.top_shared && p.top_shared.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {p.top_shared.map(w => (
                        <span key={w} className="text-[10px] px-1.5 py-0.5 rounded bg-[#8b5cf6]/10 text-[#8b5cf6]">{w}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex-shrink-0 text-right">
                  <div className="text-lg font-black text-[#1d1d1f] dk-text">{Math.round(p.score * 100)}%</div>
                  <div className="text-[10px] text-gray-400">相似度</div>
                </div>
              </div>
            ))}
          </div>
          {data.pairs.length > 5 && (
            <button onClick={() => setExpanded(!expanded)} className="w-full mt-3 text-center text-xs text-gray-400 hover:text-[#8b5cf6] transition-colors py-2">
              {expanded ? '收起' : `展开全部 ${data.pairs.length} 对`}
            </button>
          )}
        </>
      )}

      {tab === 'me' && (
        likeMe === null ? (
          <div className="py-8 text-center text-xs text-gray-400">加载中…</div>
        ) : likeMe.entries.length === 0 ? (
          <div className="py-8 text-center text-xs text-gray-400">数据不足</div>
        ) : (
          <>
            <p className="text-xs text-gray-400 mb-3">
              聊天风格最接近"你的平均对话基线"（18 维余弦相似度）
              <span className="block text-[10px] mt-0.5">近似口径：关系风格 ≈ 双方风格混合；跟你聊得最顺的人往往也风格最贴近。</span>
            </p>
            <div className="space-y-2">
              {likeMe.entries.map((e, i) => (
                <button
                  key={e.username}
                  onClick={() => onContactClick?.(e.username)}
                  className="w-full flex items-center gap-2 text-left hover:bg-gray-50 dark:hover:bg-white/5 rounded-xl px-2 py-1.5"
                >
                  <span className="text-gray-300 w-5 tabular-nums text-xs">#{i + 1}</span>
                  <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 bg-gray-100">
                    {e.avatar && <img loading="lazy" src={avatarSrc(e.avatar)} className="w-full h-full object-cover" alt="" />}
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <div className={`text-sm font-bold text-[#1d1d1f] dk-text truncate${privacyMode ? ' privacy-blur' : ''}`}>{e.name}</div>
                    {e.top_shared && e.top_shared.length > 0 && (
                      <p className="text-[10px] text-gray-400 truncate">共同高频词：{e.top_shared.slice(0, 4).join('·')}</p>
                    )}
                  </div>
                  <span className="text-[#8b5cf6] font-semibold tabular-nums text-sm">{(e.score * 100).toFixed(0)}%</span>
                </button>
              ))}
            </div>
          </>
        )
      )}
    </div>
  );
};
