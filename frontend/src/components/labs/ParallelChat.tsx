/**
 * 平行宇宙对话 —— "如果……" 我们之间会怎么聊
 *
 * 选 1 个联系人 + 输入一个虚构场景 → SSE 流式从 /api/ai/parallel-chat 拿对话。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles, Loader2, Search, Wand2, Square, Share2, Check, RefreshCw,
} from 'lucide-react';
import { toPng } from 'html-to-image';
import type { ContactStats } from '../../types';
import { avatarSrc } from '../../utils/avatar';
import { getServerURL, getToken } from '../../runtimeConfig';

interface Props {
  contacts: ContactStats[];
}

interface TurnMsg {
  speaker: string; // "我" 或对方 username
  displayName: string;
  content: string;
  avatar?: string;
  streaming?: boolean;
}

const PRESET_SCENARIOS = [
  '如果我们五年前就认识',
  '如果我们是同事',
  '如果我们正在异地恋',
  '如果我现在跟你求婚',
  '如果我们一起去东京旅行',
  '如果我们重新认识一次',
];

const displayOf = (c: ContactStats) => c.remark || c.nickname || c.username;

export const ParallelChat: React.FC<Props> = ({ contacts }) => {
  const [picked, setPicked] = useState<ContactStats | null>(null);
  const [search, setSearch] = useState('');
  const [scenario, setScenario] = useState('');
  const [history, setHistory] = useState<TurnMsg[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // historyRef 跟随 history，stream 里 push fresh 时直接读 historyRef.current.length 取索引，
  // 这样 setHistory 的 reducer 保持纯函数（不在回调里写外部变量）。
  const historyRef = useRef<TurnMsg[]>([]);
  // setHistory 的所有调用都改走它：同步推进 historyRef，避免 commit 时机让 ref 落后于真实长度。
  const updateHistory = (next: TurnMsg[] | ((h: TurnMsg[]) => TurnMsg[])) => {
    const computed = typeof next === 'function' ? (next as (h: TurnMsg[]) => TurnMsg[])(historyRef.current) : next;
    historyRef.current = computed;
    setHistory(computed);
  };

  const filtered = useMemo(() => {
    const base = contacts.filter(c => !c.username.endsWith('@chatroom') && (c.total_messages || 0) >= 30);
    base.sort((a, b) => (b.total_messages || 0) - (a.total_messages || 0));
    const q = search.trim().toLowerCase();
    if (!q) return base.slice(0, 80);
    return base.filter(c =>
      (c.remark || '').toLowerCase().includes(q) ||
      (c.nickname || '').toLowerCase().includes(q) ||
      c.username.toLowerCase().includes(q),
    ).slice(0, 80);
  }, [contacts, search]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [history]);

  const generate = async () => {
    if (!picked || !scenario.trim() || loading) return;
    setLoading(true);
    setErr('');
    updateHistory([]);
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const server = getServerURL().replace(/\/+$/, '');
      const token = getToken();
      const resp = await fetch((server || '') + '/api/ai/parallel-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          username: picked.username,
          scenario: scenario.trim(),
          turns: 10,
        }),
        signal: abort.signal,
      });
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({})) as { error?: string };
        throw new Error(j.error || resp.statusText);
      }
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      // 用 index 寻址当前条，避免"先 push fresh、再 setHistory(h.map(x => x === fresh ? copy : x))
      // 把数组里的 fresh 替换成新拷贝后，cur 还指向已不在数组里的 fresh、后续 delta 全丢"的 bug。
      let curIdx = -1;
      const finalizeCur = () => {
        if (curIdx < 0) return;
        const i = curIdx;
        updateHistory(h => h.map((x, idx) => (idx === i ? { ...x, streaming: false } : x)));
        curIdx = -1;
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const chunk = JSON.parse(line.slice(6)) as {
              meta?: boolean; speaker?: string; display_name?: string;
              delta?: string; done?: boolean; turn_end?: boolean; error?: string;
            };
            if (chunk.error) throw new Error(chunk.error);
            if (chunk.meta && chunk.speaker) {
              finalizeCur();
              const isMine = chunk.speaker === '我';
              const speaker = chunk.speaker;
              const fresh: TurnMsg = {
                speaker,
                displayName: chunk.display_name || (isMine ? '我' : displayOf(picked)),
                content: '',
                avatar: isMine ? undefined : (picked.big_head_url || picked.small_head_url),
                streaming: true,
              };
              curIdx = historyRef.current.length;
              updateHistory(h => [...h, fresh]);
              continue;
            }
            if (chunk.delta && curIdx >= 0) {
              const i = curIdx;
              const delta = chunk.delta;
              updateHistory(h => h.map((x, idx) => (idx === i ? { ...x, content: x.content + delta } : x)));
            }
            if (chunk.turn_end || chunk.done) finalizeCur();
          } catch (e) {
            if (!(e instanceof SyntaxError)) throw e;
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setErr((e as Error).message || '生成失败');
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();

  const exportPng = async () => {
    if (history.length === 0 || !cardRef.current || exporting) return;
    setExporting(true);
    // dark 模式下导出：tailwind `dark:` 条件靠 html.class="dark"，clone 后还在同一文档下仍会生效
    // → 浅灰底 + 浅灰字 + 白底 wrapper 几乎看不见。先临时摘掉 html.dark，渲染完再装回去。
    const root = document.documentElement;
    const hadDark = root.classList.contains('dark');
    if (hadDark) root.classList.remove('dark');
    // wrapper 在 try 外声明，toPng 抛错时 finally 也能把它从 DOM 拆掉，避免悬挂节点累积。
    let wrapper: HTMLElement | null = null;
    try {
      const node = cardRef.current.cloneNode(true) as HTMLElement;
      wrapper = document.createElement('div');
      wrapper.style.cssText = `
        width: 720px; background: #ffffff; padding: 0;
        font-family: system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
        position: fixed; left: -10000px; top: 0; z-index: -1;
      `;
      wrapper.appendChild(node);
      const footer = document.createElement('div');
      footer.style.cssText = 'padding:14px 28px; background:#f8f9fb; color:#888; font-size:11px; text-align:center; border-top:1px solid #eee;';
      footer.innerHTML = `WeLink · 平行宇宙对话 · ${new Date().toLocaleDateString('zh-CN')}`;
      wrapper.appendChild(footer);
      document.body.appendChild(wrapper);
      const url = await toPng(wrapper, { pixelRatio: 2, cacheBust: true });
      const a = document.createElement('a');
      a.href = url;
      a.download = `welink-parallel-${Date.now()}.png`;
      a.click();
      setExported(true);
      setTimeout(() => setExported(false), 3000);
    } catch (e) {
      alert('导出失败：' + ((e as Error).message || '未知错误'));
    } finally {
      if (wrapper && wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
      if (hadDark) root.classList.add('dark');
      setExporting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      {/* 设置区 */}
      <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={16} className="text-[#07c160]" />
          <div className="text-sm font-bold text-[#1d1d1f] dark:text-gray-100">平行宇宙对话</div>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          挑一位联系人 + 写一个"如果"场景，AI 会用 ta 平时的说话风格演一段虚构对话。
        </div>
        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜联系人"
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-gray-50 dark:bg-white/5 text-sm text-[#1d1d1f] dark:text-gray-100 border border-transparent focus:border-[#07c160] outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto mb-3">
          {filtered.map(c => {
            const sel = picked?.username === c.username;
            return (
              <button
                key={c.username}
                onClick={() => setPicked(c)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs transition-colors ${
                  sel
                    ? 'bg-[#07c160] text-white font-bold'
                    : 'bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10'
                }`}
              >
                {(c.big_head_url || c.small_head_url) && (
                  <img src={avatarSrc(c.big_head_url || c.small_head_url) || ''} alt="" className="w-4 h-4 rounded-full object-cover" />
                )}
                <span>{displayOf(c)}</span>
              </button>
            );
          })}
        </div>

        <div className="mb-2 flex flex-wrap gap-1.5">
          {PRESET_SCENARIOS.map(s => (
            <button
              key={s}
              onClick={() => setScenario(s)}
              className="text-[11px] px-2 py-1 rounded-lg bg-[#07c160]/10 dark:bg-[#07c160]/15 text-[#07c160] hover:bg-[#07c160]/15 dark:hover:bg-[#07c160]/25"
            >
              {s}
            </button>
          ))}
        </div>
        <textarea
          value={scenario}
          onChange={e => setScenario(e.target.value)}
          placeholder="或自己写一个场景：如果我们……"
          rows={2}
          className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-white/5 text-sm text-[#1d1d1f] dark:text-gray-100 border border-transparent focus:border-[#07c160] outline-none resize-none"
        />

        <div className="flex items-center justify-between mt-3">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {picked ? <>对方：<strong className="text-[#1d1d1f] dark:text-gray-100">{displayOf(picked)}</strong></> : '选一位联系人'}
          </div>
          <div className="flex gap-2">
            {loading && (
              <button onClick={stop} className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-semibold bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-gray-300">
                <Square size={12} /> 停止
              </button>
            )}
            <button
              onClick={generate}
              disabled={!picked || !scenario.trim() || loading}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-[#07c160] hover:bg-[#06a850] disabled:opacity-50"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : history.length > 0 ? <RefreshCw size={14} /> : <Wand2 size={14} />}
              {loading ? '生成中…' : history.length > 0 ? '重新演一遍' : '开始演绎'}
            </button>
          </div>
        </div>
      </div>

      {err && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/30 p-3 mb-4 text-xs text-red-700 dark:text-red-300">{err}</div>
      )}

      {history.length > 0 && (
        <>
          <div className="flex justify-end mb-2">
            <button
              onClick={exportPng}
              disabled={exporting || loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 disabled:opacity-50"
            >
              {exporting ? <Loader2 size={12} className="animate-spin" /> : exported ? <Check size={12} className="text-[#07c160]" /> : <Share2 size={12} />}
              {exporting ? '生成图片…' : exported ? '已下载' : '导出'}
            </button>
          </div>

          <div ref={cardRef} className="rounded-2xl bg-white dark:bg-[#1c1c1e] overflow-hidden border border-gray-100 dark:border-white/10">
            <div className="px-7 py-5 bg-[#07c160]/8 dark:bg-[#07c160]/10 border-b border-[#07c160]/15">
              <div className="text-xs uppercase tracking-widest text-[#07c160] font-bold mb-1">
                Parallel Universe · 平行宇宙
              </div>
              <div className="text-xl font-black text-[#1d1d1f] dark:text-gray-100 leading-snug">
                {scenario}
              </div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                与 {picked ? displayOf(picked) : ''} 的虚构对话 · 仅供娱乐
              </div>
            </div>
            <div ref={scrollRef} className="px-5 py-5 space-y-3 max-h-[60vh] overflow-y-auto bg-gray-50/40 dark:bg-transparent">
              {history.map((m, i) => {
                const mine = m.speaker === '我';
                return (
                  <div key={i} className={`flex gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
                    {!mine && (
                      m.avatar ? (
                        <img src={avatarSrc(m.avatar) || ''} className="w-8 h-8 rounded-full object-cover bg-gray-200" alt="" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-white/10" />
                      )
                    )}
                    {mine && <div className="w-8 h-8 rounded-full bg-[#07c160] flex items-center justify-center text-white text-xs font-bold">我</div>}
                    <div className={`max-w-[75%] ${mine ? 'text-right' : ''}`}>
                      <div className={`text-[10px] mb-0.5 ${mine ? 'text-[#07c160]' : 'text-gray-500 dark:text-gray-400'}`}>{m.displayName}</div>
                      <div className={`inline-block px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                        mine
                          ? 'bg-[#07c160] text-white rounded-tr-sm'
                          : 'bg-white dark:bg-white/10 text-gray-800 dark:text-gray-100 rounded-tl-sm shadow-sm'
                      }`}>
                        {m.content}
                        {m.streaming && <span className="ml-0.5 inline-block w-1 h-3 align-middle bg-current animate-pulse" />}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ParallelChat;
