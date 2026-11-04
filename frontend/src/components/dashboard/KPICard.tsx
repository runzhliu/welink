/**
 * KPI 卡片组件
 */

import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface KPICardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  color?: 'green' | 'blue' | 'orange' | 'red' | 'purple';
  trend?: {
    value: number;
    isPositive: boolean;
  };
}

const colorClasses = {
  green: {
    bg: 'bg-[#087f5b]',
    text: 'text-[#07c160]',
    light: 'bg-[#e7f8f0]',
    shadow: 'shadow-green-100/50',
  },
  blue: {
    bg: 'bg-gradient-to-br from-[#10aeff] to-[#0e8dd6]',
    text: 'text-[#10aeff]',
    light: 'bg-blue-50',
    shadow: 'shadow-blue-100/50',
  },
  orange: {
    bg: 'bg-gradient-to-br from-[#ff9500] to-[#e68800]',
    text: 'text-[#ff9500]',
    light: 'bg-orange-50',
    shadow: 'shadow-orange-100/50',
  },
  red: {
    bg: 'bg-gradient-to-br from-[#fa5151] to-[#e04040]',
    text: 'text-[#fa5151]',
    light: 'bg-red-50',
    shadow: 'shadow-red-100/50',
  },
  purple: {
    bg: 'bg-gradient-to-br from-[#576b95] to-[#4a5a7f]',
    text: 'text-[#576b95]',
    light: 'bg-purple-50',
    shadow: 'shadow-purple-100/50',
  },
};

export const KPICard: React.FC<KPICardProps> = ({
  title,
  value,
  subtitle,
  icon: Icon,
  color = 'green',
  trend,
}) => {
  const colors = colorClasses[color];

  return (
    <div className="ui-card ui-kpi transition-colors">
      <div className="flex items-start justify-between mb-5">
        <div className={`ui-kpi-icon ${colors.text}`}>
          <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
        </div>

        {trend && (
          <div className={`
            px-2 py-1 rounded-full text-xs font-bold
            ${trend.isPositive ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}
          `}>
            {trend.isPositive ? '↑' : '↓'} {Math.abs(trend.value)}%
          </div>
        )}
      </div>

      <div>
        <p className="ui-caption mb-2">
          {title}
        </p>
        <h3 className="ui-kpi-value mb-1">
          {value}
        </h3>
        {subtitle && (
          <p className="ui-caption mt-2">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
};
