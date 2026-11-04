import { Select } from '../../common/Select';
import React from 'react';
import { X, Loader2, AlertCircle, Check, LogIn, LogOut, ExternalLink } from 'lucide-react';
import { Switch } from '../../common/Switch';
import { openProviderUrl } from '../constants';
import { PROVIDERS, getDefaultModel, getDefaultBaseURL, type LLMProfile, type ProviderValue } from './types';

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
  const defaultModel = getDefaultModel(profile.provider, profile.base_url);
  const model = profile.model || defaultModel;
  const defaultBaseURL = getDefaultBaseURL(profile.provider, profile.model);
  const isMiniMaxFlash = (profile.provider === 'minimax' || profile.provider === 'minimax-cn') && model === 'MiniMax-M3.1-Flash';

  const set = (field: keyof LLMProfile, val: string) =>
    onChange({ ...profile, [field]: val });

  if (profile.sft_deployment_id) return <div className="model-profile space-y-4">
    <div className="flex items-center gap-2"><span className="text-xs text-[var(--text-muted)]">SFT 模型</span><input aria-label={`配置 ${index + 1} 的名称`} value={profile.name} onChange={e => set('name', e.target.value)} className="flex-1 min-w-0 text-sm font-semibold bg-transparent focus:outline-none" />{total > 1 && <button type="button" onClick={onDelete} className="ui-icon-button" title="移除此配置"><X size={14} /></button>}</div>
    <p className="text-xs text-[var(--text-secondary)] leading-relaxed">由 SFT 工作台管理基础模型、推理服务与独立凭据。请在工作台检查状态、设为默认或回滚；切换数据账号后，原账号的训练模型不会接收新账号的消息。</p>
    <p className="text-[11px] text-[var(--text-muted)] break-all font-mono">{profile.model}</p>
    <div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => { window.location.hash = '#/sft'; }} className="ui-button ui-button-secondary">管理训练模型</button><button type="button" disabled={testing} onClick={() => onSaveAndTest(profile.id)} className="ui-button ui-button-secondary">{testing && <Loader2 size={12} className="animate-spin" />}测试连接</button></div>
    {testMsg && <p role="status" className={`text-xs ${testMsg.ok ? 'text-[var(--accent-text)]' : 'text-red-500'}`}>{testMsg.text}</p>}
  </div>;

  return (
    <div className="model-profile space-y-4">
      {/* 卡片标题行 */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">配置 {index + 1}</span>
        <input
          type="text"
          value={profile.name}
          onChange={e => set('name', e.target.value)}
          placeholder={`配置 ${index + 1}`}
          aria-label={`配置 ${index + 1} 的名称`}
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
        <label htmlFor={`provider-${profile.id}`} className="block text-xs font-medium mb-1.5">AI 提供商</label>
        <Select
          id={`provider-${profile.id}`}
          value={profile.provider}
          onValueChange={nextValue => {
            const newProvider = nextValue as ProviderValue;
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
              reasoning_effort: '',
              no_think: false,
              ...(shouldAutoRename ? { name: newProvider } : {}),
            });
          }}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#07c160] bg-white dk-input"
        >
          {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </Select>
      </div>

      {profile.provider === 'bedrock' && (
        <p className="text-[11px] text-gray-400 leading-relaxed">
          默认使用 Mantle Messages API（Opus 5.5）。旧模型可填写 bedrock-runtime 区域地址及原 Model ID。
        </p>
      )}

      {/* API Key */}
      <div>
        <label htmlFor={`key-${profile.id}`} className="flex items-center gap-2 text-[10px] font-bold text-gray-400 mb-1 uppercase tracking-wide">
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
            id={`key-${profile.id}`}
            value={profile.api_key ?? ''}
            onChange={e => set('api_key', e.target.value)}
            placeholder='粘贴完整的 Service Account JSON，含 private_key 和 client_email'
            rows={4}
            className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#07c160] bg-white font-mono dk-input"
          />
        ) : (
        <input
          type="password"
          id={`key-${profile.id}`}
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
          <br />Gemini 3.8 Flash 使用 global：<code className="bg-white/60 dark:bg-black/20 px-1 rounded">https://aiplatform.googleapis.com/v1beta1/projects/my-project-123/locations/global/endpoints/openapi</code>
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
          <input aria-label="Base URL" type="text" value={profile.base_url ?? ''} onChange={e => set('base_url', e.target.value)}
            placeholder={defaultBaseURL ? `默认：${defaultBaseURL}` : '请输入 Base URL'}
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
          模型 <span className="font-normal normal-case">{defaultModel ? '（留空使用默认）' : '（必填）'}</span>
        </label>
        <input aria-label="模型名称" type="text" value={profile.model ?? ''} onChange={e => set('model', e.target.value)}
          placeholder={defaultModel ? `默认：${defaultModel}` : profile.provider === 'azure' ? '请输入 Azure 部署名称' : '请输入模型名'}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#07c160] bg-white font-mono dk-input" />
      </div>

      {/* MiniMax 思考模型提示 */}
      {(profile.provider === 'minimax' || profile.provider === 'minimax-cn') && (profile.model ?? '').toLowerCase().includes('m2') && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/30 text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
          <AlertCircle size={13} className="flex-shrink-0 mt-0.5 text-amber-500" />
          <div>
            <strong>MiniMax-M2 系列是思考模型</strong>，会输出推理过程，响应较慢且 token 消耗大。
            可升级到 <button type="button" onClick={() => onChange({ ...profile, model: provInfo.defaultModel })} className="text-[#07c160] font-bold underline">{provInfo.defaultModel}</button>，并选择较低思考强度。
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
          <Switch checked={!!profile.no_think} onChange={value => onChange({ ...profile, no_think: value })} label="Ollama 跳过思考" />
        </div>
      )}

      {/* 留空交给模型默认行为；新模型可能始终启用思考。 */}
      {(profile.provider === 'claude' || profile.provider === 'openai' || isMiniMaxFlash || (profile.provider === 'bedrock' && (profile.base_url || defaultBaseURL).includes('/anthropic'))) && (
        <div className="flex items-center justify-between py-1 gap-3">
          <div className="flex-1 min-w-0">
            <span className="text-sm text-[#1d1d1f] dark:text-gray-200">深度思考</span>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {profile.provider === 'claude' || profile.provider === 'bedrock'
                ? '新版 Claude 使用自适应思考；旧模型使用预算档位。Opus 5.5 的思考始终开启。'
                : isMiniMaxFlash ? 'MiniMax M3.1 Flash 始终开启思考，可调节推理强度。'
                : 'OpenAI reasoning_effort；GPT-6 默认启用推理，可选择低档降低耗时。'}
            </p>
          </div>
          <Select
            aria-label="深度思考强度"
            value={profile.reasoning_effort || ''}
            onValueChange={(nextValue) => onChange({ ...profile, reasoning_effort: nextValue as LLMProfile['reasoning_effort'] })}
            className="px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-sm text-[#1d1d1f] dark:text-white outline-none focus:border-[#07c160]"
          >
            <option value="">模型默认</option>
            <option value="low">低</option>
            <option value="medium">中</option>
            <option value="high">高</option>
            {(profile.provider === 'openai' || isMiniMaxFlash) && <option value="xhigh">极高</option>}
            {(profile.provider === 'openai' || isMiniMaxFlash) && <option value="max">最高</option>}
          </Select>
        </div>
      )}

      {/* 测试连接 */}
      <div className="flex items-center gap-2 pt-1">
        <button onClick={() => onSaveAndTest(profile.id)} disabled={testing}
          className="ui-button ui-button-secondary">
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
