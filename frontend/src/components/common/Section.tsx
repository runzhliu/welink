/**
 * 可折叠 Section —— 统计/画像页常用的"标题 + 内容"块，可选折叠
 */

import React, { useId, useState } from 'react';
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
  const contentId = useId();
  const toggle = () => collapsible && setOpen(v => !v);
  const heading = <>
    {collapsible && <span className="text-gray-400 shrink-0">{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</span>}
    {icon && <span className="text-[#07c160] shrink-0">{icon}</span>}
    <span className="min-w-0 text-left">
      <span className="block text-sm font-semibold dk-text truncate">{title}</span>
      {subtitle && open && <span className="block ui-caption mt-0.5">{subtitle}</span>}
    </span>
  </>;

  return (
    <div className={`dk-subtle bg-[#f8f9fb] rounded-2xl p-4 ${className}`}>
      <div className={`flex items-center justify-between gap-2 ${open ? 'mb-3' : ''}`}>
        {collapsible ? <button type="button" onClick={toggle} aria-expanded={open} aria-controls={contentId} className="flex items-center gap-2 flex-1 min-w-0 min-h-8 rounded-lg">{heading}</button>
          : <div className="flex items-center gap-2 flex-1 min-w-0 min-h-8">{heading}</div>}
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>
      <div id={contentId} hidden={!open}>{open && children}</div>
    </div>
  );
};
