// LLM 主配置共享类型 + Provider 元数据

// usageUrl: 各 provider 的"用量 / 账单"页。用户经常想看 token 消耗，
// 直接跳过去比自己进控制台找一遍方便。
// 部分 provider 没有专属用量页 → 留空，UI 自动不渲染按钮。
export const PROVIDERS = [
  { value: 'deepseek', label: 'DeepSeek', defaultURL: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-v4-pro', keyUrl: 'https://platform.deepseek.com/api_keys', usageUrl: 'https://platform.deepseek.com/usage' },
  { value: 'doubao',   label: '豆包（火山方舟）', defaultURL: 'https://ark.cn-beijing.volces.com/api/v3', defaultModel: 'doubao-seed-2-0-pro-260215', keyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey', usageUrl: 'https://console.volcengine.com/finance/bill' },
  { value: 'kimi',     label: 'Kimi (Moonshot)', defaultURL: 'https://api.moonshot.cn/v1', defaultModel: 'kimi-k2.5', keyUrl: 'https://platform.moonshot.cn/console/api-keys', usageUrl: 'https://platform.moonshot.cn/console/info' },
  { value: 'gemini',   label: 'Gemini', defaultURL: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-2.0-flash', keyUrl: 'https://aistudio.google.com/apikey', usageUrl: 'https://aistudio.google.com/usage' },
  { value: 'glm',      label: 'GLM（智谱 AI）', defaultURL: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4-flash', keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys', usageUrl: 'https://open.bigmodel.cn/finance/manage' },
  { value: 'grok',     label: 'Grok (xAI)', defaultURL: 'https://api.x.ai/v1', defaultModel: 'grok-3-mini', keyUrl: 'https://console.x.ai/', usageUrl: 'https://console.x.ai/team/default/usage' },
  { value: 'minimax',     label: 'MiniMax（国际版）', defaultURL: 'https://api.minimax.io/v1', defaultModel: 'MiniMax-Text-01', keyUrl: 'https://www.minimax.io/user-center/basic-information/interface-key', usageUrl: 'https://www.minimax.io/user-center/finance-management/finance-overview' },
  { value: 'minimax-cn', label: 'MiniMax（国内版）', defaultURL: 'https://api.minimaxi.com/v1', defaultModel: 'MiniMax-Text-01', keyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key', usageUrl: 'https://platform.minimaxi.com/user-center/finance-management/finance-overview' },
  { value: 'openai',   label: 'OpenAI', defaultURL: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', keyUrl: 'https://platform.openai.com/api-keys', usageUrl: 'https://platform.openai.com/usage' },
  { value: 'claude',   label: 'Claude (Anthropic)', defaultURL: 'https://api.anthropic.com', defaultModel: 'claude-haiku-4-5-20251001', keyUrl: 'https://console.anthropic.com/settings/keys', usageUrl: 'https://console.anthropic.com/settings/usage' },
  { value: 'vertex',   label: 'Google Vertex AI', defaultURL: '', defaultModel: 'google/gemini-2.0-flash-001', keyUrl: 'https://console.cloud.google.com/iam-admin/serviceaccounts', usageUrl: 'https://console.cloud.google.com/billing' },
  { value: 'bedrock',  label: 'AWS Bedrock', defaultURL: 'https://bedrock-runtime.us-east-1.amazonaws.com', defaultModel: 'us.anthropic.claude-sonnet-4-6', keyUrl: 'https://console.aws.amazon.com/bedrock/home', usageUrl: 'https://console.aws.amazon.com/cost-management/home' },
  { value: 'qwen',        label: '通义千问（DashScope）', defaultURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-plus', keyUrl: 'https://bailian.console.aliyun.com/?tab=model#/api-key', usageUrl: 'https://billing.console.aliyun.com/expense/usage' },
  { value: 'hunyuan',     label: '腾讯混元', defaultURL: 'https://api.hunyuan.cloud.tencent.com/v1', defaultModel: 'hunyuan-turbo', keyUrl: 'https://console.cloud.tencent.com/hunyuan/api-key', usageUrl: 'https://console.cloud.tencent.com/expense/bill/overview' },
  { value: 'qianfan',     label: '百度千帆（文心一言）', defaultURL: 'https://qianfan.baidubce.com/v2', defaultModel: 'ernie-4.0-turbo-8k', keyUrl: 'https://console.bce.baidu.com/iam/#/iam/apikey/list', usageUrl: 'https://console.bce.baidu.com/billing/#/billing/usage' },
  { value: 'openrouter',  label: 'OpenRouter', defaultURL: 'https://openrouter.ai/api/v1', defaultModel: 'openai/gpt-4o-mini', keyUrl: 'https://openrouter.ai/keys', usageUrl: 'https://openrouter.ai/activity' },
  { value: 'mistral',     label: 'Mistral AI', defaultURL: 'https://api.mistral.ai/v1', defaultModel: 'mistral-large-latest', keyUrl: 'https://console.mistral.ai/api-keys', usageUrl: 'https://console.mistral.ai/usage' },
  { value: 'groq',        label: 'Groq', defaultURL: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile', keyUrl: 'https://console.groq.com/keys', usageUrl: 'https://console.groq.com/settings/billing' },
  { value: 'together',    label: 'Together AI', defaultURL: 'https://api.together.xyz/v1', defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', keyUrl: 'https://api.together.ai/settings/api-keys', usageUrl: 'https://api.together.ai/settings/billing' },
  { value: 'fireworks',   label: 'Fireworks AI', defaultURL: 'https://api.fireworks.ai/inference/v1', defaultModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct', keyUrl: 'https://fireworks.ai/account/api-keys', usageUrl: 'https://fireworks.ai/account/billing' },
  { value: 'perplexity',  label: 'Perplexity', defaultURL: 'https://api.perplexity.ai', defaultModel: 'sonar', keyUrl: 'https://www.perplexity.ai/settings/api', usageUrl: 'https://www.perplexity.ai/settings/api' },
  { value: 'cohere',      label: 'Cohere', defaultURL: 'https://api.cohere.ai/compatibility/v1', defaultModel: 'command-r-plus', keyUrl: 'https://dashboard.cohere.com/api-keys', usageUrl: 'https://dashboard.cohere.com/billing/usage' },
  { value: 'siliconflow', label: '硅基流动 SiliconFlow', defaultURL: 'https://api.siliconflow.cn/v1', defaultModel: 'deepseek-ai/DeepSeek-V3', keyUrl: 'https://cloud.siliconflow.cn/account/ak', usageUrl: 'https://cloud.siliconflow.cn/me/account/expense' },
  { value: 'yi',          label: '零一万物（Yi）', defaultURL: 'https://api.lingyiwanwu.com/v1', defaultModel: 'yi-large', keyUrl: 'https://platform.lingyiwanwu.com/apikeys', usageUrl: 'https://platform.lingyiwanwu.com/billings' },
  { value: 'stepfun',     label: '阶跃星辰（StepFun）', defaultURL: 'https://api.stepfun.com/v1', defaultModel: 'step-2-16k', keyUrl: 'https://platform.stepfun.com/interface-key', usageUrl: 'https://platform.stepfun.com/account/financial/finance' },
  { value: 'azure',       label: 'Azure OpenAI', defaultURL: '', defaultModel: 'gpt-4o-mini', keyUrl: 'https://portal.azure.com/', usageUrl: 'https://portal.azure.com/#view/Microsoft_Azure_GTM/ModernBillingMenuBlade/~/Overview' },
  { value: 'ollama',   label: 'Ollama（本地）', defaultURL: 'http://localhost:11434/v1', defaultModel: 'llama3', keyUrl: '', usageUrl: '' },
  { value: 'custom',   label: '自定义 OpenAI 兼容接口', defaultURL: '', defaultModel: '', keyUrl: '', usageUrl: '' },
] as const;

export type ProviderValue = typeof PROVIDERS[number]['value'];

export interface LLMProfile {
  id: string;
  name: string;
  provider: ProviderValue;
  api_key?: string;
  base_url?: string;
  model?: string;
  no_think?: boolean; // Ollama 思考型模型（Qwen3+）专用
  reasoning_effort?: '' | 'low' | 'medium' | 'high'; // 深度思考档位：Claude thinking + OpenAI o-series
}

export function genId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function newProfile(index: number): LLMProfile {
  return { id: genId(), name: `配置 ${index}`, provider: 'deepseek', api_key: '', base_url: '', model: '' };
}
