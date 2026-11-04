import React, { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
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
        <SlidersHorizontal size={18} className="text-[#07c160]" />
        <h3 className="text-base font-bold text-[#1d1d1f] dk-text">AI 配置</h3>
      </div>
      <p className="text-sm text-gray-400 mb-4">
        配置用于对话分析、语义搜索和记忆提炼的模型。
      </p>

      {/* Tab 导航 */}
      <div className="ui-segmented mb-5 overflow-x-auto" role="group" aria-label="AI 配置类别">
        {tabs.map(t => (
          <button
            type="button"
            key={t.key}
            aria-pressed={tab === t.key}
            onClick={() => setTab(t.key)}
            className="flex-1 whitespace-nowrap"
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
