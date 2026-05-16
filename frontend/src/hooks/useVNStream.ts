/**
 * useVNStream — 拉取 VN 下一章 SSE 流。
 *
 * 后端 GET /api/vn/stories/:id/next 返回 text/event-stream，事件类型：
 *   { meta: true, chapter_idx, total }
 *   { delta: "..." }                     narration 增量
 *   { done: true, chapter, state, ending?, title?, synopsis? }
 *   { error: "..." }
 *
 * 用法：const vn = useVNStream(); vn.start(storyId); 后通过 vn.status / narration / chapter 等订阅。
 *
 * 设计注解：用 fetch + getReader 而非 EventSource，跟项目其它 SSE 调用对齐（AICloneTab 等）。
 *   - 优点：可以传 GET 用 query / 也可改 POST、能 abort
 *   - 不需要重连（VN 单次拉一段就结束）
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type VNStreamStatus = 'idle' | 'streaming' | 'done' | 'error' | 'canceled';

export interface VNChoice {
  text: string;
  tone?: string;
  state_delta?: Record<string, unknown>;
}

export interface VNChapter {
  id?: number;
  story_id?: number;
  chapter_idx: number;
  narration: string;
  choices: VNChoice[];
  chosen_idx: number;
  state_after?: VNState;
  image_hash?: string;
  generated_at?: number;
  decided_at?: number;
}

export interface VNState {
  affinity: number;
  tension?: number;
  flags?: string[];
  critical_hits?: number;
  dealbreaker?: boolean;
}

export interface VNEnding {
  type: 'true' | 'happy' | 'normal' | 'bad' | 'secret';
  title?: string;
  epilogue?: string;
  turning_points?: string[];
}

interface UseVNStreamResult {
  status: VNStreamStatus;
  /** 当前章节序号（meta 收到后填） */
  chapterIdx: number | null;
  total: number | null;
  /** narration 增量累积（边接边渲染做打字机） */
  narration: string;
  /** done 后填：完整章节 */
  chapter: VNChapter | null;
  state: VNState | null;
  ending: VNEnding | null;
  title?: string;
  synopsis?: string;
  error: string | null;
  /** 开始拉取下一章流 */
  start: (storyId: number) => Promise<void>;
  /** 中止当前流式（不会回退后端章节，已 emit 的 delta 保留） */
  cancel: () => void;
  /** 重置 hook 到 idle */
  reset: () => void;
}

export function useVNStream(): UseVNStreamResult {
  const [status, setStatus] = useState<VNStreamStatus>('idle');
  const [chapterIdx, setChapterIdx] = useState<number | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [narration, setNarration] = useState('');
  const [chapter, setChapter] = useState<VNChapter | null>(null);
  const [state, setState] = useState<VNState | null>(null);
  const [ending, setEnding] = useState<VNEnding | null>(null);
  const [title, setTitle] = useState<string | undefined>();
  const [synopsis, setSynopsis] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus(prev => (prev === 'streaming' ? 'canceled' : prev));
  }, []);

  const reset = useCallback(() => {
    cancel();
    setStatus('idle');
    setChapterIdx(null);
    setTotal(null);
    setNarration('');
    setChapter(null);
    setState(null);
    setEnding(null);
    setTitle(undefined);
    setSynopsis(undefined);
    setError(null);
  }, [cancel]);

  // unmount cleanup
  useEffect(() => () => cancel(), [cancel]);

  const start = useCallback(async (storyId: number) => {
    reset();
    setStatus('streaming');

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const resp = await fetch(`/api/vn/stories/${storyId}/next`, {
        method: 'GET',
        signal: abort.signal,
      });
      if (!resp.ok) {
        const errBody = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error ?? resp.statusText);
      }
      if (!resp.body) throw new Error('浏览器不支持流式读取');

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let narrAcc = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const obj = JSON.parse(line.slice(6)) as {
              meta?: boolean;
              chapter_idx?: number;
              total?: number;
              delta?: string;
              done?: boolean;
              chapter?: VNChapter;
              state?: VNState;
              ending?: VNEnding;
              title?: string;
              synopsis?: string;
              error?: string;
            };
            if (obj.error) throw new Error(obj.error);
            if (obj.meta) {
              if (typeof obj.chapter_idx === 'number') setChapterIdx(obj.chapter_idx);
              if (typeof obj.total === 'number') setTotal(obj.total);
              continue;
            }
            if (obj.delta) {
              narrAcc += obj.delta;
              setNarration(narrAcc);
              continue;
            }
            if (obj.done) {
              if (obj.chapter) setChapter(obj.chapter);
              if (obj.state) setState(obj.state);
              if (obj.ending) setEnding(obj.ending);
              if (obj.title) setTitle(obj.title);
              if (obj.synopsis) setSynopsis(obj.synopsis);
              setStatus('done');
              return;
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }
      // 流读完但没收到 done 事件
      if (!narrAcc) {
        throw new Error('未收到任何内容');
      }
      setStatus('done');
    } catch (e: unknown) {
      if ((e as { name?: string })?.name === 'AbortError') {
        setStatus('canceled');
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setStatus('error');
    } finally {
      abortRef.current = null;
    }
  }, [reset]);

  return {
    status,
    chapterIdx,
    total,
    narration,
    chapter,
    state,
    ending,
    title,
    synopsis,
    error,
    start,
    cancel,
    reset,
  };
}
