import React, { useState, useEffect, useCallback } from 'react';
import { Sparkles, EyeOff } from 'lucide-react';
import { TagList } from '../shared';
import type { ContactStats } from '../../../types';

export const ForecastIgnoreSection: React.FC<{
  allContacts?: ContactStats[];
  privacyMode?: boolean;
}> = ({ allContacts = [], privacyMode = false }) => {
  const [forecastIgnored, setForecastIgnored] = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/preferences').then(r => r.json()).then(d => {
      if (Array.isArray(d?.forecast_ignored)) setForecastIgnored(d.forecast_ignored);
    }).catch(() => {});
  }, []);

  const saveForecastIgnored = useCallback(async (next: string[]) => {
    try {
      await fetch('/api/preferences/forecast-ignored', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forecast_ignored: next }),
      });
      setForecastIgnored(next);
    } catch { /* ignore */ }
  }, []);

  const handleRemoveForecastIgnored = useCallback((username: string) => {
    saveForecastIgnored(forecastIgnored.filter(u => u !== username));
  }, [forecastIgnored, saveForecastIgnored]);

  const handleClearForecastIgnored = useCallback(() => {
    saveForecastIgnored([]);
  }, [saveForecastIgnored]);

  const userLabelFor = (id: string): string => {
    const c = allContacts.find((c) => c.username === id || c.nickname === id || c.remark === id);
    return c ? (c.remark || c.nickname || id) : id;
  };

  return (
    <section className="mb-8" data-section-id="forecast" data-settings-tags="关系预测 forecast 忽略 不再推荐 冷却">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={18} className="text-[#07c160]" />
        <h3 className="text-base font-bold text-[#1d1d1f] dk-text">关系预测 · 忽略名单</h3>
      </div>
      <p className="text-sm text-gray-400 mb-4">
        在首页「建议主动联系」卡片点「不再推荐此人」加入这里。被忽略的联系人仍在其他页面可见，只是首页 forecast 不再提醒。
      </p>
      <div className="bg-white rounded-2xl border border-gray-100 p-6 dk-card dk-border">
        <div className="flex items-center gap-2 mb-4">
          <EyeOff size={16} className="text-gray-400" />
          <h4 className="font-bold text-[#1d1d1f] dk-text">忽略的联系人</h4>
          {forecastIgnored.length > 0 && (
            <>
              <span className="ml-auto text-xs font-bold px-2.5 py-1 rounded-full bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400">
                {forecastIgnored.length} 位
              </span>
              <button
                onClick={() => {
                  if (confirm(`确定清空全部 ${forecastIgnored.length} 个忽略联系人？`)) {
                    handleClearForecastIgnored();
                  }
                }}
                className="text-xs text-gray-400 hover:text-red-500 transition-colors"
              >
                清空
              </button>
            </>
          )}
        </div>
        <TagList
          items={forecastIgnored}
          onRemove={handleRemoveForecastIgnored}
          emptyText="暂无忽略联系人"
          labelFor={userLabelFor}
          privacyMode={privacyMode}
        />
      </div>
    </section>
  );
};
