/// <reference types="vite/client" />
import React from 'react';
import { MessageSquare } from 'lucide-react';

// Local assets avoid third-party requests while viewing private conversations.
const icons = import.meta.glob<string>('../../assets/model-providers/*.svg', { eager: true, query: '?url', import: 'default' });
const brands: { icon: string; color: string; model: RegExp; provider: RegExp }[] = [
  { icon: 'deepseek', color: '#4d6bfe', model: /deepseek/i, provider: /^deepseek$/i },
  { icon: 'claude', color: '#d97757', model: /claude/i, provider: /^(claude|anthropic)$/i },
  { icon: 'googlegemini', color: '#4285f4', model: /gemini/i, provider: /^(gemini|vertex)$/i },
  { icon: 'qwen', color: '#6554e8', model: /qwen|通义/i, provider: /^(qwen|dashscope)$/i },
  { icon: 'openai', color: '#202123', model: /(^|[/.])(gpt|o[134](?:-|\b)|chatgpt)/i, provider: /^(openai|azure)$/i },
  { icon: 'minimax', color: '#ed4141', model: /minimax/i, provider: /^minimax(?:-cn)?$/i },
  { icon: 'kimi', color: '#222', model: /kimi|moonshot/i, provider: /^(kimi|moonshot)$/i },
  { icon: 'zhipu', color: '#4459b8', model: /(^|[/.])glm|chatglm/i, provider: /^(glm|zhipu)$/i },
  { icon: 'doubao', color: '#5a78ff', model: /doubao/i, provider: /^doubao$/i },
  { icon: 'hunyuan', color: '#1769e0', model: /hunyuan/i, provider: /^hunyuan$/i },
  { icon: 'x', color: '#111', model: /grok/i, provider: /^(grok|xai)$/i },
  { icon: 'mistralai', color: '#f08c28', model: /mistral|mixtral/i, provider: /^mistral$/i },
  { icon: 'perplexity', color: '#21808d', model: /(^|[/.])sonar/i, provider: /^perplexity$/i },
  { icon: 'cohere', color: '#39594d', model: /(^|[/.])command-/i, provider: /^cohere$/i },
  { icon: 'stepfun', color: '#615ced', model: /(^|[/.])step-/i, provider: /^stepfun$/i },
  { icon: 'yi', color: '#615ced', model: /(^|[/.])yi-/i, provider: /^yi$/i },
  { icon: 'baidu', color: '#2932e1', model: /ernie/i, provider: /^qianfan$/i },
  { icon: 'ollama', color: '#292929', model: /$^/, provider: /^ollama$/i },
  { icon: 'openrouter', color: '#333', model: /$^/, provider: /^openrouter$/i },
  { icon: 'groq', color: '#f55036', model: /$^/, provider: /^groq$/i },
  { icon: 'fireworks', color: '#ef542f', model: /$^/, provider: /^fireworks$/i },
  { icon: 'siliconcloud', color: '#5145e5', model: /$^/, provider: /^siliconflow$/i },
];

export const ModelAvatar: React.FC<{ provider?: string; model?: string }> = ({ provider = '', model = '' }) => {
  const brand = brands.find(b => model && b.model.test(model)) ?? brands.find(b => b.provider.test(provider));
  const icon = brand && icons[`../../assets/model-providers/${brand.icon}.svg`];
  if (!brand || !icon) return <div aria-label="AI 助手" className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center bg-[#576b95] text-white mt-0.5"><MessageSquare size={13} /></div>;
  return <div title={`${provider || brand.icon}${model ? ` · ${model}` : ''}`} aria-label={`${brand.icon} 模型`} className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center bg-white border border-black/5 mt-0.5">
    <span className="w-[18px] h-[18px]" style={{ backgroundColor: brand.color, mask: `url(${icon}) center / contain no-repeat`, WebkitMask: `url(${icon}) center / contain no-repeat` }} />
  </div>;
};
