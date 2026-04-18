/**
 * 可折叠 Section —— 统计/画像页常用的"标题 + 内容"块，可选折叠
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface Props {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  collapsible?: boolean;      // false = 不显示折叠按钮
  action?: React.ReactNode;   // 标题行右侧的额外控件
  className?: string;
  children: React.ReactNode;
}

export const Section: React.FC<Props> = ({
  title, subtitle, icon, defaultOpen = true, collapsible = true, action, className = '', children,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const toggle = () => collapsible && setOpen(v => !v);

  return (
    <div className={`dk-subtle bg-[#f8f9fb] rounded-2xl p-4 ${className}`}>
      <div className={`flex items-center justify-between gap-2 ${open ? 'mb-3' : ''}`}>
        <div
          role={collapsible ? 'button' : undefined}
          onClick={toggle}
          className={`flex items-center gap-2 flex-1 min-w-0 ${collapsible ? 'cursor-pointer select-none' : ''}`}
        >
          {collapsible && (
            <span className="text-gray-400 flex-shrink-0">
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
          )}
          {icon && <span className="text-[#07c160] flex-shrink-0">{icon}</span>}
          <div className="min-w-0">
            <h4 className="text-sm font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider truncate">{title}</h4>
            {subtitle && open && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>
      {open && children}
    </div>
  );
};
