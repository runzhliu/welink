// LLM 主配置共享类型 + Provider 元数据
// 默认型号核对日期：2026-10-20；来源及平台差异见 docs/ai-analysis.md。

// usageUrl: 各 provider 的"用量 / 账单"页。用户经常想看 token 消耗，
// 直接跳过去比自己进控制台找一遍方便。
// 部分 provider 没有专属用量页 → 留空，UI 自动不渲染按钮。
export const PROVIDERS = [
  { value: 'deepseek', label: 'DeepSeek', defaultURL: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-v4-pro', keyUrl: 'https://platform.deepseek.com/api_keys', usageUrl: 'https://platform.deepseek.com/usage' },
  { value: 'doubao',   label: '豆包（火山方舟）', defaultURL: 'https://ark.cn-beijing.volces.com/api/v3', defaultModel: 'doubao-seed-2-1-pro-260915', keyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey', usageUrl: 'https://console.volcengine.com/finance/bill' },
  { value: 'kimi',     label: 'Kimi (Moonshot)', defaultURL: 'https://api.moonshot.cn/v1', defaultModel: 'kimi-k3', keyUrl: 'https://platform.moonshot.cn/console/api-keys', usageUrl: 'https://platform.moonshot.cn/console/info' },
  { value: 'gemini',   label: 'Gemini', defaultURL: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-3.8-flash', keyUrl: 'https://aistudio.google.com/apikey', usageUrl: 'https://aistudio.google.com/usage' },
  { value: 'glm',      label: 'GLM（智谱 AI）', defaultURL: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-5.3', keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys', usageUrl: 'https://open.bigmodel.cn/finance/manage' },
  { value: 'grok',     label: 'Grok (xAI)', defaultURL: 'https://api.x.ai/v1', defaultModel: 'grok-4.7', keyUrl: 'https://console.x.ai/', usageUrl: 'https://console.x.ai/team/default/usage' },
  { value: 'minimax',     label: 'MiniMax（国际版）', defaultURL: 'https://api.minimax.io/v1', defaultModel: 'MiniMax-M3.1-Flash', keyUrl: 'https://www.minimax.io/user-center/basic-information/interface-key', usageUrl: 'https://www.minimax.io/user-center/finance-management/finance-overview' },
  { value: 'minimax-cn', label: 'MiniMax（国内版）', defaultURL: 'https://api.minimaxi.com/v1', defaultModel: 'MiniMax-M3.1-Flash', keyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key', usageUrl: 'https://platform.minimaxi.com/user-center/finance-management/finance-overview' },
  { value: 'openai',   label: 'OpenAI', defaultURL: 'https://api.openai.com/v1', defaultModel: 'gpt-6-astra', keyUrl: 'https://platform.openai.com/api-keys', usageUrl: 'https://platform.openai.com/usage' },
  { value: 'chatgpt',  label: 'ChatGPT 订阅', defaultURL: '', defaultModel: '', keyUrl: '', usageUrl: 'https://chatgpt.com/#settings/usage' },
  { value: 'claude',   label: 'Claude (Anthropic)', defaultURL: 'https://api.anthropic.com', defaultModel: 'claude-opus-5-5', keyUrl: 'https://console.anthropic.com/settings/keys', usageUrl: 'https://console.anthropic.com/settings/usage' },
  { value: 'vertex',   label: 'Google Vertex AI', defaultURL: '', defaultModel: 'google/gemini-3.8-flash', keyUrl: 'https://console.cloud.google.com/iam-admin/serviceaccounts', usageUrl: 'https://console.cloud.google.com/billing' },
  { value: 'bedrock',  label: 'AWS Bedrock', defaultURL: 'https://bedrock-mantle.us-east-1.api.aws/anthropic', defaultModel: 'anthropic.claude-opus-5-5', keyUrl: 'https://console.aws.amazon.com/bedrock/home', usageUrl: 'https://console.aws.amazon.com/cost-management/home' },
  { value: 'qwen',        label: '通义千问（DashScope）', defaultURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen3.8-max', keyUrl: 'https://bailian.console.aliyun.com/?tab=model#/api-key', usageUrl: 'https://billing.console.aliyun.com/expense/usage' },
  { value: 'hunyuan',     label: '腾讯混元', defaultURL: 'https://api.hunyuan.cloud.tencent.com/v1', defaultModel: 'hunyuan-turbos-latest', keyUrl: 'https://console.cloud.tencent.com/hunyuan/api-key', usageUrl: 'https://console.cloud.tencent.com/expense/bill/overview' },
  { value: 'qianfan',     label: '百度千帆（文心一言）', defaultURL: 'https://qianfan.baidubce.com/v2', defaultModel: 'ernie-5.1', keyUrl: 'https://console.bce.baidu.com/iam/#/iam/apikey/list', usageUrl: 'https://console.bce.baidu.com/billing/#/billing/usage' },
  { value: 'openrouter',  label: 'OpenRouter', defaultURL: 'https://openrouter.ai/api/v1', defaultModel: 'openai/gpt-6-astra', keyUrl: 'https://openrouter.ai/keys', usageUrl: 'https://openrouter.ai/activity' },
  { value: 'mistral',     label: 'Mistral AI', defaultURL: 'https://api.mistral.ai/v1', defaultModel: 'mistral-large-latest', keyUrl: 'https://console.mistral.ai/api-keys', usageUrl: 'https://console.mistral.ai/usage' },
  { value: 'groq',        label: 'Groq', defaultURL: 'https://api.groq.com/openai/v1', defaultModel: 'openai/gpt-oss-120b', keyUrl: 'https://console.groq.com/keys', usageUrl: 'https://console.groq.com/settings/billing' },
  { value: 'together',    label: 'Together AI', defaultURL: 'https://api.together.xyz/v1', defaultModel: 'deepseek-ai/DeepSeek-V4-Pro-0813', keyUrl: 'https://api.together.ai/settings/api-keys', usageUrl: 'https://api.together.ai/settings/billing' },
  { value: 'fireworks',   label: 'Fireworks AI', defaultURL: 'https://api.fireworks.ai/inference/v1', defaultModel: 'accounts/fireworks/models/deepseek-v4-pro', keyUrl: 'https://fireworks.ai/account/api-keys', usageUrl: 'https://fireworks.ai/account/billing' },
  { value: 'perplexity',  label: 'Perplexity', defaultURL: 'https://api.perplexity.ai', defaultModel: 'sonar-pro', keyUrl: 'https://www.perplexity.ai/settings/api', usageUrl: 'https://www.perplexity.ai/settings/api' },
  { value: 'cohere',      label: 'Cohere', defaultURL: 'https://api.cohere.ai/compatibility/v1', defaultModel: 'command-a-plus-05-2026', keyUrl: 'https://dashboard.cohere.com/api-keys', usageUrl: 'https://dashboard.cohere.com/billing/usage' },
  { value: 'siliconflow', label: '硅基流动 SiliconFlow', defaultURL: 'https://api.siliconflow.cn/v1', defaultModel: 'deepseek-ai/DeepSeek-V4-Pro', keyUrl: 'https://cloud.siliconflow.cn/account/ak', usageUrl: 'https://cloud.siliconflow.cn/me/account/expense' },
  { value: 'yi',          label: '零一万物（Yi）', defaultURL: 'https://api.lingyiwanwu.com/v1', defaultModel: 'yi-lightning', keyUrl: 'https://platform.lingyiwanwu.com/apikeys', usageUrl: 'https://platform.lingyiwanwu.com/billings' },
  { value: 'stepfun',     label: '阶跃星辰（StepFun）', defaultURL: 'https://api.stepfun.com/v1', defaultModel: 'step-3.7-flash', keyUrl: 'https://platform.stepfun.com/interface-key', usageUrl: 'https://platform.stepfun.com/account/financial/finance' },
  { value: 'azure',       label: 'Azure OpenAI', defaultURL: '', defaultModel: '', keyUrl: 'https://portal.azure.com/', usageUrl: 'https://portal.azure.com/#view/Microsoft_Azure_GTM/ModernBillingMenuBlade/~/Overview' },
  { value: 'ollama',   label: 'Ollama（本地）', defaultURL: 'http://localhost:11434/v1', defaultModel: 'llama3.3', keyUrl: '', usageUrl: '' },
  { value: 'custom',   label: '自定义 OpenAI 兼容接口', defaultURL: '', defaultModel: '', keyUrl: '', usageUrl: '' },
] as const;

export type ProviderValue = typeof PROVIDERS[number]['value'];

// 所有模型展示入口都从设置页元数据解析默认值，避免各页面各自维护旧型号。
export function getDefaultModel(provider: string, baseURL = ''): string {
  if (provider === 'bedrock' && baseURL) {
    try {
      const url = new URL(baseURL);
      if (!url.hostname.startsWith('bedrock-mantle.') && !url.pathname.replace(/\/+$/, '').endsWith('/anthropic')) {
        return ''; // Runtime 的 inference profile 依区域而定，需用户填写。
      }
    } catch { /* 无效 URL 由连接测试报告，展示默认型号。 */ }
  }
  return PROVIDERS.find(p => p.value === provider)?.defaultModel ?? '';
}

export function getDefaultBaseURL(provider: string, model = ''): string {
  if (provider === 'bedrock' && model && !/^anthropic\.claude-(opus-4-[78]|(opus|sonnet|haiku|fable)-5|mythos)/.test(model)) {
    return 'https://bedrock-runtime.us-east-1.amazonaws.com';
  }
  return PROVIDERS.find(p => p.value === provider)?.defaultURL ?? '';
}

// 只为已核实的具体型号提供窗口；用户自定义型号继续使用页面的保守估计。
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'deepseek-v4-pro': 1000000,
  'kimi-k3': 1000000,
  'gemini-3.8-flash': 1048576,
  'google/gemini-3.8-flash': 1048576,
  'glm-5.3': 1000000,
  'grok-4.7': 500000,
  'MiniMax-M3.1-Flash': 1000000,
  'gpt-6-astra': 1050000,
  'openai/gpt-6-astra': 1050000,
  'claude-opus-5-5': 1000000,
  'anthropic.claude-opus-5-5': 1000000,
  'qwen3.8-max': 1000000,
  'deepseek-ai/DeepSeek-V4-Pro-0813': 1048576,
};

export function getModelContextWindow(provider: string, model = ''): number | undefined {
  if (provider === 'ollama' || provider === 'custom' || provider === 'azure') return undefined;
  return MODEL_CONTEXT_WINDOWS[model || getDefaultModel(provider)];
}

export function getProviderLabel(provider: string): string {
  return PROVIDERS.find(p => p.value === provider)?.label ?? provider;
}

export interface LLMProfile {
	sft_deployment_id?: string;
  id: string;
  name: string;
  provider: ProviderValue;
  api_key?: string;
  base_url?: string;
  model?: string;
  no_think?: boolean; // Ollama 思考型模型（Qwen3+）专用
  reasoning_effort?: '' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'; // 留空使用模型默认值
}

export function genId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function newProfile(index: number): LLMProfile {
  return { id: genId(), name: `配置 ${index}`, provider: 'deepseek', api_key: '', base_url: '', model: '' };
}
