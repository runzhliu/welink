/**
 * 关系热度图组件
 */

import React from 'react';
import type { HealthStatus } from '../../types';

interface RelationshipHeatmapProps {
  health: HealthStatus;
  totalContacts: number;
}

export const RelationshipHeatmap: React.FC<RelationshipHeatmapProps> = ({
  health,
  totalContacts,
}) => {
  const getPercentage = (value: number) =>
    totalContacts > 0 ? ((value / totalContacts) * 100).toFixed(1) : '0.0';

  const categories = [
    {
      label: '活跃',
      value: health.hot,
      color: 'bg-[#07c160]',
      textColor: 'text-[#07c160]',
      description: '最近 7 天有消息',
    },
    {
      label: '温热',
      value: health.warm,
      color: 'bg-[#ff9500]',
      textColor: 'text-[#ff9500]',
      description: '超过 7 天未联系',
    },
    {
      label: '冷淡',
      value: health.cold,
      color: 'bg-gray-300',
      textColor: 'text-gray-500',
      description: '零消息记录',
    },
  ];

  return (
    <div className="dk-card bg-white dk-border p-8 rounded-3xl border border-gray-100">
      <h3 className="dk-text text-xl font-black text-[#1d1d1f] mb-6">
        关系热度分布
      </h3>

      <div className="space-y-5">
        {categories.map((category) => (
          <div key={category.label}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${category.color}`} />
                <span className="font-bold text-sm text-gray-700">
                  {category.label}
                </span>
                <span className="text-xs text-gray-400 font-medium">
                  {category.description}
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className={`text-2xl font-black ${category.textColor}`}>
                  {category.value}
                </span>
                <span className="text-xs font-semibold text-gray-400">
                  {getPercentage(category.value)}%
                </span>
              </div>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full ${category.color} transition-all duration-500 ease-out`}
                style={{ width: `${getPercentage(category.value)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
