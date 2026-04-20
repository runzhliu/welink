import React, { useEffect, useRef, useState } from 'react';
import { Mic, X, Play, Pause, SkipForward, RotateCcw, Loader2, AlertCircle } from 'lucide-react';
import axios from 'axios';
import type { ContactStats } from '../../types';

interface PodcastLine {
  speaker: 'A' | 'B';
  text: string;
}

interface PodcastScript {
  title: string;
  lines: PodcastLine[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  contact: ContactStats;
}

// Phase 3 播客回顾：生成双人对话脚本 → 按句 TTS → 顺序播放 + 当前行高亮
export const PodcastModal: React.FC<Props> = ({ open, onClose, contact }) => {
  const [duration, setDuration] = useState<3 | 5 | 10>(5);
  const [script, setScript] = useState<PodcastScript | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  const [genErr, setGenErr] = useState<string | null>(null);
  const [currentIdx, setCurrentIdx] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [lineErr, setLineErr] = useState<{ idx: number; msg: string } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // 缓存每行的 MP3 blob URL，避免重放重复合成
  const audioCache = useRef<Map<number, string>>(new Map());
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 关闭时清理
  useEffect(() => {
    if (!open) return;
    return () => {
      // cleanup
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
      audioCache.current.forEach(url => URL.revokeObjectURL(url));
      audioCache.current.clear();
    };
  }, [open]);

  // 当前行变化：自动滚动到可见区域
  useEffect(() => {
    if (currentIdx < 0 || !scrollRef.current) return;
    const el = scrollRef.current.querySelector<HTMLElement>(`[data-line-idx="${currentIdx}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [currentIdx]);

  const generate = async () => {
    setGenBusy(true);
    setGenErr(null);
    setScript(null);
    try {
      const r = await axios.post<PodcastScript>('/api/podcast/generate-script', {
        contact_key: 'contact:' + contact.username,
        duration_minutes: duration,
      });
      setScript(r.data);
      setCurrentIdx(-1);
      // 清理上一场的音频缓存
      audioCache.current.forEach(url => URL.revokeObjectURL(url));
      audioCache.current.clear();
    } catch (e: unknown) {
      const anyE = e as { response?: { data?: { error?: string; raw?: string } }; message?: string };
      setGenErr(anyE?.response?.data?.error || anyE?.message || '生成失败');
    } finally {
      setGenBusy(false);
    }
  };

  // 获取某行的音频（带缓存）
  const fetchAudio = async (idx: number): Promise<string | null> => {
    if (!script) return null;
    if (audioCache.current.has(idx)) return audioCache.current.get(idx)!;
    const line = script.lines[idx];
    if (!line) return null;
    try {
      const resp = await axios.post('/api/podcast/tts', {
        text: line.text,
        speaker: line.speaker,
      }, { responseType: 'blob' });
      const url = URL.createObjectURL(resp.data);
      audioCache.current.set(idx, url);
      return url;
    } catch (e: unknown) {
      const anyE = e as { response?: { data?: unknown }; message?: string };
      // blob 错误响应是个 Blob，需要 text() 读出来
      let msg = anyE?.message || 'TTS 失败';
      const blob = anyE?.response?.data;
      if (blob instanceof Blob) {
        try {
          const t = await blob.text();
          const j = JSON.parse(t);
          msg = j.error || t;
        } catch { /* 忽略 */ }
      }
      setLineErr({ idx, msg });
      return null;
    }
  };

  // 播放指定行
  const playFrom = async (idx: number) => {
    if (!script || idx >= script.lines.length) {
      setPlaying(false);
      setCurrentIdx(-1);
      return;
    }
    setCurrentIdx(idx);
    setPlaying(true);
    setLineErr(null);
    const url = await fetchAudio(idx);
    if (!url) {
      // TTS 失败，跳到下一行
      setTimeout(() => playFrom(idx + 1), 1500);
      return;
    }
    if (!audioRef.current) audioRef.current = new Audio();
    const a = audioRef.current;
    a.src = url;
    a.onended = () => {
      // 预取下一行（如果有）的同时，当前行播放 → 下一行
      void playFrom(idx + 1);
    };
    a.onerror = () => {
      setLineErr({ idx, msg: '音频播放失败' });
      setTimeout(() => playFrom(idx + 1), 1500);
    };
    try {
      await a.play();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setLineErr({ idx, msg: err.message || '播放失败' });
    }
    // 后台预取下一行
    if (idx + 1 < script.lines.length) {
      void fetchAudio(idx + 1);
    }
  };

  const togglePlay = () => {
    if (!script) return;
    if (playing) {
      audioRef.current?.pause();
      setPlaying(false);
    } else if (currentIdx < 0) {
      void playFrom(0);
    } else {
      audioRef.current?.play().catch(() => {});
      setPlaying(true);
    }
  };

  const skipNext = () => {
    if (!script || currentIdx < 0) return;
    audioRef.current?.pause();
    void playFrom(currentIdx + 1);
  };

  const restart = () => {
    audioRef.current?.pause();
    setCurrentIdx(-1);
    setPlaying(false);
    setLineErr(null);
  };

  const handleClose = () => {
    audioRef.current?.pause();
    onClose();
  };

  if (!open) return null;

  const contactName = contact.remark || contact.nickname || contact.username;

  return (
    <div className="fixed inset-0 z-[9500] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={handleClose}>
      <div className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-3xl bg-white dark:bg-[#1d1d1f] shadow-2xl border border-gray-100 dark:border-white/10" onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-white/10 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-md shrink-0">
              <Mic size={20} className="text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-black dk-text truncate">播客回顾</h2>
              <p className="text-xs text-gray-400 truncate">关于你和 {contactName} · 双主持人对话</p>
            </div>
          </div>
          <button onClick={handleClose} className="shrink-0 p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-white/10">
            <X size={18} />
          </button>
        </div>

        {/* 生成前：选时长 */}
        {!script && !genBusy && (
          <div className="p-8 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
              AI 会基于你和 TA 的聊天统计（消息量 / 高峰时段 / 互动节奏 / 红包转账 等）生成两位主持人的对话脚本，再用 TTS 合成语音播报。
            </p>
            <div className="inline-flex gap-2 mb-6">
              {[3, 5, 10].map(n => (
                <button
                  key={n}
                  onClick={() => setDuration(n as 3 | 5 | 10)}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                    duration === n
                      ? 'bg-purple-500 text-white'
                      : 'bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/15'
                  }`}
                >
                  {n} 分钟
                </button>
              ))}
            </div>
            <div>
              <button
                onClick={generate}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm font-semibold hover:opacity-90 transition-opacity flex items-center gap-2 mx-auto"
              >
                <Mic size={14} />
                生成脚本
              </button>
              <p className="text-[11px] text-gray-400 mt-3">
                需先在<span className="text-gray-500 dark:text-gray-300"> 设置 → 播客 TTS </span>配置 OpenAI TTS API Key
              </p>
            </div>
            {genErr && (
              <div className="mt-4 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-xs">
                <AlertCircle size={14} /> {genErr}
              </div>
            )}
          </div>
        )}

        {/* 生成中 */}
        {genBusy && (
          <div className="p-12 text-center">
            <Loader2 size={32} className="animate-spin text-purple-500 mx-auto mb-3" />
            <p className="text-sm text-gray-500">AI 正在写脚本…（30-60 秒）</p>
          </div>
        )}

        {/* 脚本 + 播放器 */}
        {script && (
          <>
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-3">
              {script.title && (
                <h3 className="text-lg font-bold dk-text mb-3 text-center">🎙 {script.title}</h3>
              )}
              {script.lines.map((line, idx) => {
                const active = idx === currentIdx;
                const done = currentIdx > idx;
                const err = lineErr?.idx === idx;
                const speakerColor = line.speaker === 'A'
                  ? 'from-blue-500 to-cyan-500'
                  : 'from-pink-500 to-purple-500';
                return (
                  <div
                    key={idx}
                    data-line-idx={idx}
                    className={`flex gap-3 p-3 rounded-2xl transition-all ${
                      active ? 'bg-purple-50 dark:bg-purple-900/20 ring-2 ring-purple-400' :
                      done ? 'opacity-50' : ''
                    }`}
                  >
                    <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${speakerColor} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                      {line.speaker}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm leading-relaxed break-words ${active ? 'font-medium dk-text' : 'text-gray-600 dark:text-gray-400'}`}>
                        {line.text}
                      </p>
                      {err && (
                        <p className="text-[10px] text-red-500 mt-1 flex items-center gap-1">
                          <AlertCircle size={10} /> {lineErr?.msg}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 播放控制 */}
            <div className="shrink-0 p-4 border-t border-gray-100 dark:border-white/10 flex items-center gap-2">
              <button
                onClick={togglePlay}
                className="w-12 h-12 rounded-2xl bg-purple-500 text-white flex items-center justify-center hover:bg-purple-600 transition-colors shadow-md"
              >
                {playing ? <Pause size={20} /> : <Play size={20} />}
              </button>
              <button
                onClick={skipNext}
                disabled={currentIdx < 0 || currentIdx >= script.lines.length - 1}
                className="p-3 rounded-xl text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10 disabled:opacity-30"
                title="下一句"
              >
                <SkipForward size={18} />
              </button>
              <button
                onClick={restart}
                className="p-3 rounded-xl text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10"
                title="重新播放"
              >
                <RotateCcw size={18} />
              </button>
              <div className="flex-1 text-right text-xs text-gray-400">
                {currentIdx >= 0
                  ? `${currentIdx + 1} / ${script.lines.length}`
                  : `${script.lines.length} 句对话 · 点 ▶ 开始`}
              </div>
              <button
                onClick={() => { setScript(null); restart(); }}
                className="px-3 py-2 rounded-xl text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10"
                title="重新生成"
              >
                重新生成
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
