import React, { useEffect, useRef, useState } from 'react';
import { Volume2, Pause, Play, Loader2, AlertCircle } from 'lucide-react';
import axios from 'axios';

// ─── 全局互斥：同一时间只有一个 TTSButton 在播 ──────────────────────────────
// 每个 button 注册 stop 到模块级 Map；新 button 开播时遍历停掉别人。
type StopFn = () => void;
const liveControllers = new Map<string, StopFn>();

const stopAllExcept = (exceptId: string) => {
  for (const [id, stop] of liveControllers.entries()) {
    if (id !== exceptId) stop();
  }
};

interface Props {
  // 要朗读的文本（Markdown / 代码块不会自动剥，调用方自己处理）
  text: string;
  // 发言人 A / B（对应 prefs.PodcastTTSVoiceA/B），默认 A
  speaker?: 'A' | 'B';
  // 按钮尺寸，默认 14
  size?: number;
  className?: string;
  // 禁用时置灰（外部判断条件时用，比如流式未结束）
  disabled?: boolean;
  // Tooltip 文字覆盖
  title?: string;
  // 图标旁是否带文字标签（默认 false，紧凑布局用；文字按钮组里要 true 保持一致）
  showLabel?: boolean;
}

type Status = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

/**
 * AI 输出通用「朗读」按钮。点击调 /api/podcast/tts 整段合成 + 播放。
 * 配置复用「设置 → 播客 TTS」一套。
 * 全局互斥：点一个会停其它。
 */
export const TTSButton: React.FC<Props> = ({ text, speaker = 'A', size = 14, className = '', disabled, title, showLabel = false }) => {
  const [status, setStatus] = useState<Status>('idle');
  const [err, setErr] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const idRef = useRef<string>(Math.random().toString(36).slice(2));

  // 挂载时注册 stop，卸载时释放
  useEffect(() => {
    const stop = () => {
      try { audioRef.current?.pause(); } catch { /* ignore */ }
      audioRef.current = null;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
      setStatus('idle');
      setErr('');
    };
    liveControllers.set(idRef.current, stop);
    return () => {
      stop();
      liveControllers.delete(idRef.current);
    };
  }, []);

  const start = async () => {
    const clean = (text || '').trim();
    if (!clean) {
      setStatus('error');
      setErr('没有可朗读的文本');
      return;
    }
    stopAllExcept(idRef.current);
    setStatus('loading');
    setErr('');
    try {
      // 文本超长分段丢给后端会被截到 2000 字，这里简单截断同样处理
      const payload = clean.length > 2000 ? clean.slice(0, 2000) : clean;
      const resp = await axios.post('/api/podcast/tts', {
        text: payload,
        speaker,
        speed: 1.0,
      }, { responseType: 'blob' });
      const blob = resp.data as Blob;
      // 后端对错误也可能返 200 + 小 blob（罕见），简单防守：< 200 字节当错误
      if (blob.size < 200) {
        try {
          const j = JSON.parse(await blob.text());
          throw new Error(j.error || '音频过小');
        } catch (e: unknown) {
          throw new Error((e as Error).message || '合成异常');
        }
      }
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      const a = new Audio(url);
      audioRef.current = a;
      a.onended = () => {
        setStatus('idle');
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current);
          blobUrlRef.current = null;
        }
      };
      a.onerror = () => {
        setStatus('error');
        setErr('音频播放失败');
      };
      await a.play();
      setStatus('playing');
    } catch (e: unknown) {
      const anyE = e as { response?: { data?: unknown }; message?: string };
      let msg = anyE?.message || '朗读失败';
      const d = anyE?.response?.data;
      if (d instanceof Blob) {
        try {
          const t = await d.text();
          const j = JSON.parse(t);
          msg = j.error || t;
        } catch { /* use default */ }
      } else if (d && typeof d === 'object' && 'error' in d) {
        msg = (d as { error: string }).error;
      }
      setStatus('error');
      setErr(msg);
    }
  };

  const toggle = () => {
    if (disabled) return;
    if (status === 'loading') return;
    if (status === 'idle' || status === 'error') { void start(); return; }
    if (status === 'playing') {
      audioRef.current?.pause();
      setStatus('paused');
      return;
    }
    if (status === 'paused') {
      audioRef.current?.play().catch(() => {
        setStatus('error');
        setErr('恢复失败');
      });
      setStatus('playing');
      return;
    }
  };

  let Icon = Volume2;
  let color = 'text-gray-400 hover:text-[#07c160]';
  let label = '朗读';
  if (status === 'loading') { Icon = Loader2; color = 'text-[#07c160]'; label = '合成中…'; }
  else if (status === 'playing') { Icon = Pause; color = 'text-[#07c160]'; label = '暂停'; }
  else if (status === 'paused') { Icon = Play; color = 'text-[#07c160]'; label = '继续'; }
  else if (status === 'error') { Icon = AlertCircle; color = 'text-red-500'; label = '重试'; }

  const tip = status === 'error' ? `朗读失败：${err}（点击重试）` : (title || label);
  const iconClass = status === 'loading' ? 'animate-spin' : '';

  // 带文字标签时，风格对齐旁边的"复制 / 分享 / 删除"按钮组
  if (showLabel) {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors ${color} hover:bg-[#f0faf4] dark:hover:bg-[#07c160]/10 ${disabled ? 'opacity-30 cursor-not-allowed' : ''} ${className}`}
        title={tip}
        aria-label={tip}
      >
        <Icon size={Math.max(11, size - 2)} className={iconClass} />
        {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      className={`inline-flex items-center justify-center p-1 rounded-md transition-colors ${color} ${disabled ? 'opacity-30 cursor-not-allowed' : ''} ${className}`}
      title={tip}
      aria-label={tip}
    >
      <Icon size={size} className={iconClass} />
    </button>
  );
};

export default TTSButton;
