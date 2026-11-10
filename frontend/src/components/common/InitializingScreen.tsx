/**
 * 初始化加载屏幕 — 接入真实进度（/api/status.progress）+ 取消按钮
 */

import React, { useState } from 'react';
import { globalApi } from '../../services/api';
import type { IndexProgress } from '../../types';

interface InitializingScreenProps {
  message?: string;
  progress?: IndexProgress;       // 来自 useBackendStatus.progress
  cancellable?: boolean;          // 是否显示「取消」按钮
  onCancelled?: () => void;       // 取消成功后回调
  error?: string;
  onRetry?: () => void | Promise<void>;
}

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} 秒`;
  return `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
}

export const InitializingScreen: React.FC<InitializingScreenProps> = ({
  message = '正在初始化数据...',
  progress,
  cancellable = false,
  onCancelled,
  error,
  onRetry,
}) => {
  const [cancelling, setCancelling] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const handleRetry = async () => {
    if (!onRetry || retrying) return;
    setRetrying(true);
    try { await onRetry(); } finally { setRetrying(false); }
  };

  const handleCancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    try {
      await globalApi.cancelIndex();
      // 清掉 localStorage 防止 App.tsx 又自动重触发索引
      localStorage.removeItem('welink_hasStarted');
      onCancelled?.();
      // 直接刷新让 App 回到 WelcomePage
      setTimeout(() => window.location.reload(), 300);
    } catch {
      setCancelling(false);
    }
  };

  // 真实进度（有 progress 字段时）
  const hasProgress = progress && progress.total > 0;
  const pct = hasProgress ? Math.min(100, Math.round((progress!.done / progress!.total) * 100)) : 0;
  // 估算剩余时间：当前速率推算
  const eta: string | null = hasProgress && progress!.done > 5
    ? (() => {
        const rate = progress!.done / Math.max(1, progress!.elapsed_ms);
        const remainMs = (progress!.total - progress!.done) / rate;
        if (!isFinite(remainMs) || remainMs < 0) return null;
        return fmtElapsed(remainMs);
      })()
    : null;

  return (
    <div className="fixed inset-0 dk-page flex items-center justify-center z-50 px-5" role="status" aria-live="polite" aria-busy={!error}>
      <div className="w-full max-w-md">

        {/* Logo 区 */}
        <div className="flex items-center gap-3 mb-8">
          <img loading="lazy" src="/favicon.svg" alt="WeLink" className="w-12 h-12 rounded-xl" />
          <div>
            <h1 className="text-xl font-semibold dk-text tracking-tight leading-none mb-1">
              WeLink
            </h1>
            <p className="text-xs text-[var(--text-secondary)] leading-none">
              让每段关系被看见
            </p>
          </div>
        </div>

        <section className="dk-card border rounded-xl p-6 shadow-sm">
        <p className="text-xs font-medium text-[var(--accent-text)] mb-2">{error ? '需要处理' : '正在准备'}</p>
        <p className="text-base font-semibold dk-text mb-2">{error ? '索引暂未完成' : message}</p>
        <p className="text-xs text-[var(--text-secondary)] mb-5">{error ? '可以重试，或重新选择分析范围。' : '正在准备聊天记录，完成后会自动进入。'}</p>

        {/* 进度条 */}
        <div
          className="w-full h-1.5 bg-[var(--bg-subtle)] rounded-full overflow-hidden mb-3 relative"
          role="progressbar"
          aria-label={message}
          aria-valuemin={hasProgress ? 0 : undefined}
          aria-valuemax={hasProgress ? 100 : undefined}
          aria-valuenow={hasProgress ? pct : undefined}
        >
          {hasProgress ? (
            <div
              className="h-full bg-[var(--accent)] rounded-full transition-all duration-500 ease-out"
              style={{ width: `${pct}%` }}
            />
          ) : (
            // 没有进度数据：indeterminate 滚动条
            <div className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent animate-[slide_1.5s_ease-in-out_infinite]" />
          )}
        </div>

        {/* 进度详情 */}
        {hasProgress ? (
          <div className="w-full text-xs text-gray-500 space-y-1">
            <div className="flex justify-between">
              <span>{progress!.done} / {progress!.total} 个联系人</span>
            <span className="font-semibold text-[var(--accent-text)]">{pct}%</span>
            </div>
            <div className="flex justify-between">
              <span className="truncate max-w-[14rem]" title={progress!.current_contact}>
                当前：{progress!.current_contact || '准备中…'}
              </span>
              <span>{fmtElapsed(progress!.elapsed_ms)}</span>
            </div>
            {eta && <div className="text-gray-400">预计剩余 {eta}</div>}
          </div>
        ) : (
          <p className="w-full text-xs text-[var(--text-secondary)]">
            {error ? '索引没有继续运行。' : '正在准备索引…'}
          </p>
        )}

        {error && <p role="alert" className="mt-4 break-words text-xs text-red-600 dark:text-red-400">{error === 'indexing cancelled' ? '索引已取消。' : error}</p>}

        {/* 取消按钮 */}
        {(cancellable || (error && onRetry)) && <div className="mt-5 flex items-center gap-3">
          {error && onRetry && <button type="button" onClick={() => void handleRetry()} disabled={retrying || cancelling} className="ui-button ui-button-primary">{retrying ? '正在重试…' : '重试索引'}</button>}
        {cancellable && (
          <button
            type="button"
            onClick={handleCancel}
            disabled={cancelling}
            className="ui-button ui-button-secondary disabled:opacity-50"
          >
            {cancelling ? '正在取消…' : error ? '重新选择时间' : '取消索引'}
          </button>
        )}</div>}

        {/* 底部提示 */}
        <p className="mt-5 text-xs text-[var(--text-muted)]">
          耗时取决于聊天记录大小和设备性能。刷新页面不会主动取消索引。
        </p>
        </section>
      </div>
    </div>
  );
};
