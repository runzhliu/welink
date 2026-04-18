/**
 * 自绘确认弹窗 — 替代 window.confirm()，在 macOS/Windows WebView 里也能正常弹出。
 * 样式跟 WeLink 的 Modal 一致（圆角 + 毛玻璃遮罩 + 绿色主按钮）。
 */

import React, { useEffect, useRef } from 'react';

interface Props {
  open: boolean;
  title: string;
  message: string;
  hint?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<Props> = ({
  open,
  title,
  message,
  hint,
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
  onConfirm,
  onCancel,
}) => {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) confirmRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-white dark:bg-[#2d2d2f] rounded-2xl shadow-2xl w-[340px] max-w-[90vw] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="px-6 pt-6 pb-4">
          <h3 className="text-base font-black text-[#1d1d1f] dark:text-white mb-2">{title}</h3>
          <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed whitespace-pre-line">{message}</p>
          {hint && (
            <p className="text-xs text-gray-400 mt-2 leading-relaxed">{hint}</p>
          )}
        </div>
        <div className="flex border-t border-gray-100 dark:border-white/10">
          <button
            onClick={onCancel}
            className="flex-1 py-3 text-sm font-semibold text-gray-500 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors border-r border-gray-100 dark:border-white/10"
          >
            {cancelText}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className={`flex-1 py-3 text-sm font-bold transition-colors ${
              danger
                ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10'
                : 'text-[#07c160] hover:bg-[#e7f8f0] dark:hover:bg-[#07c160]/10'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
