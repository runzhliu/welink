/**
 * 通用空状态卡片：图标 + 标题 + 一句话描述 + 引导按钮
 * 用于 Skills、纪念日、AI 对话历史等"第一次用什么都没"的场景
 */
import React from 'react';

interface Props {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  secondary?: { label: string; onClick: () => void };
}

export const EmptyState: React.FC<Props> = ({ icon, title, description, action, secondary }) => {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 rounded-2xl border border-dashed border-gray-200 dark:border-white/10 bg-gray-50/50 dark:bg-white/5 text-center">
      {icon && (
        <div className="w-14 h-14 rounded-2xl bg-[#07c160]/10 flex items-center justify-center mb-4 text-[#07c160]">
          {icon}
        </div>
      )}
      <h3 className="text-base font-bold text-[#1d1d1f] dk-text mb-1">{title}</h3>
      {description && <p className="text-sm text-gray-500 max-w-md leading-relaxed mb-5">{description}</p>}
      <div className="flex gap-2">
        {action && (
          <button
            onClick={action.onClick}
            className="px-4 py-2 rounded-xl bg-[#07c160] text-white text-sm font-semibold hover:bg-[#06ad56] transition-colors"
          >
            {action.label}
          </button>
        )}
        {secondary && (
          <button
            onClick={secondary.onClick}
            className="px-4 py-2 rounded-xl bg-white dark:bg-white/10 border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-white/15 transition-colors"
          >
            {secondary.label}
          </button>
        )}
      </div>
    </div>
  );
};
