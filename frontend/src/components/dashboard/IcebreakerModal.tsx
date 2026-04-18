/**
 * AI 开场白草稿 Modal — 给一个「降温/濒危」联系人草拟 4 条主动破冰的开场白，
 * 每条一键复制。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { X, Loader2, Copy, Check, Sparkles, RotateCw, AlertCircle } from 'lucide-react';
import type { IcebreakerResponse } from '../../types';
import { forecastApi } from '../../services/api';

interface Props {
  username: string;
  fallbackDisplayName: string;
  reason?: string;
  onClose: () => void;
}

export const IcebreakerModal: React.FC<Props> = ({ username, fallbackDisplayName, reason, onClose }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<IcebreakerResponse | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const fetchDrafts = useCallback(() => {
    setLoading(true);
    setError('');
    setData(null);
    forecastApi.icebreaker(username)
      .then(resp => setData(resp))
      .catch(e => {
        const msg = e?.response?.data?.error || e?.message || '生成失败';
        setError(String(msg));
      })
      .finally(() => setLoading(false));
  }, [username]);

  useEffect(() => { fetchDrafts(); }, [fetchDrafts]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleCopy = async (idx: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(i => (i === idx ? null : i)), 1500);
    } catch {
      // ignore
    }
  };

  const displayName = data?.display_name || fallbackDisplayName;
  const daysSince = data?.days_since_last;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-[#1d1d1f] rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/10">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles size={16} className="text-[#576b95] flex-shrink-0" />
            <span className="text-sm font-bold text-[#1d1d1f] dk-text truncate">
              写给 {displayName} 的开场白
            </span>
            {typeof daysSince === 'number' && daysSince > 0 && (
              <span className="text-xs text-gray-400 flex-shrink-0">· {daysSince} 天没聊</span>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={fetchDrafts}
              disabled={loading}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-white/10 disabled:opacity-40 transition-colors"
              title="重新生成"
            >
              <RotateCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 max-h-[60vh] overflow-y-auto">
          {reason && (
            <div className="mb-3 text-xs text-gray-400 italic">{reason}</div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-10 gap-2 text-gray-400">
              <Loader2 size={16} className="animate-spin" />
              <span className="text-xs">AI 正在起草草稿…（取最近 40 条消息做风味采样）</span>
            </div>
          )}

          {!loading && error && (
            <div className="flex items-start gap-2 py-6 px-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20">
              <AlertCircle size={14} className="text-[#fa5151] mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-[#fa5151]">生成失败</div>
                <div className="text-xs text-gray-500 dk-text mt-1 break-all">{error}</div>
                <button
                  onClick={fetchDrafts}
                  className="mt-2 text-xs font-bold text-[#576b95] hover:underline"
                >
                  重试
                </button>
              </div>
            </div>
          )}

          {!loading && !error && data && (
            <div className="space-y-2">
              {data.drafts.map((draft, i) => {
                const copied = copiedIdx === i;
                return (
                  <div
                    key={i}
                    className="group rounded-xl border border-gray-100 dark:border-white/10 p-3 hover:border-[#576b95]/40 transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#576b95]/10 text-[#576b95]">
                        {draft.tone}
                      </span>
                    </div>
                    <div className="text-sm text-[#1d1d1f] dk-text leading-relaxed whitespace-pre-wrap break-words">
                      {draft.text}
                    </div>
                    <div className="mt-2 flex justify-end">
                      <button
                        onClick={() => handleCopy(i, draft.text)}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                          copied
                            ? 'bg-[#07c160] text-white'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-white/10 dark:hover:bg-white/15 dk-text'
                        }`}
                      >
                        {copied ? <Check size={12} /> : <Copy size={12} />}
                        {copied ? '已复制' : '复制'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 dark:border-white/10 text-[11px] text-gray-400">
          由 AI 基于你们最近的聊天生成。草稿仅供参考，复制后到微信里再润色一下会更自然。
        </div>
      </div>
    </div>
  );
};
