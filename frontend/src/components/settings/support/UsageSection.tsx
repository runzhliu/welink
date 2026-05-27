import React, { useState, useCallback, useEffect } from 'react';
import { Bot } from 'lucide-react';
import axios from 'axios';

type UsageStats = {
  total_conversations: number;
  total_assistant_msgs: number;
  total_chars: number;
  total_tokens: number;
  total_elapsed_sec: number;
  by_provider: { provider: string; model?: string; count: number; chars: number; tokens: number; elapsed_sec: number }[];
};

export const UsageSection: React.FC = () => {
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  const loadUsage = useCallback(async () => {
    setUsageLoading(true);
    try {
      const { data } = await axios.get<UsageStats>('/api/ai/usage-stats');
      setUsage(data);
    } catch { /* ignore */ }
    finally { setUsageLoading(false); }
  }, []);
  useEffect(() => { loadUsage(); }, [loadUsage]);

  const fmtNum = (n: number) => n.toLocaleString('zh-CN');

  return (
    <section className="mb-8" data-section-id="usage" data-settings-tags="LLM 用量 token 字符 统计 usage">
      <div className="flex items-center gap-2 mb-3">
        <Bot size={18} className="text-[#07c160]" />
        <h3 className="text-base font-bold text-[#1d1d1f] dk-text">LLM 用量</h3>
        <button
          onClick={loadUsage}
          disabled={usageLoading}
          className="ml-auto text-xs text-gray-400 hover:text-[#07c160] disabled:opacity-50"
        >
          {usageLoading ? '加载中…' : '刷新'}
        </button>
      </div>
      <p className="text-sm text-gray-400 mb-4">累计所有 AI 对话（首页、联系人分析、时光机等）的字符和 token 估算</p>
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 dk-card dk-border">
        {!usage ? (
          <p className="text-sm text-gray-400 text-center py-4">{usageLoading ? '加载中…' : '暂无数据'}</p>
        ) : usage.total_assistant_msgs === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">还没有 AI 对话记录</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div>
                <div className="text-xs text-gray-400 mb-1">对话线程</div>
                <div className="text-lg font-bold text-[#1d1d1f] dk-text">{fmtNum(usage.total_conversations)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-1">AI 回复条数</div>
                <div className="text-lg font-bold text-[#1d1d1f] dk-text">{fmtNum(usage.total_assistant_msgs)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-1">总字符数</div>
                <div className="text-lg font-bold text-[#1d1d1f] dk-text">{fmtNum(usage.total_chars)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-1">估算 tokens</div>
                <div className="text-lg font-bold text-[#1d1d1f] dk-text">{fmtNum(usage.total_tokens)}</div>
              </div>
            </div>
            {usage.by_provider.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">按 Provider 分布</div>
                <div className="space-y-1.5">
                  {usage.by_provider.sort((a, b) => b.tokens - a.tokens).map((p, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className="font-semibold text-[#1d1d1f] dk-text w-24 truncate">{p.provider}</span>
                      <span className="text-gray-400 flex-1 truncate">{p.model || '—'}</span>
                      <span className="text-gray-500 tabular-nums">{fmtNum(p.count)} 条</span>
                      <span className="text-gray-500 tabular-nums w-20 text-right">{fmtNum(p.chars)} 字</span>
                      <span className="text-[#07c160] tabular-nums w-24 text-right">~{fmtNum(p.tokens)} tok</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <p className="mt-4 text-[10px] text-gray-400 leading-relaxed">
              Token 估算 = 平均吐字速率 × 生成耗时，仅为近似值；实际扣费请以 provider 后台为准。
              此数据仅来自本地 <code className="font-mono">ai_analysis.db</code>，不含后续"清除历史"之前已删的对话。
            </p>
          </>
        )}
      </div>
    </section>
  );
};
