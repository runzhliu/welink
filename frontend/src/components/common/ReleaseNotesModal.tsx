/**
 * 新版本发布通知 Modal。
 *
 * 行为：App 启动后后台调 /api/app/check-update；如果有新版本且用户没"我先用着"
 * 过这个版本，弹出 Modal 展示 changelog。用户关掉后 localStorage 记住当前版本，
 * 下次启动不再弹同一个版本。
 */

import React from 'react';
import { X, Sparkles, ExternalLink } from 'lucide-react';
import { useEscape } from '../../hooks/useEscape';

interface Props {
  open: boolean;
  onClose: () => void;
  currentVersion: string;
  latestVersion: string;
  changelog: string;
  url: string;
}

export const ReleaseNotesModal: React.FC<Props> = ({ open, onClose, currentVersion, latestVersion, changelog, url }) => {
  useEscape(open, onClose);
  if (!open) return null;

  const dismissAndClose = () => {
    localStorage.setItem('welink_dismissed_version', latestVersion);
    onClose();
  };

  const openOnGitHub = async () => {
    try {
      // App 模式走后端 open-url；浏览器模式 window.open
      const isApp = navigator.userAgent.includes('AppleWebKit') &&
        !navigator.userAgent.includes('Safari') && !navigator.userAgent.includes('Chrome');
      if (isApp) {
        await fetch('/api/open-url?url=' + encodeURIComponent(url));
      } else {
        window.open(url, '_blank');
      }
    } catch {
      window.open(url, '_blank');
    }
    dismissAndClose();
  };

  return (
    <div
      className="fixed inset-0 z-[260] bg-black/40 flex items-center justify-center p-4"
      onClick={dismissAndClose}
    >
      <div
        className="w-full max-w-lg max-h-[85vh] bg-white dark:bg-[#1d1d1f] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-6 py-4 border-b border-gray-100 dark:border-white/10">
          <div className="w-10 h-10 rounded-xl bg-[#07c160]/10 flex items-center justify-center flex-shrink-0">
            <Sparkles size={20} className="text-[#07c160]" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-[#1d1d1f] dk-text">WeLink {latestVersion} 已发布</h3>
            <p className="text-xs text-gray-400 mt-0.5">你当前的版本：{currentVersion || '未知'}</p>
          </div>
          <button onClick={dismissAndClose} className="text-gray-400 hover:text-gray-600">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">本次更新</div>
          <pre className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">
            {changelog?.trim() || '（没有提供 changelog）'}
          </pre>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 dark:border-white/10 bg-[#f8f9fb] dark:bg-white/5 flex flex-wrap gap-2 justify-end">
          <button
            onClick={dismissAndClose}
            className="px-4 py-2 rounded-xl bg-white dark:bg-white/10 border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-white/15 transition-colors"
          >
            我先用着
          </button>
          <button
            onClick={openOnGitHub}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#07c160] text-white text-sm font-semibold hover:bg-[#06ad56] transition-colors"
          >
            <ExternalLink size={14} />
            查看 GitHub 发布
          </button>
        </div>
      </div>
    </div>
  );
};
