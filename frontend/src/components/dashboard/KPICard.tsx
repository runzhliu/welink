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
    bg: 'bg-gradient-to-br from-[#07c160] to-[#06ad56]',
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
    <div className="dk-card bg-white dk-border p-5 sm:p-8 rounded-2xl sm:rounded-3xl border border-gray-100 hover:shadow-lg transition-all duration-300 group">
      <div className="flex items-start justify-between mb-4 sm:mb-6">
        <div className={`w-10 h-10 sm:w-14 sm:h-14 ${colors.bg} rounded-xl sm:rounded-2xl flex items-center justify-center shadow-lg ${colors.shadow} group-hover:scale-110 transition-transform duration-300`}>
          <Icon size={20} className="text-white sm:hidden" strokeWidth={2.5} />
          <Icon size={28} className="text-white hidden sm:block" strokeWidth={2.5} />
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
        <p className="dk-text-muted text-gray-500 text-xs sm:text-sm font-semibold mb-1 sm:mb-2 tracking-wide uppercase">
          {title}
        </p>
        <h3 className="dk-text text-2xl sm:text-4xl font-black tracking-tight text-[#1d1d1f] mb-1">
          {value}
        </h3>
        {subtitle && (
          <p className="text-gray-400 text-xs font-medium hidden sm:block">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
};
