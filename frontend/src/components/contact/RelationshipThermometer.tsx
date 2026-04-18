/**
 * 关系温度计 —— 基于最后一条消息距今天数 + 近期/峰值比，给关系打一个"当前温度"。
 * 挂在联系人画像头部，让用户一眼看到"这段关系现在什么状态"。
 *
 * 口径：
 *   tier：按距今天数分五档（≤3/≤7/≤30/≤90/>90 天）
 *   arrow：近一月消息量 ÷ 历史峰值月消息量 → ≥0.8 ↑、≤0.3 ↓、否则 →
 */

import React from 'react';
import type { ContactStats } from '../../types';

type Tier = 'hot' | 'warm' | 'normal' | 'cool' | 'cold';

interface TierMeta {
  emoji: string;
  label: string;
  color: string;
  bg: string;
}

const TIER_MAP: Record<Tier, TierMeta> = {
  hot:    { emoji: '🔥', label: '热络',   color: 'text-red-600',    bg: 'bg-red-500/10' },
  warm:   { emoji: '🌤️', label: '温和',   color: 'text-orange-500', bg: 'bg-orange-500/10' },
  normal: { emoji: '😊', label: '平稳',   color: 'text-[#07c160]',  bg: 'bg-[#07c160]/10' },
  cool:   { emoji: '🌙', label: '渐淡',   color: 'text-[#576b95]',  bg: 'bg-[#576b95]/10' },
  cold:   { emoji: '🌑', label: '冷却',   color: 'text-gray-500',   bg: 'bg-gray-500/10' },
};

interface Props {
  contact: ContactStats;
  className?: string;
}

export const RelationshipThermometer: React.FC<Props> = ({ contact, className = '' }) => {
  const lastTs = contact.last_message_ts ?? 0;
  if (!lastTs || (contact.total_messages ?? 0) < 10) return null;

  const daysSince = (Date.now() / 1000 - lastTs) / 86400;

  let tier: Tier;
  if (daysSince <= 3) tier = 'hot';
  else if (daysSince <= 7) tier = 'warm';
  else if (daysSince <= 30) tier = 'normal';
  else if (daysSince <= 90) tier = 'cool';
  else tier = 'cold';

  const peak = contact.peak_monthly ?? 0;
  const recent = contact.recent_monthly ?? 0;
  let arrow = '→';
  let arrowColor = 'text-gray-400';
  if (peak > 0) {
    const r = recent / peak;
    if (r >= 0.8) { arrow = '↑'; arrowColor = 'text-red-500'; }
    else if (r <= 0.3) { arrow = '↓'; arrowColor = 'text-[#576b95]'; }
  }

  const meta = TIER_MAP[tier];
  const daysLabel = daysSince < 1 ? '今天' : daysSince < 2 ? '昨天' : `${Math.floor(daysSince)} 天前`;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${meta.bg} ${className}`}
      title={`温度：${meta.label} · 最后消息 ${daysLabel} · 近一月 ${recent}/峰值 ${peak}`}
    >
      <span className="text-sm leading-none">{meta.emoji}</span>
      <span className={`text-xs font-bold ${meta.color}`}>{meta.label}</span>
      {peak > 0 && <span className={`text-xs font-black ${arrowColor}`}>{arrow}</span>}
    </span>
  );
};
