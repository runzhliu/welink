/**
 * 全局 AI 分析对话状态 store
 * - 运行时：useSyncExternalStore，组件卸载后状态保留，后台 fetch 继续写入
 * - 持久化：SQLite（via /api/ai/conversations），容器重启后恢复
 */

import { useSyncExternalStore } from 'react';

export interface AnalysisMessage {
  role: 'user' | 'assistant';
  content: string;
  thinking?: string; // 思考型模型的推理过程（Ollama reasoning）
  streaming?: boolean;
  provider?: string;
  model?: string;
  elapsedSecs?: number;
  tokensPerSec?: number;
  charCount?: number;
  timestamp?: number; // Unix ms，回答完成时刻
}

export interface AnalysisState {
  messages: AnalysisMessage[];
  loading: boolean;
  chunkProgress: { current: number; total: number } | null;
  /** 当前请求的 abort controller */
  abort: AbortController | null;
  /** 是否已从数据库加载过 */
  dbLoaded: boolean;
}

const defaultState = (): AnalysisState => ({
  messages: [],
  loading: false,
  chunkProgress: null,
  abort: null,
  dbLoaded: false,
});

// ── 内部存储 ───────────────────────────────────────────────────────────────────

const _store = new Map<string, AnalysisState>();
const _listeners = new Set<() => void>();
let _snapshot = new Map(_store);

function _notify() {
  _snapshot = new Map(_store);
  _listeners.forEach(l => l());
}

// ── 数据库 API ────────────────────────────────────────────────────────────────

/** 从后端加载历史消息（仅在 dbLoaded=false 时调用一次） */
export async function loadFromDB(key: string): Promise<void> {
  const cur = getAnalysisState(key);
  if (cur.dbLoaded) return;
  try {
    const r = await fetch(`/api/ai/conversations?key=${encodeURIComponent(key)}`);
    if (!r.ok) return;
    const data = await r.json() as { messages?: AnalysisMessage[] };
    const msgs = (data.messages ?? []).map(m => ({ ...m, streaming: false }));
    _store.set(key, { ...getAnalysisState(key), messages: msgs, dbLoaded: true });
    _notify();
  } catch {
    // 网络失败时静默：内存中已有的消息不受影响
    _store.set(key, { ...getAnalysisState(key), dbLoaded: true });
    _notify();
  }
}

/** 将已完成的消息持久化到后端（防抖 800ms） */
const _saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
export function scheduleSaveToDB(key: string) {
  const t = _saveTimers.get(key);
  if (t) clearTimeout(t);
  _saveTimers.set(key, setTimeout(async () => {
    const state = getAnalysisState(key);
    const done = state.messages.filter(m => !m.streaming);
    if (done.length === 0) return;
    try {
      await fetch('/api/ai/conversations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, messages: done }),
      });
    } catch { /* 静默忽略 */ }
  }, 800));
}

/** 从数据库删除指定 key */
export async function deleteFromDB(key: string): Promise<void> {
  try {
    await fetch(`/api/ai/conversations?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
  } catch { /* 静默忽略 */ }
}

// ── 公开 API ──────────────────────────────────────────────────────────────────

export function subscribeAnalysis(cb: () => void) {
  _listeners.add(cb);
  return () => { _listeners.delete(cb); };
}

export function getAnalysisSnapshot() {
  return _snapshot;
}

export function getAnalysisState(key: string): AnalysisState {
  return _store.get(key) ?? defaultState();
}

export function updateAnalysisState(
  key: string,
  updater: (prev: AnalysisState) => AnalysisState,
) {
  _store.set(key, updater(getAnalysisState(key)));
  _notify();
}

export function clearAnalysisState(key: string) {
  _store.delete(key);
  _notify();
}

// ── React hook ────────────────────────────────────────────────────────────────

export function useAnalysisState(key: string): AnalysisState {
  const snap = useSyncExternalStore(subscribeAnalysis, getAnalysisSnapshot);
  return snap.get(key) ?? defaultState();
}
