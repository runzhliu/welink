/**
 * 关系预测周快照历史（客户端，localStorage）
 *
 * 维护最近 6 周每周一次的联系人状态快照。写入是 idempotent 的 —— 同一周
 * 重复写入会合并为最新一次；每次写入只保留每周一个条目，总数上限 6。
 *
 * 用于：
 *   - 首页「每周变化」条（对比最近两次快照）
 *   - 卡片「连续冷却 N 周」徽章（从最新一次往回数连续命中 cooling/endangered 的周数）
 */

import type { ForecastStatus, ForecastResponse } from '../types';

export const SNAP_HISTORY_KEY = 'welink:forecast-history';
const MAX_SNAPSHOTS = 6;

export type Snapshot = {
  weekKey: string;    // ISO week, e.g. "2026-W16"
  ts: number;         // Unix 秒
  statuses: Record<string, ForecastStatus>;
};

// ISO 周：年份 + W + 周序号
export const isoWeekKey = (d = new Date()): string => {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${weekNo}`;
};

export const loadHistory = (): Snapshot[] => {
  try {
    const raw = localStorage.getItem(SNAP_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as Snapshot[] : [];
  } catch { return []; }
};

const saveHistory = (history: Snapshot[]) => {
  try { localStorage.setItem(SNAP_HISTORY_KEY, JSON.stringify(history)); } catch { /* quota */ }
};

/**
 * 从 ForecastResponse.all 提取状态映射；若 all 缺失，基于 suggest_contact 构造
 * （suggest_contact 只含 cooling/endangered，其它联系人的状态会丢失，但对「连续
 * 冷却」计算影响不大，因为我们只关心是否 ∈ {cooling, endangered}）。
 */
export const extractStatuses = (resp: ForecastResponse): Record<string, ForecastStatus> => {
  const out: Record<string, ForecastStatus> = {};
  const list = resp.all ?? resp.suggest_contact;
  for (const e of list) out[e.username] = e.status;
  return out;
};

/**
 * 写入当前周快照。同一周重复写入会合并（覆盖）。返回新的历史数组。
 */
export const upsertSnapshot = (statuses: Record<string, ForecastStatus>, ts?: number): Snapshot[] => {
  const now = ts ?? Math.floor(Date.now() / 1000);
  const weekKey = isoWeekKey();
  const history = loadHistory();
  const idx = history.findIndex(s => s.weekKey === weekKey);
  const entry: Snapshot = { weekKey, ts: now, statuses };
  if (idx >= 0) {
    history[idx] = entry;
  } else {
    history.push(entry);
  }
  history.sort((a, b) => a.ts - b.ts);
  const trimmed = history.slice(-MAX_SNAPSHOTS);
  saveHistory(trimmed);
  return trimmed;
};

/**
 * 连续冷却周数：从最新快照往回数，统计 username 连续处于
 * cooling / endangered 的周数。latestIsCooling=false 时返回 0。
 */
export const consecutiveCoolingWeeks = (history: Snapshot[], username: string): number => {
  if (history.length === 0) return 0;
  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const s = history[i].statuses[username];
    if (s === 'cooling' || s === 'endangered') {
      count++;
    } else {
      break;
    }
  }
  return count;
};
