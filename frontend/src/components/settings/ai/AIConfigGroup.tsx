import React, { useState } from 'react';
import { Bot } from 'lucide-react';
import { LLMSection } from './LLMSection';
import { EmbeddingSection } from './EmbeddingSection';
import { MemorySection } from './MemorySection';
import { ImageSection } from './ImageSection';

type AITab = 'llm' | 'embedding' | 'memory' | 'image';

export const AIConfigGroup: React.FC = () => {
  const [tab, setTab] = useState<AITab>('llm');

  const tabs: { key: AITab; label: string }[] = [
    { key: 'llm',       label: '分析模型' },
    { key: 'embedding', label: '向量 Embedding' },
    { key: 'memory',    label: '记忆提炼' },
    { key: 'image',     label: 'AI 生图' },
  ];

  return (
    <section className="mb-8" data-section-id="ai-config" data-settings-tags="AI 模型 LLM embedding memory image 分析 配置 向量 记忆 生图 deepseek openai claude">
      <div className="flex items-center gap-2 mb-3">
        <Bot size={18} className="text-[#07c160]" />
        <h3 className="text-base font-bold text-[#1d1d1f] dk-text">AI 配置</h3>
      </div>
      <p className="text-sm text-gray-400 mb-4">
        配置用于对话分析、语义搜索和记忆提炼的模型。
      </p>

      {/* Tab 导航 */}
      <div className="flex gap-1 mb-4 bg-gray-100 dark:bg-white/5 rounded-xl p-1">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-2 text-sm font-bold rounded-lg transition-colors ${
              tab === t.key
                ? 'bg-white dark:bg-white/10 text-[#07c160] shadow-sm'
                : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 各 Tab 内容（用 hidden 保留 DOM / state） */}
      <div className={tab === 'llm' ? '' : 'hidden'}>
        <LLMSection />
      </div>
      <div className={tab === 'embedding' ? '' : 'hidden'}>
        <EmbeddingSection />
      </div>
      <div className={tab === 'memory' ? '' : 'hidden'}>
        <MemorySection />
      </div>
      <div className={tab === 'image' ? '' : 'hidden'}>
        <ImageSection />
      </div>
    </section>
  );
};
