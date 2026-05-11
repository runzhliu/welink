/**
 * useImageTask — 提交异步生图任务、轮询进度、支持取消。
 *
 * 内部走 POST /api/image/tasks 提交，立即拿 task_id；
 * 然后每 1.5s 轮询 GET /api/image/tasks/:id 拿进度与状态；
 * 完成后从 task.result_hash 拼出 /api/image/cache/<hash> URL；
 * 调用 cancel() 等于 DELETE /api/image/tasks/:id。
 *
 * 多张图并行：每张图调用 submit 一次拿独立的 taskId；hook 状态对应一张图。
 * 想要"多张图共享 hook"的话外层自己持有 map。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';

export type ImageTaskStatus = 'idle' | 'queued' | 'running' | 'done' | 'failed' | 'canceled';

export interface ImageTaskRecord {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'canceled';
  progress: number;
  scene: string;
  prompt: string;
  provider: string;
  model: string;
  size: string;
  profile_id?: string;
  result_hash?: string;
  error?: string;
  created_at: number;
}

export interface ImageSubmitOptions {
  prompt: string;
  size?: string;
  scene?: string;
  profile_id?: string;
  ref_user?: string;
  ref_kind?: string;
}

interface UseImageTaskResult {
  status: ImageTaskStatus;
  progress: number;     // 0-100；done 时 100
  url: string | null;   // done 时填 /api/image/cache/<hash>；其它时为 null
  error: string | null;
  taskId: string | null;
  submit: (opts: ImageSubmitOptions) => Promise<void>;
  /** 提交到自定义 endpoint（用于「基于已有图重生成」等场景）。
   *  endpoint 必须返回 `{ id, task }` 形态。 */
  submitTo: (endpoint: string, body: Record<string, unknown>) => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
}

const POLL_INTERVAL_MS = 1500;

export function useImageTask(): UseImageTaskResult {
  const [status, setStatus] = useState<ImageTaskStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stoppedRef = useRef(false); // 取消 / 完成 / 失败 / unmount 都置 true

  const stopPolling = useCallback(() => {
    stoppedRef.current = true;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // unmount cleanup
  useEffect(() => () => stopPolling(), [stopPolling]);

  const pollOnce = useCallback(async (id: string) => {
    try {
      const r = await axios.get<ImageTaskRecord>(`/api/image/tasks/${id}`);
      const t = r.data;
      setProgress(t.progress);
      if (t.status === 'done' && t.result_hash) {
        setStatus('done');
        setProgress(100);
        setUrl(`/api/image/cache/${t.result_hash}`);
        stopPolling();
      } else if (t.status === 'failed') {
        setStatus('failed');
        setError(t.error || '生图失败');
        stopPolling();
      } else if (t.status === 'canceled') {
        setStatus('canceled');
        stopPolling();
      } else if (t.status === 'running') {
        setStatus('running');
      } else if (t.status === 'queued') {
        setStatus('queued');
      }
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? '查询任务失败';
      setStatus('failed');
      setError(msg);
      stopPolling();
    }
  }, [stopPolling]);

  const startPolling = useCallback((id: string, t?: ImageTaskRecord) => {
    setTaskId(id);
    if (t && t.status === 'done' && t.result_hash) {
      setStatus('done');
      setProgress(100);
      setUrl(`/api/image/cache/${t.result_hash}`);
      return;
    }
    timerRef.current = setInterval(() => {
      if (stoppedRef.current) return;
      void pollOnce(id);
    }, POLL_INTERVAL_MS);
    void pollOnce(id); // 立即拉一次
  }, [pollOnce]);

  const submit = useCallback(async (opts: ImageSubmitOptions) => {
    stoppedRef.current = false;
    setStatus('queued');
    setProgress(0);
    setUrl(null);
    setError(null);
    setTaskId(null);
    try {
      const r = await axios.post<{ id: string; task: ImageTaskRecord }>('/api/image/tasks', opts);
      startPolling(r.data.id, r.data.task);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? '提交失败';
      setStatus('failed');
      setError(msg);
    }
  }, [startPolling]);

  const submitTo = useCallback(async (endpoint: string, body: Record<string, unknown>) => {
    stoppedRef.current = false;
    setStatus('queued');
    setProgress(0);
    setUrl(null);
    setError(null);
    setTaskId(null);
    try {
      const r = await axios.post<{ id: string; task: ImageTaskRecord }>(endpoint, body);
      startPolling(r.data.id, r.data.task);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? '提交失败';
      setStatus('failed');
      setError(msg);
    }
  }, [startPolling]);

  const cancel = useCallback(async () => {
    if (!taskId) return;
    try {
      await axios.delete(`/api/image/tasks/${taskId}`);
    } catch {
      // 失败不影响 UI，前端已经主动 stop
    }
    setStatus('canceled');
    stopPolling();
  }, [taskId, stopPolling]);

  const reset = useCallback(() => {
    stopPolling();
    setStatus('idle');
    setProgress(0);
    setUrl(null);
    setError(null);
    setTaskId(null);
    stoppedRef.current = false;
  }, [stopPolling]);

  return { status, progress, url, error, taskId, submit, submitTo, cancel, reset };
}
