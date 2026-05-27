import React from 'react';
import { X, Loader2, AlertCircle, Check, LogIn, LogOut, ExternalLink } from 'lucide-react';
import { openProviderUrl } from '../constants';
import { PROVIDERS, type LLMProfile, type ProviderValue } from './types';

export const ProfileCard: React.FC<{
  profile: LLMProfile;
  index: number;
  total: number;
  geminiAuthorized: boolean;
  geminiClientID: string;
  geminiClientSecret: string;
  onGeminiClientIDChange: (v: string) => void;
  onGeminiClientSecretChange: (v: string) => void;
  onGeminiAuth: () => void;
  onGeminiRevoke: () => void;
  geminiAuthBusy: boolean;
  onChange: (updated: LLMProfile) => void;
  onDelete: () => void;
  onSaveAndTest: (profileId: string) => void;
  testing: boolean;
  testMsg: { ok: boolean; text: string } | null;
}> = ({ profile, index, total, geminiAuthorized, geminiClientID, geminiClientSecret,
         onGeminiClientIDChange, onGeminiClientSecretChange, onGeminiAuth, onGeminiRevoke,
         geminiAuthBusy, onChange, onDelete, onSaveAndTest, testing, testMsg }) => {
  const provInfo = PROVIDERS.find(p => p.value === profile.provider) ?? PROVIDERS[0];

  const set = (field: keyof LLMProfile, val: string) =>
    onChange({ ...profile, [field]: val });

  return (
    <div className="rounded-xl border border-gray-100 dark:border-white/10 bg-[#fafafa] dark:bg-white/5 p-4 space-y-3">
      {/* 卡片标题行 */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">配置 {index + 1}</span>
        <input
          type="text"
          value={profile.name}
          onChange={e => set('name', e.target.value)}
          placeholder={`配置 ${index + 1}`}
          className="flex-1 text-sm font-semibold border-0 bg-transparent focus:outline-none text-[#1d1d1f] dark:text-gray-200 placeholder-gray-300"
        />
        {total > 1 && (
          <button onClick={onDelete} className="p-1 text-gray-300 hover:text-red-400 transition-colors" title="删除此配置">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Provider */}
      <div>
        <label className="block text-[10px] font-bold text-gray-400 mb-1 uppercase tracking-wide">AI 提供商</label>
        <select
          value={profile.provider}
          onChange={e => {
            const newProvider = e.target.value as ProviderValue;
            const oldProvider = profile.provider;
            const oldProviderNames: string[] = PROVIDERS.map(p => p.value as string);
            const shouldAutoRename = !profile.name || oldProviderNames.includes(profile.name);
            // provider 真的变了 → 清空 api_key（不同 provider 的 key 不通用）
            // provider 没变（比如切走再切回来在同一次未保存的编辑中）→ 保留
            const providerChanged = newProvider !== oldProvider;
            onChange({
              ...profile,
              provider: newProvider,
              api_key: providerChanged ? '' : profile.api_key,
              base_url: '',
              model: '',
              ...(shouldAutoRename ? { name: newProvider } : {}),
            });
          }}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#07c160] bg-white dk-input"
        >
          {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </div>

      {/* API Key */}
      <div>
        <label className="flex items-center gap-2 text-[10px] font-bold text-gray-400 mb-1 uppercase tracking-wide">
          <span>
            {profile.provider === 'vertex' ? 'Service Account JSON' : 'API Key'}
            {profile.provider === 'ollama' && <span className="ml-1 font-normal normal-case text-gray-400">（本地无需填写）</span>}
            {profile.provider === 'gemini' && geminiAuthorized && <span className="ml-1 font-normal normal-case text-gray-400">（OAuth 已授权，可留空）</span>}
            {profile.provider === 'bedrock' && <span className="ml-1 font-normal normal-case text-gray-400">（格式：AccessKeyId:SecretAccessKey）</span>}
            {profile.provider === 'vertex' && <span className="ml-1 font-normal normal-case text-gray-400">（完整 JSON）</span>}
          </span>
          {(provInfo.keyUrl || provInfo.usageUrl) && (
            <span className="ml-auto flex items-center gap-1">
              {provInfo.keyUrl && (
                <button
                  type="button"
                  onClick={() => openProviderUrl(provInfo.keyUrl)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold normal-case tracking-normal bg-[#07c160]/10 dark:bg-[#07c160]/20 text-[#07c160] hover:bg-[#07c160]/20 dark:hover:bg-[#07c160]/30 transition-colors"
                  title={provInfo.keyUrl}
                >
                  {profile.provider === 'vertex' ? '去 GCP Console' : profile.provider === 'bedrock' ? '去 AWS Console' : '获取 Key'}
                  <ExternalLink size={10} />
                </button>
              )}
              {provInfo.usageUrl && (
                <button
                  type="button"
                  onClick={() => openProviderUrl(provInfo.usageUrl)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold normal-case tracking-normal bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/15 transition-colors"
                  title={`查看 token 用量：${provInfo.usageUrl}`}
                >
                  查看用量
                  <ExternalLink size={10} />
                </button>
              )}
            </span>
          )}
        </label>
        {profile.provider === 'vertex' ? (
          <textarea
            value={profile.api_key ?? ''}
            onChange={e => set('api_key', e.target.value)}
            placeholder='粘贴完整的 Service Account JSON，含 private_key 和 client_email'
            rows={4}
            className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#07c160] bg-white font-mono dk-input"
          />
        ) : (
        <input
          type="password"
          value={profile.api_key === '__HAS_KEY__' ? '' : (profile.api_key ?? '')}
          onChange={e => set('api_key', e.target.value)}
          placeholder={
            profile.api_key === '__HAS_KEY__'
              ? '●●●●●●●● 已保存（留空保留，输入则覆盖）'
              : profile.provider === 'ollama' ? '留空即可'
              : profile.provider === 'gemini' && geminiAuthorized ? '已通过 OAuth 授权'
              : profile.provider === 'bedrock' ? 'AccessKeyId:SecretAccessKey'
              : '请输入 API Key'
          }
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#07c160] bg-white font-mono dk-input"
        />
        )}
      </div>

      {/* Vertex AI Base URL 提示 */}
      {profile.provider === 'vertex' && (
        <div className="rounded-lg border border-green-100 dark:border-green-500/30 bg-green-50 dark:bg-green-500/10 p-3 text-[10px] text-green-700 dark:text-green-400 leading-relaxed">
          <strong>Base URL 格式</strong>：<code className="bg-white/60 dark:bg-black/20 px-1 rounded">{'https://{region}-aiplatform.googleapis.com/v1beta1/projects/{project}/locations/{region}/endpoints/openapi'}</code>
          <br />例如：<code className="bg-white/60 dark:bg-black/20 px-1 rounded">https://us-central1-aiplatform.googleapis.com/v1beta1/projects/my-project-123/locations/us-central1/endpoints/openapi</code>
        </div>
      )}

      {/* Gemini OAuth（全局唯一，仅在第一个 Gemini profile 处显示） */}
      {profile.provider === 'gemini' && index === 0 && (
        <div className="rounded-lg border border-blue-100 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10 p-3 space-y-2">
          <p className="text-[10px] font-bold text-blue-700 dark:text-blue-400 uppercase tracking-wide">Google OAuth 登录（可选）</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-bold text-blue-600 dark:text-blue-400 mb-1">Client ID</label>
              <input type="text" value={geminiClientID} onChange={e => onGeminiClientIDChange(e.target.value)}
                placeholder="xxxxx.apps.googleusercontent.com"
                className="w-full text-xs border border-blue-200 dark:border-blue-500/30 rounded-md px-2 py-1.5 focus:outline-none focus:border-blue-400 bg-white font-mono dk-input" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-blue-600 dark:text-blue-400 mb-1">Client Secret</label>
              <input type="password"
                value={geminiClientSecret === '__HAS_KEY__' ? '' : geminiClientSecret}
                onChange={e => onGeminiClientSecretChange(e.target.value)}
                placeholder={geminiClientSecret === '__HAS_KEY__' ? '●●●●●● 已保存' : 'GOCSPX-…'}
                className="w-full text-xs border border-blue-200 dark:border-blue-500/30 rounded-md px-2 py-1.5 focus:outline-none focus:border-blue-400 bg-white font-mono dk-input" />
            </div>
          </div>
          {geminiAuthorized ? (
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-xs font-semibold text-green-600"><Check size={12} />已通过 Google 授权</span>
              <button onClick={onGeminiRevoke} className="flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-red-200 dark:border-red-500/30 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors">
                <LogOut size={10} />撤销授权
              </button>
            </div>
          ) : (
            <button onClick={onGeminiAuth} disabled={geminiAuthBusy}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-md bg-white dk-card border border-blue-300 dark:border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10 disabled:opacity-50 transition-colors">
              {geminiAuthBusy ? <><Loader2 size={11} className="animate-spin" />等待授权…</> : <><LogIn size={11} />通过 Google 账号授权</>}
            </button>
          )}
        </div>
      )}

      {/* Base URL */}
      <div>
        <label className="block text-[10px] font-bold text-gray-400 mb-1 uppercase tracking-wide">
          Base URL <span className="font-normal normal-case">（留空使用默认）</span>
        </label>
        <div className="flex items-center gap-2">
          <input type="text" value={profile.base_url ?? ''} onChange={e => set('base_url', e.target.value)}
            placeholder={provInfo.defaultURL ? `默认：${provInfo.defaultURL}` : '请输入 Base URL'}
            className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#07c160] bg-white font-mono dk-input" />
          {profile.provider === 'ollama' && (
            <button onClick={() => set('base_url', 'http://host.docker.internal:11434/v1')}
              className="text-xs text-gray-400 hover:text-[#07c160] underline whitespace-nowrap transition-colors" title="Docker 容器内访问宿主机 Ollama">
              Docker 地址
            </button>
          )}
        </div>
      </div>

      {/* Model */}
      <div>
        <label className="block text-[10px] font-bold text-gray-400 mb-1 uppercase tracking-wide">
          模型 <span className="font-normal normal-case">（留空使用默认）</span>
        </label>
        <input type="text" value={profile.model ?? ''} onChange={e => set('model', e.target.value)}
          placeholder={provInfo.defaultModel ? `默认：${provInfo.defaultModel}` : '请输入模型名'}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#07c160] bg-white font-mono dk-input" />
      </div>

      {/* MiniMax 思考模型提示 */}
      {(profile.provider === 'minimax' || profile.provider === 'minimax-cn') && (profile.model ?? '').toLowerCase().includes('m2') && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/30 text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
          <AlertCircle size={13} className="flex-shrink-0 mt-0.5 text-amber-500" />
          <div>
            <strong>MiniMax-M2 系列是思考模型</strong>，会输出推理过程，响应较慢且 token 消耗大。
            如不需要深度推理，建议使用 <button type="button" onClick={() => onChange({ ...profile, model: 'MiniMax-Text-01' })} className="text-[#07c160] font-bold underline">MiniMax-Text-01</button> 或 <button type="button" onClick={() => onChange({ ...profile, model: 'MiniMax-Text-01-128k' })} className="text-[#07c160] font-bold underline">MiniMax-Text-01-128k</button>。
          </div>
        </div>
      )}

      {/* Ollama no_think 开关 */}
      {profile.provider === 'ollama' && (
        <div className="flex items-center justify-between py-1">
          <div>
            <span className="text-sm text-[#1d1d1f] dark:text-gray-200">开启 /no_think</span>
            <p className="text-[11px] text-gray-400 mt-0.5">适用于 Qwen3 等思考型模型，跳过推理阶段，避免超时</p>
          </div>
          <button
            type="button"
            onClick={() => onChange({ ...profile, no_think: !profile.no_think })}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${profile.no_think ? 'bg-[#07c160]' : 'bg-gray-200 dark:bg-white/20'}`}
          >
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${profile.no_think ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
          </button>
        </div>
      )}

      {/* 深度思考档位（Claude Sonnet 4+ / Opus 4+ 以及 OpenAI o-series 有效） */}
      {(profile.provider === 'claude' || profile.provider === 'openai') && (
        <div className="flex items-center justify-between py-1 gap-3">
          <div className="flex-1 min-w-0">
            <span className="text-sm text-[#1d1d1f] dark:text-gray-200">深度思考</span>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {profile.provider === 'claude'
                ? 'Claude Extended Thinking（Sonnet 4+ / Opus 4+）— 档位对应 2K / 8K / 16K budget_tokens'
                : 'OpenAI reasoning_effort — 适用 o1 / o3 / gpt-5-reasoning 等模型'}
            </p>
          </div>
          <select
            value={profile.reasoning_effort || ''}
            onChange={(e) => onChange({ ...profile, reasoning_effort: e.target.value as LLMProfile['reasoning_effort'] })}
            className="px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-sm text-[#1d1d1f] dark:text-white outline-none focus:border-[#07c160]"
          >
            <option value="">关闭</option>
            <option value="low">低</option>
            <option value="medium">中</option>
            <option value="high">高</option>
          </select>
        </div>
      )}

      {/* 测试连接 */}
      <div className="flex items-center gap-2 pt-1">
        <button onClick={() => onSaveAndTest(profile.id)} disabled={testing}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 dark:border-white/10 text-gray-500 dark:text-gray-400 text-xs font-bold rounded-lg hover:border-[#07c160] hover:text-[#07c160] disabled:opacity-50 transition-colors">
          {testing ? <Loader2 size={12} className="animate-spin" /> : <AlertCircle size={12} />}
          测试连接
        </button>
        {testMsg && (
          <span className={`text-xs font-semibold ${testMsg.ok ? 'text-[#07c160]' : 'text-red-500'}`}>
            {testMsg.ok ? '✓ ' : '✕ '}{testMsg.text}
          </span>
        )}
      </div>
    </div>
  );
};
