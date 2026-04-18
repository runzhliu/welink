/**
 * 群号称卡（群的 MBTI）—— 基于群画像数据规则派生 2-4 个标签
 * 所有信号都来自已有 GroupDetail 字段，零 LLM / 零后端改动
 */

import type { GroupDetail } from '../types';

export interface GroupPersonaTag {
  label: string;    // 标签文字
  emoji: string;
  tone: 'red' | 'blue' | 'green' | 'orange' | 'purple' | 'gray';
}

export const getGroupPersonaTags = (d: GroupDetail | null): GroupPersonaTag[] => {
  if (!d) return [];
  const tags: GroupPersonaTag[] = [];

  const totalMsg = (d.hourly_dist || []).reduce((a, b) => a + b, 0);
  if (totalMsg < 100) return tags; // 数据太少不贴标签

  // ── 活跃时段 ─────────────────────────────────────────────────────
  const lateNight = (d.hourly_dist?.[0] ?? 0) + (d.hourly_dist?.[1] ?? 0) + (d.hourly_dist?.[2] ?? 0) + (d.hourly_dist?.[3] ?? 0);
  const workHour = (d.hourly_dist?.[9] ?? 0) + (d.hourly_dist?.[10] ?? 0) + (d.hourly_dist?.[11] ?? 0) + (d.hourly_dist?.[14] ?? 0) + (d.hourly_dist?.[15] ?? 0) + (d.hourly_dist?.[16] ?? 0);
  const eveningHour = (d.hourly_dist?.[19] ?? 0) + (d.hourly_dist?.[20] ?? 0) + (d.hourly_dist?.[21] ?? 0) + (d.hourly_dist?.[22] ?? 0);

  if (lateNight / totalMsg > 0.15) {
    tags.push({ label: '深夜话唠', emoji: '🌙', tone: 'purple' });
  } else if (workHour / totalMsg > 0.55) {
    tags.push({ label: '工作日正午群', emoji: '🏢', tone: 'blue' });
  } else if (eveningHour / totalMsg > 0.45) {
    tags.push({ label: '晚八点饭后群', emoji: '🍚', tone: 'orange' });
  }

  // ── 周末 vs 工作日 ───────────────────────────────────────────────
  const weekend = (d.weekly_dist?.[0] ?? 0) + (d.weekly_dist?.[6] ?? 0); // Sun + Sat
  const weekday = totalMsg - weekend;
  if (weekend / totalMsg > 0.4) {
    tags.push({ label: '周末活跃', emoji: '🏖️', tone: 'green' });
  } else if (weekend / totalMsg < 0.15 && weekday > 200) {
    tags.push({ label: '工作日只上班群', emoji: '📅', tone: 'gray' });
  }

  // ── 消息类型指纹 ────────────────────────────────────────────────
  const tdist = d.type_dist || {};
  const emoji = (tdist['表情'] ?? 0) / totalMsg;
  const image = (tdist['图片'] ?? 0) / totalMsg;
  const link = (tdist['链接分享'] ?? 0) / totalMsg;
  const voice = (tdist['语音'] ?? 0) / totalMsg;
  const redpkg = ((tdist['红包'] ?? 0) + (tdist['转账'] ?? 0)) / totalMsg;
  const video = (tdist['视频'] ?? 0) / totalMsg;

  if (emoji > 0.12) tags.push({ label: '表情包战场', emoji: '😂', tone: 'orange' });
  if (image + video > 0.25) tags.push({ label: '图包王国', emoji: '📸', tone: 'blue' });
  if (link > 0.08) tags.push({ label: '链接集散地', emoji: '🔗', tone: 'blue' });
  if (voice > 0.1) tags.push({ label: '语音派对', emoji: '🎙️', tone: 'purple' });
  if (redpkg > 0.03) tags.push({ label: '红包雨', emoji: '🧧', tone: 'red' });

  // ── 话痨度（每日均值 + 人均）────────────────────────────────────
  const daysCnt = Object.keys(d.daily_heatmap || {}).length;
  const dailyAvg = daysCnt > 0 ? totalMsg / daysCnt : 0;
  if (dailyAvg >= 200) {
    tags.push({ label: '消息洪流', emoji: '🌊', tone: 'red' });
  } else if (dailyAvg < 2 && daysCnt > 30) {
    tags.push({ label: '静默多数派', emoji: '🤐', tone: 'gray' });
  }

  const members = d.member_rank || [];
  const active = members.filter(m => m.count > 0).length;
  const silent = members.length - active;
  if (silent > 0 && members.length > 10 && silent / members.length > 0.6) {
    tags.push({ label: '潜水员联盟', emoji: '🤿', tone: 'gray' });
  }

  // 限制最多 4 个，按顺序取前 4
  return tags.slice(0, 4);
};

export const toneClasses = (t: GroupPersonaTag['tone']): string => {
  switch (t) {
    case 'red':    return 'bg-[#fa5151]/10 text-[#fa5151]';
    case 'blue':   return 'bg-[#10aeff]/10 text-[#10aeff]';
    case 'green':  return 'bg-[#07c160]/10 text-[#07c160]';
    case 'orange': return 'bg-[#ff9500]/10 text-[#ff9500]';
    case 'purple': return 'bg-[#576b95]/10 text-[#576b95]';
    default:       return 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-400';
  }
};
