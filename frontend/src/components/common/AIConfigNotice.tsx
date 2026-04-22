/**
 * AI 未配置时的前置提示条。
 * 放在任何 AI 输入框 / 分析按钮前面，用户第一眼就知道需要去设置配 provider。
 *
 * 用法：
 *   <AIConfigNotice visible={profiles.length === 0} onOpenSettings={...} />
 */

import React from 'react';
import { AlertCircle, Settings } from 'lucide-react';

interface Props {
  visible: boolean;
  onOpenSettings?: () => void;
  message?: string;              // 自定义主文案（默认「还未配置 AI 接口」）
  hint?: string;                 // 自定义次文案
  className?: string;
}

export const AIConfigNotice: React.FC<Props> = ({
  visible,
  onOpenSettings,
  message = '还未配置 AI 接口',
  hint = '先去设置里配好 AI 服务商和 API Key，才能使用分析 / 对话 / 播客等 AI 功能',
  className = '',
}) => {
  if (!visible) return null;
  return (
    <div
      className={`rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50/80 dark:bg-amber-500/10 px-4 py-3 flex items-start gap-3 ${className}`}
      role="alert"
    >
      <AlertCircle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold text-amber-900 dark:text-amber-200">{message}</div>
        <div className="text-xs text-amber-700/80 dark:text-amber-300/80 mt-0.5 leading-relaxed">{hint}</div>
      </div>
      {onOpenSettings && (
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#07c160] text-white text-xs font-bold hover:bg-[#06ad56] transition-colors shadow-sm"
        >
          <Settings size={12} />
          去设置
        </button>
      )}
    </div>
  );
};
