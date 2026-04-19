import React, { useEffect, useRef, useState } from 'react';
import { Lock, Loader2 } from 'lucide-react';
import { useLock } from '../../contexts/LockContext';

// 全屏锁定覆盖层 — 高 z-index，屏蔽下层内容，仅提供 PIN 输入框。
// 纯前端覆盖：不阻止开发者调 API，但防住肉眼偷看（跟 WeChat PC Cmd+L 同思路）。
export const LockOverlay: React.FC = () => {
  const { locked, unlock } = useLock();
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (locked) {
      setPin('');
      setErr(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [locked]);

  if (!locked) return null;

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!pin || busy) return;
    setBusy(true);
    setErr(null);
    const ok = await unlock(pin);
    setBusy(false);
    if (!ok) {
      setErr('PIN 错误');
      setPin('');
      inputRef.current?.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center backdrop-blur-2xl bg-black/40"
      role="dialog"
      aria-modal
    >
      <form
        onSubmit={submit}
        className="w-full max-w-sm mx-4 rounded-3xl bg-white dark:bg-[#1d1d1f] shadow-2xl border border-gray-100 dark:border-white/10 p-8 text-center"
      >
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#07c160] to-[#06ad56] flex items-center justify-center mx-auto mb-4 shadow-lg">
          <Lock size={28} className="text-white" />
        </div>
        <h2 className="text-lg font-bold text-[#1d1d1f] dark:text-white mb-1">WeLink 已锁定</h2>
        <p className="text-xs text-gray-400 mb-6">输入 PIN 解锁</p>

        <input
          ref={inputRef}
          type="password"
          inputMode="text"
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          disabled={busy}
          placeholder="PIN"
          className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-center text-lg tracking-[0.3em] text-[#1d1d1f] dark:text-white outline-none focus:border-[#07c160] disabled:opacity-60"
        />

        {err && <p className="mt-3 text-xs text-red-500">{err}</p>}

        <button
          type="submit"
          disabled={busy || !pin}
          className="mt-5 w-full flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl bg-[#07c160] text-white text-sm font-semibold hover:bg-[#06ad56] disabled:opacity-50 transition-colors"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : null}
          解锁
        </button>

        <p className="mt-4 text-[11px] text-gray-400">
          忘记 PIN？到{' '}
          <span className="font-medium">设置 → 配置管理 → 重置</span>{' '}
          清空所有设置。
        </p>
      </form>
    </div>
  );
};
