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
}) => {
  const [cancelling, setCancelling] = useState(false);

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
    <div className="fixed inset-0 bg-white flex items-center justify-center z-50">
      <div className="flex flex-col items-center gap-0 w-80">

        {/* Logo 区 */}
        <div className="flex items-center gap-4 mb-10">
          <img loading="lazy" src="/favicon.svg" alt="WeLink" className="w-16 h-16 rounded-2xl shadow-lg shadow-green-100" />
          <div>
            <h1 className="text-3xl font-black text-[#1d1d1f] tracking-tight leading-none mb-1">
              WeLink
            </h1>
            <p className="text-sm font-semibold text-gray-400 leading-none">
              AI 驱动 · 微信聊天分析
            </p>
          </div>
        </div>

        {/* 主状态文字 */}
        <p className="text-sm font-semibold text-[#07c160] mb-3 self-start">
          {message}
        </p>

        {/* 进度条 */}
        <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden mb-3 relative">
          {hasProgress ? (
            <div
              className="h-full bg-gradient-to-r from-[#09d46a] to-[#07c160] rounded-full transition-all duration-500 ease-out"
              style={{ width: `${pct}%` }}
            />
          ) : (
            // 没有进度数据：indeterminate 滚动条
            <div className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-[#07c160] to-transparent animate-[slide_1.5s_ease-in-out_infinite]" />
          )}
        </div>

        {/* 进度详情 */}
        {hasProgress ? (
          <div className="w-full text-xs text-gray-500 space-y-1">
            <div className="flex justify-between">
              <span>{progress!.done} / {progress!.total} 个联系人</span>
              <span className="font-semibold text-[#07c160]">{pct}%</span>
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
          <p className="w-full text-xs text-gray-400 text-center">
            正在准备索引…
          </p>
        )}

        {/* 取消按钮 */}
        {cancellable && (
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="mt-8 text-xs text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
          >
            {cancelling ? '正在取消…' : '取消索引'}
          </button>
        )}

        {/* 底部提示 */}
        <p className="mt-6 text-xs text-gray-300 font-medium text-center">
          首次启动需要约 10–30 秒，请耐心等待
        </p>
      </div>
    </div>
  );
};
