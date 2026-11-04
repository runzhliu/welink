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
    <div className="ui-card flex flex-col items-center justify-center py-14 px-6 text-center">
      {icon && (
        <div className="w-12 h-12 rounded-2xl dk-subtle flex items-center justify-center mb-5 text-[#07c160]">
          {icon}
        </div>
      )}
      <h3 className="text-base font-bold text-[#1d1d1f] dk-text mb-1">{title}</h3>
      {description && <p className="text-sm text-gray-500 max-w-md leading-relaxed mb-5">{description}</p>}
      <div className="flex gap-2">
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="ui-button ui-button-primary"
          >
            {action.label}
          </button>
        )}
        {secondary && (
          <button
            type="button"
            onClick={secondary.onClick}
            className="ui-button ui-button-secondary"
          >
            {secondary.label}
          </button>
        )}
      </div>
    </div>
  );
};
