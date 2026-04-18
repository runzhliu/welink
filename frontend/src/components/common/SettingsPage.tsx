/**
 * 设置页 — 隐私屏蔽（两种模式通用）+ App 配置（仅 App 模式）
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  X, Plus, ShieldOff, User, Users,
  FolderOpen, Loader2, Database, FileText, AlertCircle, RotateCcw, CheckCircle2, EyeOff, BarChart2, Bot, Check, LogIn, LogOut, Stethoscope, AlertTriangle, XCircle, Copy,
  Settings, Clock, Cpu, Save, RefreshCw, Sparkles,
} from 'lucide-react';
import axios from 'axios';
import { PROMPT_TEMPLATES } from '../../utils/promptTemplates';

export const MEMBER_RANK_LIMIT_KEY = 'welink_member_rank_limit';
export const MEMBER_NAME_WIDTH_KEY = 'welink_member_name_width';
export const DEFAULT_RANK_LIMIT = 10;
export const DEFAULT_NAME_WIDTH = 144; // px, roughly w-36
import { appApi } from '../../services/appApi';
import type { ContactStats, GroupInfo } from '../../types';
import { useToast } from './Toast';
import { RelativeTime } from './RelativeTime';
import { FeedbackModal } from './FeedbackModal';

// ─── 隐私屏蔽子组件 ───────────────────────────────────────────────────────────

const TagList: React.FC<{
  items: string[];
  onRemove: (v: string) => void;
  emptyText: string;
  labelFor?: (id: string) => string;
  privacyMode?: boolean;
}> = ({ items, onRemove, emptyText, labelFor, privacyMode }) => (
  <div className="min-h-[56px] flex flex-wrap gap-2">
    {items.length === 0 ? (
      <span className="text-sm text-gray-400 self-center">{emptyText}</span>
    ) : (
      items.map((item) => {
        const label = labelFor ? labelFor(item) : item;
        const showId = label !== item;
        return (
          <span
            key={item}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-gray-300"
          >
            <span className={privacyMode ? 'privacy-blur' : ''}>{label}</span>
            {showId && <span className={`text-xs text-gray-400${privacyMode ? ' privacy-blur' : ''}`}>{item}</span>}
            <button
              onClick={() => onRemove(item)}
              className="text-gray-400 hover:text-red-500 transition-colors"
            >
              <X size={13} />
            </button>
          </span>
        );
      })
    )}
  </div>
);

const AddInput: React.FC<{
  placeholder: string;
  onAdd: (v: string) => void;
}> = ({ placeholder, onAdd }) => {
  const [value, setValue] = useState('');

  const submit = () => {
    if (value.trim()) {
      onAdd(value.trim());
      setValue('');
    }
  };

  return (
    <div className="flex flex-col sm:flex-row gap-2 mt-3">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder={placeholder}
        className="flex-1 px-4 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#07c160]/20 focus:border-[#07c160] transition-all dk-input"
      />
      <button
        onClick={submit}
        className="flex items-center gap-1.5 px-4 py-2 bg-[#07c160] text-white text-sm font-semibold rounded-xl hover:bg-[#06ad56] transition-colors"
      >
        <Plus size={15} />
        添加
      </button>
    </div>
  );
};

// ─── AI 配置区块 ───────────────────────────────────────────────────────────────

const PROVIDERS = [
  { value: 'deepseek', label: 'DeepSeek', defaultURL: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat' },
  { value: 'kimi',     label: 'Kimi (Moonshot)', defaultURL: 'https://api.moonshot.cn/v1', defaultModel: 'kimi-k2.5' },
  { value: 'gemini',   label: 'Gemini', defaultURL: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-2.0-flash' },
  { value: 'glm',      label: 'GLM（智谱 AI）', defaultURL: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4-flash' },
  { value: 'grok',     label: 'Grok (xAI)', defaultURL: 'https://api.x.ai/v1', defaultModel: 'grok-3-mini' },
  { value: 'minimax',     label: 'MiniMax（国际版）', defaultURL: 'https://api.minimax.io/v1', defaultModel: 'MiniMax-Text-01' },
  { value: 'minimax-cn', label: 'MiniMax（国内版）', defaultURL: 'https://api.minimaxi.com/v1', defaultModel: 'MiniMax-Text-01' },
  { value: 'openai',   label: 'OpenAI', defaultURL: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini' },
  { value: 'claude',   label: 'Claude (Anthropic)', defaultURL: 'https://api.anthropic.com', defaultModel: 'claude-haiku-4-5-20251001' },
  { value: 'vertex',   label: 'Google Vertex AI', defaultURL: '', defaultModel: 'google/gemini-2.0-flash-001' },
  { value: 'bedrock',  label: 'AWS Bedrock', defaultURL: 'https://bedrock-runtime.us-east-1.amazonaws.com', defaultModel: 'us.anthropic.claude-sonnet-4-6' },
  { value: 'ollama',   label: 'Ollama（本地）', defaultURL: 'http://localhost:11434/v1', defaultModel: 'llama3' },
  { value: 'custom',   label: '自定义 OpenAI 兼容接口', defaultURL: '', defaultModel: '' },
] as const;

type ProviderValue = typeof PROVIDERS[number]['value'];

interface LLMProfile {
  id: string;
  name: string;
  provider: ProviderValue;
  api_key?: string;
  base_url?: string;
  model?: string;
  no_think?: boolean; // Ollama 思考型模型（Qwen3+）专用
}

function genId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function newProfile(index: number): LLMProfile {
  return { id: genId(), name: `配置 ${index}`, provider: 'deepseek', api_key: '', base_url: '', model: '' };
}

// ─── 单个 Profile 卡片 ────────────────────────────────────────────────────────

const ProfileCard: React.FC<{
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
        <label className="block text-[10px] font-bold text-gray-400 mb-1 uppercase tracking-wide">
          {profile.provider === 'vertex' ? 'Service Account JSON' : 'API Key'}
          {profile.provider === 'ollama' && <span className="ml-1 font-normal normal-case text-gray-400">（本地无需填写）</span>}
          {profile.provider === 'gemini' && geminiAuthorized && <span className="ml-1 font-normal normal-case text-gray-400">（OAuth 已授权，可留空）</span>}
          {profile.provider === 'bedrock' && <span className="ml-1 font-normal normal-case text-gray-400">（格式：AccessKeyId:SecretAccessKey）</span>}
          {profile.provider === 'vertex' && <span className="ml-1 font-normal normal-case text-gray-400">（完整 JSON）</span>}
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

const AISettingsSection: React.FC = () => {
  const [profiles, setProfiles] = useState<LLMProfile[]>([newProfile(1)]);
  const [aiDBPath, setAiDBPath] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loaded, setLoaded] = useState(false);
  // per-profile test state
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testMsgs, setTestMsgs] = useState<Record<string, { ok: boolean; text: string }>>({});

  // Gemini OAuth（全局）
  const [geminiClientID, setGeminiClientID] = useState('');
  const [geminiClientSecret, setGeminiClientSecret] = useState('');
  const [geminiAuthorized, setGeminiAuthorized] = useState(false);
  const [geminiAuthBusy, setGeminiAuthBusy] = useState(false);
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  // 保存 Embedding 字段，防止保存 LLM 时覆盖
  const embeddingPrefsRef = React.useRef<{
    embedding_provider?: string; embedding_api_key?: string;
    embedding_base_url?: string; embedding_model?: string; embedding_dims?: number;
  }>({});

  const checkGeminiStatus = async () => {
    try {
      const r = await axios.get<{ authorized: boolean }>('/api/auth/gemini/status');
      setGeminiAuthorized(r.data.authorized);
      return r.data.authorized;
    } catch { return false; }
  };

  // 从后端加载配置（初始化 + 保存后刷新）
  const loadPreferences = useCallback(async () => {
    try {
      const r = await axios.get<{
        llm_profiles?: LLMProfile[];
        llm_provider?: string; llm_api_key?: string;
        llm_base_url?: string; llm_model?: string;
        gemini_client_id?: string; gemini_client_secret?: string;
        ai_analysis_db_path?: string;
        embedding_provider?: string; embedding_api_key?: string;
        embedding_base_url?: string; embedding_model?: string; embedding_dims?: number;
      }>('/api/preferences');
      if (r.data.llm_profiles && r.data.llm_profiles.length > 0) {
        setProfiles(r.data.llm_profiles);
      } else if (r.data.llm_provider) {
        setProfiles([{
          id: genId(),
          name: r.data.llm_provider,
          provider: r.data.llm_provider as ProviderValue,
          api_key: r.data.llm_api_key ?? '',
          base_url: r.data.llm_base_url ?? '',
          model: r.data.llm_model ?? '',
        }]);
      }
      setGeminiClientID(r.data.gemini_client_id ?? '');
      setGeminiClientSecret(r.data.gemini_client_secret ?? '');
      setAiDBPath(r.data.ai_analysis_db_path ?? '');
      embeddingPrefsRef.current = {
        embedding_provider: r.data.embedding_provider,
        embedding_api_key: r.data.embedding_api_key,
        embedding_base_url: r.data.embedding_base_url,
        embedding_model: r.data.embedding_model,
        embedding_dims: r.data.embedding_dims,
      };
    } catch {} finally { setLoaded(true); }
  }, []);

  useEffect(() => {
    loadPreferences();
    checkGeminiStatus();
  }, [loadPreferences]);

  const buildPayload = () => ({
    llm_profiles: profiles,
    gemini_client_id: geminiClientID,
    gemini_client_secret: geminiClientSecret,
    ai_analysis_db_path: aiDBPath,
    ...embeddingPrefsRef.current,
  });

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      await axios.put('/api/preferences/llm', buildPayload());
      await loadPreferences(); // 重新从后端加载，确保 __HAS_KEY__ 标记正确
      setSaveMsg({ ok: true, text: '已保存' });
    } catch {
      setSaveMsg({ ok: false, text: '保存失败' });
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(null), 3000);
    }
  };

  const handleSaveAndTest = async (profileId: string) => {
    setTestingId(profileId);
    setTestMsgs(prev => { const n = { ...prev }; delete n[profileId]; return n; });
    try {
      await axios.put('/api/preferences/llm', buildPayload());
      await loadPreferences(); // 重新加载确保 key 标记正确
      const r = await axios.post<{ ok: boolean; provider: string; model: string }>('/api/ai/llm/test', { profile_id: profileId });
      setTestMsgs(prev => ({ ...prev, [profileId]: { ok: true, text: `连接成功（${r.data.provider} · ${r.data.model}）` } }));
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? '连接失败';
      setTestMsgs(prev => ({ ...prev, [profileId]: { ok: false, text: msg } }));
    } finally {
      setTestingId(null);
      setTimeout(() => setTestMsgs(prev => { const n = { ...prev }; delete n[profileId]; return n; }), 5000);
    }
  };

  const handleGeminiAuth = async () => {
    if (!geminiClientID || !geminiClientSecret) {
      setSaveMsg({ ok: false, text: '请先填写 Client ID 和 Client Secret' });
      setTimeout(() => setSaveMsg(null), 3000);
      return;
    }
    await axios.put('/api/preferences/llm', buildPayload()).catch(() => {});
    try {
      const r = await axios.get<{ url: string }>('/api/auth/gemini/url');
      window.open(r.data.url, '_blank');
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? '获取授权地址失败';
      setSaveMsg({ ok: false, text: msg });
      setTimeout(() => setSaveMsg(null), 3000);
      return;
    }
    setGeminiAuthBusy(true);
    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts++;
      const authed = await checkGeminiStatus();
      if (authed || attempts > 30) {
        clearInterval(pollRef.current!);
        setGeminiAuthBusy(false);
        if (authed) setSaveMsg({ ok: true, text: 'Google 授权成功！' });
        setTimeout(() => setSaveMsg(null), 3000);
      }
    }, 2000);
  };

  const handleGeminiRevoke = async () => {
    await axios.delete('/api/auth/gemini').catch(() => {});
    setGeminiAuthorized(false);
  };

  if (!loaded) return null;

  return (
    <div className="space-y-3">
        {profiles.map((p, i) => (
          <ProfileCard
            key={p.id}
            profile={p}
            index={i}
            total={profiles.length}
            geminiAuthorized={geminiAuthorized}
            geminiClientID={geminiClientID}
            geminiClientSecret={geminiClientSecret}
            onGeminiClientIDChange={setGeminiClientID}
            onGeminiClientSecretChange={setGeminiClientSecret}
            onGeminiAuth={handleGeminiAuth}
            onGeminiRevoke={handleGeminiRevoke}
            geminiAuthBusy={geminiAuthBusy}
            onChange={updated => setProfiles(prev => prev.map(x => x.id === updated.id ? updated : x))}
            onDelete={() => setProfiles(prev => prev.filter(x => x.id !== p.id))}
            onSaveAndTest={handleSaveAndTest}
            testing={testingId === p.id}
            testMsg={testMsgs[p.id] ?? null}
          />
        ))}

        {/* 添加配置 */}
        <button
          onClick={() => setProfiles(prev => [...prev, newProfile(prev.length + 1)])}
          className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-dashed border-gray-200 dark:border-white/10 text-sm text-gray-400 hover:border-[#07c160] hover:text-[#07c160] transition-colors"
        >
          <Plus size={14} />
          添加 AI 配置
        </button>

        {/* 分析历史数据库路径 */}
        <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-2 dk-card dk-border">
          <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            分析历史数据库路径 <span className="text-gray-400 font-normal normal-case">（留空使用默认）</span>
          </label>
          <input
            type="text"
            value={aiDBPath}
            onChange={e => setAiDBPath(e.target.value)}
            placeholder="留空则与配置文件同目录，如 /data/ai_analysis.db"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#07c160] bg-[#f8f9fb] font-mono dk-input"
          />
          <p className="text-[10px] text-gray-400">Docker 建议设为挂载目录下的路径，确保容器重启后分析记录不丢失。</p>
        </div>

        {/* 保存所有 */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-5 py-2.5 bg-[#07c160] text-white text-sm font-bold rounded-xl hover:bg-[#06ad56] disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            保存所有配置
          </button>
          {saveMsg && (
            <span className={`text-sm font-semibold ${saveMsg.ok ? 'text-[#07c160]' : 'text-red-500'}`}>
              {saveMsg.ok ? '✓ ' : '✕ '}{saveMsg.text}
            </span>
          )}
        </div>
    </div>
  );
};

// ─── Embedding 配置区块 ────────────────────────────────────────────────────────

const EMBEDDING_PROVIDERS = [
  { value: 'ollama',  label: 'Ollama（本地，免费）', defaultURL: 'http://localhost:11434', defaultModel: 'nomic-embed-text', needsKey: false },
  { value: 'openai',  label: 'OpenAI', defaultURL: 'https://api.openai.com/v1', defaultModel: 'text-embedding-3-small', needsKey: true },
  { value: 'jina',    label: 'Jina AI', defaultURL: 'https://api.jina.ai/v1', defaultModel: 'jina-embeddings-v3', needsKey: true },
  { value: 'custom',  label: '自定义（OpenAI 兼容）', defaultURL: '', defaultModel: '', needsKey: true },
] as const;

type EmbeddingProviderValue = typeof EMBEDDING_PROVIDERS[number]['value'];

const EmbeddingSettingsSection: React.FC = () => {
  const [provider, setProvider] = useState<EmbeddingProviderValue>('ollama');
  const [apiKey, setApiKey] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [model, setModel] = useState('');
  const [cacheMaxKeys, setCacheMaxKeys] = useState(3);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // 保存 LLM 字段，防止保存 Embedding 时覆盖
  const llmPrefsRef = React.useRef<{
    llm_provider?: string; llm_api_key?: string; llm_base_url?: string; llm_model?: string;
    gemini_client_id?: string; gemini_client_secret?: string; ai_analysis_db_path?: string;
  }>({});

  useEffect(() => {
    axios.get<{
      embedding_provider?: string; embedding_api_key?: string;
      embedding_base_url?: string; embedding_model?: string;
      vec_cache_max_keys?: number;
      llm_provider?: string; llm_api_key?: string; llm_base_url?: string; llm_model?: string;
      gemini_client_id?: string; gemini_client_secret?: string; ai_analysis_db_path?: string;
    }>('/api/preferences').then(r => {
      if (r.data.embedding_provider) setProvider(r.data.embedding_provider as EmbeddingProviderValue);
      setApiKey(r.data.embedding_api_key ?? '');
      setBaseURL(r.data.embedding_base_url ?? '');
      setModel(r.data.embedding_model ?? '');
      setCacheMaxKeys(r.data.vec_cache_max_keys || 3);
      llmPrefsRef.current = {
        llm_provider: r.data.llm_provider,
        llm_api_key: r.data.llm_api_key,
        llm_base_url: r.data.llm_base_url,
        llm_model: r.data.llm_model,
        gemini_client_id: r.data.gemini_client_id,
        gemini_client_secret: r.data.gemini_client_secret,
        ai_analysis_db_path: r.data.ai_analysis_db_path,
      };
    }).catch(() => {}).finally(() => setLoaded(true));
  }, []);

  const providerInfo = EMBEDDING_PROVIDERS.find(p => p.value === provider) ?? EMBEDDING_PROVIDERS[0];

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      await axios.put('/api/preferences/llm', {
        ...llmPrefsRef.current,
        embedding_provider: provider,
        embedding_api_key: apiKey,
        embedding_base_url: baseURL,
        embedding_model: model,
        vec_cache_max_keys: cacheMaxKeys,
      });
      setSaveMsg({ ok: true, text: '已保存' });
    } catch {
      setSaveMsg({ ok: false, text: '保存失败' });
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(null), 3000);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setSaveMsg(null);
    try {
      // 先保存当前配置，再测试
      await axios.put('/api/preferences/llm', {
        ...llmPrefsRef.current,
        embedding_provider: provider,
        embedding_api_key: apiKey,
        embedding_base_url: baseURL,
        embedding_model: model,
        vec_cache_max_keys: cacheMaxKeys,
      });
      const r = await axios.post<{ ok: boolean; provider: string; model: string }>('/api/ai/vec/test-embedding');
      setSaveMsg({ ok: true, text: `连接成功（${r.data.provider} · ${r.data.model}）` });
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? '连接失败';
      setSaveMsg({ ok: false, text: msg });
    } finally {
      setTesting(false);
      setTimeout(() => setSaveMsg(null), 5000);
    }
  };

  if (!loaded) return null;

  const urlPlaceholder = providerInfo.defaultURL ? `默认：${providerInfo.defaultURL}` : '请输入 Base URL';
  const modelPlaceholder = providerInfo.defaultModel ? `默认：${providerInfo.defaultModel}` : '请输入模型名';

  return (
    <div>
      <p className="text-sm text-gray-400 mb-4">
        用于混合检索模式的语义向量化。推荐使用 Ollama 本地运行，无需 API Key，完全免费。
        <br />
        Ollama 安装后执行：<code className="bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 rounded text-xs font-mono">ollama pull nomic-embed-text</code>
      </p>

      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4 dk-card dk-border">
        {/* Provider */}
        <div>
          <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">Embedding 提供商</label>
          <select
            value={provider}
            onChange={e => setProvider(e.target.value as EmbeddingProviderValue)}
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#07c160] bg-[#f8f9fb] dk-input"
          >
            {EMBEDDING_PROVIDERS.map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        {/* API Key（Ollama 不需要） */}
        {providerInfo.needsKey && (
          <div>
            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">API Key</label>
            <input
              type="password"
              value={apiKey === '__HAS_KEY__' ? '' : apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder={apiKey === '__HAS_KEY__' ? '●●●●●● 已保存（留空保留）' : '请输入 API Key'}
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#07c160] bg-[#f8f9fb] font-mono dk-input"
            />
          </div>
        )}

        {/* Base URL */}
        <div>
          <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
            Base URL <span className="text-gray-400 font-normal normal-case">（留空使用默认）</span>
          </label>
          <input
            type="text"
            value={baseURL}
            onChange={e => setBaseURL(e.target.value)}
            placeholder={urlPlaceholder}
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#07c160] bg-[#f8f9fb] font-mono dk-input"
          />
          {provider === 'ollama' && (
            <p className="text-[10px] text-gray-400 mt-1">
              Docker 容器内访问宿主机 Ollama 请填：
              <code
                className="ml-1 bg-gray-100 dark:bg-white/10 px-1 rounded font-mono cursor-pointer hover:bg-gray-200 dark:hover:bg-white/15 transition-colors"
                onClick={() => setBaseURL('http://host.docker.internal:11434')}
              >
                http://host.docker.internal:11434
              </code>
              <span className="ml-1 opacity-60">（点击填入）</span>
            </p>
          )}
        </div>

        {/* Model */}
        <div>
          <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
            模型 <span className="text-gray-400 font-normal normal-case">（留空使用默认）</span>
          </label>
          <input
            type="text"
            value={model}
            onChange={e => setModel(e.target.value)}
            placeholder={modelPlaceholder}
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#07c160] bg-[#f8f9fb] font-mono dk-input"
          />
        </div>

        {/* 向量缓存设置 */}
        <div>
          <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
            向量缓存联系人数 <span className="text-gray-400 font-normal normal-case">（内存中最多缓存几个联系人的 Embedding，默认 3）</span>
          </label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={1}
              max={50}
              value={cacheMaxKeys}
              onChange={e => setCacheMaxKeys(Math.max(1, Math.min(50, parseInt(e.target.value) || 3)))}
              className="w-24 text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#07c160] bg-[#f8f9fb] dk-input"
            />
            <span className="text-xs text-gray-400 leading-relaxed">
              每个联系人约占 <span className="font-semibold">消息数 × 768维 × 4B</span>（nomic-embed-text），20万条约 600MB。内存充裕可适当调大。
            </span>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-5 py-2.5 bg-[#07c160] text-white text-sm font-bold rounded-xl hover:bg-[#06ad56] disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            保存
          </button>
          <button
            onClick={handleTest}
            disabled={testing || saving}
            className="flex items-center gap-1.5 px-4 py-2.5 border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 text-sm font-bold rounded-xl hover:border-[#07c160] hover:text-[#07c160] disabled:opacity-50 transition-colors"
          >
            {testing ? <Loader2 size={14} className="animate-spin" /> : <AlertCircle size={14} />}
            测试连接
          </button>
          {saveMsg && (
            <span className={`text-sm font-semibold ${saveMsg.ok ? 'text-[#07c160]' : 'text-red-500'}`}>
              {saveMsg.ok ? '✓ ' : '✕ '}{saveMsg.text}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── 记忆提炼模型配置 ─────────────────────────────────────────────────────────

const MemLLMSettingsSection: React.FC = () => {
  const [baseURL, setBaseURL] = useState('');
  const [model, setModel] = useState('');
  const [mainProvider, setMainProvider] = useState('deepseek');
  const [mainModel, setMainModel] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const otherPrefsRef = React.useRef<Record<string, unknown>>({});

  useEffect(() => {
    axios.get<Record<string, unknown>>('/api/preferences').then(r => {
      setBaseURL((r.data.mem_llm_base_url as string) ?? '');
      setModel((r.data.mem_llm_model as string) ?? '');
      setMainProvider((r.data.llm_provider as string) ?? 'deepseek');
      setMainModel((r.data.llm_model as string) ?? '');
      // 保存其他字段，防止保存时覆盖
      const { mem_llm_base_url: _a, mem_llm_model: _b, ...rest } = r.data;
      otherPrefsRef.current = rest;
    }).catch(() => {}).finally(() => setLoaded(true));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      await axios.put('/api/preferences/llm', {
        ...otherPrefsRef.current,
        mem_llm_base_url: baseURL,
        mem_llm_model: model,
      });
      setSaveMsg({ ok: true, text: '已保存' });
    } catch {
      setSaveMsg({ ok: false, text: '保存失败' });
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(null), 3000);
    }
  };

  const handleMemTest = async () => {
    setTesting(true);
    setSaveMsg(null);
    try {
      await axios.put('/api/preferences/llm', {
        ...otherPrefsRef.current,
        mem_llm_base_url: baseURL,
        mem_llm_model: model,
      });
      const r = await axios.post<{ ok: boolean; provider: string; model: string }>('/api/ai/mem/test');
      setSaveMsg({ ok: true, text: `连接成功（${r.data.provider} · ${r.data.model}）` });
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? '连接失败';
      setSaveMsg({ ok: false, text: msg });
    } finally {
      setTesting(false);
      setTimeout(() => setSaveMsg(null), 5000);
    }
  };

  if (!loaded) return null;

  const isUsingMain = baseURL === '' && model === '';
  const mainProvInfo = PROVIDERS.find(p => p.value === mainProvider);
  const effectiveProviderLabel = isUsingMain
    ? (mainProvInfo?.label ?? mainProvider)
    : 'Ollama（本地）';
  const effectiveModelName = isUsingMain
    ? (mainModel || mainProvInfo?.defaultModel || '未知')
    : (model || 'qwen2.5:7b');

  return (
    <div>
      <p className="text-sm text-gray-400 mb-3">
        提炼记忆事实时使用的模型。<strong className="text-gray-600 dark:text-gray-300">两个字段均留空 = 复用上方主 AI 配置</strong>；
        填写后使用本地 Ollama 模型，原始聊天内容不经过云端，更安全可靠。
      </p>
      {/* 安全提示 */}
      <div className="mb-4 flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/30 text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
        <AlertCircle size={13} className="flex-shrink-0 mt-0.5 text-amber-500" />
        <span>
          <strong>推荐使用本地 Ollama 模型进行提炼</strong>（如 <code className="bg-amber-100 dark:bg-amber-500/20 px-1 rounded">qwen2.5:7b</code>）——
          提炼时会读取大量原始聊天记录，本地模型可确保数据不离开本机。
          云端大模型同样可用，但内容会上传至第三方服务器。
        </span>
      </div>
      {/* 当前生效配置 */}
      <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-xl bg-[#f0f9f4] dark:bg-[#07c160]/10 border border-[#c3e6d0] dark:border-[#07c160]/20 text-xs">
        <span className="text-gray-400">当前将使用：</span>
        <span className="font-semibold text-[#07c160]">{effectiveProviderLabel}</span>
        <span className="text-gray-300 dark:text-gray-600">·</span>
        <code className="text-gray-600 dark:text-gray-300 bg-white dk-card px-1.5 py-0.5 rounded border border-gray-100 dk-border">{effectiveModelName}</code>
        {isUsingMain && <span className="ml-1 text-gray-400">（与主 AI 相同）</span>}
      </div>
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Base URL</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={baseURL}
              onChange={e => setBaseURL(e.target.value)}
              placeholder="留空则使用主 AI 配置"
              className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#07c160]/20 focus:border-[#07c160] transition-all dk-input"
            />
            <button
              onClick={() => setBaseURL('http://host.docker.internal:11434/v1')}
              className="text-xs text-gray-400 hover:text-[#07c160] underline whitespace-nowrap transition-colors"
              title="Docker 容器内访问宿主机 Ollama"
            >
              Docker 地址
            </button>
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">模型</label>
          <input
            type="text"
            value={model}
            onChange={e => setModel(e.target.value)}
            placeholder="留空则使用主 AI 配置"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#07c160]/20 focus:border-[#07c160] transition-all dk-input"
          />
        </div>
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-5 py-2.5 bg-[#07c160] text-white text-sm font-bold rounded-xl hover:bg-[#06ad56] disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            保存
          </button>
          <button
            onClick={handleMemTest}
            disabled={testing || saving}
            className="flex items-center gap-1.5 px-4 py-2.5 border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 text-sm font-bold rounded-xl hover:border-[#07c160] hover:text-[#07c160] disabled:opacity-50 transition-colors"
          >
            {testing ? <Loader2 size={14} className="animate-spin" /> : <AlertCircle size={14} />}
            测试连接
          </button>
          {saveMsg && (
            <span className={`text-sm font-semibold ${saveMsg.ok ? 'text-[#07c160]' : 'text-red-500'}`}>
              {saveMsg.ok ? '✓ ' : '✕ '}{saveMsg.text}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── AI 配置分组（Tab 切换三个子区块）────────────────────────────────────────

type AITab = 'llm' | 'embedding' | 'memory';

const AIConfigGroup: React.FC = () => {
  const [tab, setTab] = useState<AITab>('llm');

  const tabs: { key: AITab; label: string }[] = [
    { key: 'llm',       label: '分析模型' },
    { key: 'embedding', label: '向量 Embedding' },
    { key: 'memory',    label: '记忆提炼' },
  ];

  return (
    <section className="mb-8">
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
        <AISettingsSection />
      </div>
      <div className={tab === 'embedding' ? '' : 'hidden'}>
        <EmbeddingSettingsSection />
      </div>
      <div className={tab === 'memory' ? '' : 'hidden'}>
        <MemLLMSettingsSection />
      </div>
    </section>
  );
};

// ─── Prompt 模板编辑 ──────────────────────────────────────────────────────────

const PromptTemplateSection: React.FC = () => {
  const [templates, setTemplates] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/preferences').then(r => r.json()).then(d => {
      setTemplates(d?.prompt_templates ?? {});
    }).catch(() => {});
  }, []);

  const handleSave = async (id: string, value: string) => {
    setSaving(true);
    const next = { ...templates };
    if (value.trim()) {
      next[id] = value.trim();
    } else {
      delete next[id]; // 清空则恢复默认
    }
    try {
      await fetch('/api/preferences/prompts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt_templates: next }),
      });
      setTemplates(next);
      setEditingId(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
    finally { setSaving(false); }
  };

  return (
    <section className="mb-8 bg-white rounded-3xl border border-gray-100 p-6 sm:p-8 dk-card dk-border" data-settings-tags="prompt 模板 提示词 AI 自定义">
      <h2 className="text-lg font-black text-[#1d1d1f] dk-text mb-1 flex items-center gap-2">
        <Bot size={18} className="text-gray-400" />
        Prompt 模板
      </h2>
      <p className="text-xs text-gray-400 mb-4">自定义各 AI 功能的系统提示词。留空则使用默认值。</p>

      <div className="space-y-3">
        {PROMPT_TEMPLATES.map(t => {
          const isEditing = editingId === t.id;
          const hasCustom = !!templates[t.id];
          return (
            <div key={t.id} className="border border-gray-100 dark:border-white/10 rounded-xl p-3">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold dk-text">{t.name}</span>
                  {hasCustom && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-500 font-bold">已自定义</span>}
                </div>
                <button
                  onClick={() => {
                    if (isEditing) { setEditingId(null); }
                    else { setEditingId(t.id); setEditValue(templates[t.id] ?? t.defaultPrompt); }
                  }}
                  className="text-[10px] text-gray-400 hover:text-[#07c160] transition-colors"
                >
                  {isEditing ? '收起' : hasCustom ? '编辑' : '自定义'}
                </button>
              </div>
              <p className="text-[10px] text-gray-400">{t.description}</p>
              {isEditing && (
                <div className="mt-2 space-y-2">
                  <textarea
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    rows={8}
                    className="w-full text-xs font-mono bg-gray-50 dark:bg-white/5 rounded-lg p-3 outline-none focus:ring-2 focus:ring-[#07c160]/30 dk-text resize-y leading-relaxed"
                    placeholder="留空则恢复默认 Prompt"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSave(t.id, editValue)}
                      disabled={saving}
                      className="px-3 py-1 bg-[#07c160] text-white text-xs font-bold rounded-lg hover:bg-[#06ad56] disabled:opacity-50 transition-colors"
                    >
                      {saving ? '保存中...' : '保存'}
                    </button>
                    {hasCustom && (
                      <button
                        onClick={() => { setEditValue(t.defaultPrompt); handleSave(t.id, ''); }}
                        className="px-3 py-1 text-xs text-gray-400 hover:text-red-400 transition-colors"
                      >
                        恢复默认
                      </button>
                    )}
                    <span className="text-[10px] text-gray-300">支持变量：{'{{name}}'} {'{{today}}'} {'{{rounds}}'} 等</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {saved && <p className="text-xs text-[#07c160] mt-2">✓ 已保存</p>}
    </section>
  );
};

// ─── 主设置页 ─────────────────────────────────────────────────────────────────

interface SettingsPageProps {
  isAppMode: boolean;
  appVersion?: string;
  blockedUsers: string[];
  blockedGroups: string[];
  onAddBlockedUser: (v: string) => void;
  onRemoveBlockedUser: (v: string) => void;
  onAddBlockedGroup: (v: string) => void;
  onRemoveBlockedGroup: (v: string) => void;
  allContacts?: ContactStats[];
  allGroups?: GroupInfo[];
  privacyMode?: boolean;
  onTogglePrivacyMode?: (v: boolean) => void;
  dark?: boolean;
  onToggleDark?: () => void;
  fontSize?: number;
  onFontSizeChange?: (size: number) => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  isAppMode,
  appVersion,
  blockedUsers,
  blockedGroups,
  onAddBlockedUser,
  onRemoveBlockedUser,
  onAddBlockedGroup,
  onRemoveBlockedGroup,
  allContacts = [],
  allGroups = [],
  privacyMode = false,
  onTogglePrivacyMode,
  dark = false,
  onToggleDark,
  fontSize = 16,
  onFontSizeChange,
}) => {
  const toast = useToast();
  // Settings 页内搜索
  const [settingsQuery, setSettingsQuery] = useState('');
  const settingsRootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = settingsRootRef.current;
    if (!root) return;
    const q = settingsQuery.trim().toLowerCase();
    const sections = root.querySelectorAll<HTMLElement>('[data-settings-tags]');
    sections.forEach(s => {
      const tags = (s.dataset.settingsTags || '').toLowerCase();
      // 不光搜 tags，也搜 section 内部的文本（隐私屏蔽里的姓名字段除外）
      const text = tags + ' ' + (s.textContent || '').toLowerCase();
      s.style.display = !q || text.includes(q) ? '' : 'none';
    });
  }, [settingsQuery]);

  // 显示设置
  const [rankLimit, setRankLimit] = useState<number>(() =>
    Number(localStorage.getItem(MEMBER_RANK_LIMIT_KEY)) || DEFAULT_RANK_LIMIT
  );
  const [nameWidth, setNameWidth] = useState<number>(() =>
    Number(localStorage.getItem(MEMBER_NAME_WIDTH_KEY)) || DEFAULT_NAME_WIDTH
  );

  // App 配置状态
  const [dataDir, setDataDir] = useState('');
  const [logDir, setLogDir] = useState('');
  const [downloadDir, setDownloadDir] = useState('');
  const [downloadDirEffective, setDownloadDirEffective] = useState('');

  // 数据目录 profile（多账号）
  type Profile = { id: string; name: string; path: string; last_indexed_at?: number };
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeDir, setActiveDir] = useState('');
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const refreshProfiles = useCallback(async () => {
    try {
      const r = await appApi.listProfiles();
      setProfiles(r.profiles || []);
      setActiveDir(r.active_dir || '');
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { refreshProfiles(); }, [refreshProfiles]);

  // Docker / 浏览器模式：name + path 两个字段都让用户填
  const addProfileManual = async () => {
    const name = prompt('给数据目录起个名字（如 "主号"、"老婆账号"）');
    if (!name?.trim()) return;
    const defaultPath = dataDir.trim() || activeDir;
    const path = prompt('decrypted/ 目录的绝对路径', defaultPath);
    if (!path?.trim()) return;
    const next = [...profiles, { name: name.trim(), path: path.trim() }];
    try {
      const r = await appApi.saveProfiles(next);
      setProfiles(r.profiles);
      setProfileMsg({ ok: true, text: '已添加' });
    } catch (e: unknown) {
      const anyE = e as { response?: { data?: { error?: string } } };
      setProfileMsg({ ok: false, text: anyE?.response?.data?.error || '添加失败' });
    }
  };
  const removeProfile = async (id: string) => {
    if (!confirm('确定移除这个数据目录？只是从列表里删除，磁盘文件不会动。')) return;
    const next = profiles.filter(p => p.id !== id);
    try {
      const r = await appApi.saveProfiles(next);
      setProfiles(r.profiles);
    } catch { /* ignore */ }
  };
  const switchToProfile = async (id: string) => {
    setSwitchingId(id);
    setProfileMsg(null);
    try {
      const r = await appApi.switchProfile(id);
      if (r.error) {
        setProfileMsg({ ok: false, text: r.error });
      } else {
        setActiveDir(r.active_dir || '');
        setDataDir(r.active_dir || '');
        setProfileMsg({ ok: true, text: '切换成功，正在重新索引…' });
        // 切换后清空 hasStarted，让用户看到 InitializingScreen 的进度
        localStorage.removeItem('welink_hasStarted');
        setTimeout(() => window.location.reload(), 800);
      }
    } catch (e: unknown) {
      const anyE = e as { response?: { data?: { error?: string } } };
      setProfileMsg({ ok: false, text: anyE?.response?.data?.error || '切换失败' });
    } finally {
      setSwitchingId(null);
    }
  };

  // 诊断
  type DiagSection = { status: 'ok' | 'warn' | 'error' | 'skipped'; message: string };
  type DiagResult = {
    generated_at: string;
    data_dir: DiagSection & { path: string; warnings?: string[] };
    index: DiagSection & { is_initialized: boolean; is_indexing: boolean; total_cached: number; last_error?: string };
    llm_profiles: (DiagSection & { name: string; provider: string; model: string; base_url?: string; has_api_key: boolean; latency_ms?: number })[];
    disk: DiagSection & { ai_analysis_db_path: string; ai_analysis_db_size: number; avatar_cache_dir: string; avatar_cache_size: number; avatar_cache_file_count: number };
  };
  const [diagRunning, setDiagRunning] = useState(false);
  const [diag, setDiag] = useState<DiagResult | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const runDiag = async () => {
    setDiagRunning(true);
    try {
      const { data } = await axios.get<DiagResult>('/api/diagnostics');
      setDiag(data);
    } catch (e: unknown) {
      const anyE = e as { message?: string };
      setDiag(null);
      toast.error('诊断失败：' + (anyE?.message || String(e)));
    } finally {
      setDiagRunning(false);
    }
  };

  const diagToMarkdown = (d: DiagResult): string => {
    const statusEmoji = (s: string) => s === 'ok' ? '✅' : s === 'warn' ? '⚠️' : s === 'skipped' ? '⏭️' : '❌';
    const lines: string[] = [];
    lines.push(`# WeLink 诊断报告`);
    lines.push(`> 生成时间：${new Date(d.generated_at).toLocaleString()}`);
    lines.push('');
    lines.push(`## ${statusEmoji(d.data_dir.status)} 数据目录`);
    lines.push(`- 状态：**${d.data_dir.message}**`);
    if (d.data_dir.path) lines.push('- 路径：`' + d.data_dir.path + '`');
    if (d.data_dir.warnings?.length) {
      lines.push('- 警告：');
      d.data_dir.warnings.forEach(w => lines.push(`  - ${w}`));
    }
    lines.push('');
    lines.push(`## ${statusEmoji(d.index.status)} 索引`);
    lines.push(`- 状态：**${d.index.message}**`);
    lines.push(`- is_initialized=${d.index.is_initialized}, is_indexing=${d.index.is_indexing}, total_cached=${d.index.total_cached}`);
    if (d.index.last_error) lines.push('- last_error：`' + d.index.last_error + '`');
    lines.push('');
    lines.push(`## LLM Profiles`);
    if (d.llm_profiles.length === 0) {
      lines.push('- 未配置任何 LLM profile');
    } else {
      d.llm_profiles.forEach(p => {
        lines.push(`- ${statusEmoji(p.status)} **${p.name}**（${p.provider} / ${p.model || '?'}）— ${p.message}`);
        if (p.base_url) lines.push('  - base_url：`' + p.base_url + '`');
        lines.push(`  - api_key：${p.has_api_key ? '已配置' : '未配置'}`);
        if (p.latency_ms) lines.push(`  - 延迟：${p.latency_ms}ms`);
      });
    }
    lines.push('');
    lines.push(`## ${statusEmoji(d.disk.status)} 磁盘`);
    lines.push(`- ${d.disk.message}`);
    lines.push('- AI 分析库：`' + d.disk.ai_analysis_db_path + '`');
    return lines.join('\n');
  };

  const copyDiagMd = async () => {
    if (!diag) return;
    try {
      await navigator.clipboard.writeText(diagToMarkdown(diag));
      toast.success('已复制诊断报告到剪贴板（Markdown 格式）');
    } catch (e: unknown) {
      toast.error('复制失败：' + (e as Error).message);
    }
  };

  // LLM 用量统计
  type UsageStats = {
    total_conversations: number;
    total_assistant_msgs: number;
    total_chars: number;
    total_tokens: number;
    total_elapsed_sec: number;
    by_provider: { provider: string; model?: string; count: number; chars: number; tokens: number; elapsed_sec: number }[];
  };
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
  const [loadingCfg, setLoadingCfg] = useState(isAppMode);
  const [bundling, setBundling] = useState(false);
  const [bundlePath, setBundlePath] = useState<string | null>(null);
  // AI 数据备份/恢复
  const [aiBackuping, setAiBackuping] = useState(false);
  const [aiBackupResult, setAiBackupResult] = useState<{ ok: boolean; text: string; path?: string } | null>(null);
  const aiRestoreInputRef = useRef<HTMLInputElement | null>(null);
  const handleAIBackup = async () => {
    setAiBackuping(true);
    setAiBackupResult(null);
    try {
      const r = await appApi.aiBackup();
      if (r.error) {
        setAiBackupResult({ ok: false, text: r.error });
      } else {
        setAiBackupResult({ ok: true, text: `已备份到 ${r.path}（${((r.size || 0) / 1024 / 1024).toFixed(2)} MB）`, path: r.path });
      }
    } catch (e: unknown) {
      const anyE = e as { response?: { data?: { error?: string } }; message?: string };
      setAiBackupResult({ ok: false, text: anyE?.response?.data?.error || anyE?.message || '备份失败' });
    } finally {
      setAiBackuping(false);
    }
  };
  const handleAIRestore = async (file: File) => {
    if (!confirm(`即将用 "${file.name}" 覆盖当前 AI 数据，原文件会自动备份为 .bak。确定继续？`)) return;
    setAiBackuping(true);
    setAiBackupResult(null);
    try {
      const r = await appApi.aiRestore(file);
      if (r.error) {
        setAiBackupResult({ ok: false, text: r.error });
      } else {
        setAiBackupResult({ ok: true, text: '恢复成功，原文件已备份为 .bak。' });
      }
    } catch (e: unknown) {
      const anyE = e as { response?: { data?: { error?: string } }; message?: string };
      setAiBackupResult({ ok: false, text: anyE?.response?.data?.error || anyE?.message || '恢复失败' });
    } finally {
      setAiBackuping(false);
    }
  };
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{
    has_update: boolean; latest: string; changelog: string; url: string;
    assets: { name: string; size: number; url: string }[];
    error?: string;
  } | null>(null);
  const [browsing, setBrowsing] = useState<'data' | 'log' | 'download' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [restarting, setRestarting] = useState(false);

  // 基本配置 + 分析参数
  const [cfgPort, setCfgPort] = useState('8080');
  const [cfgGinMode, setCfgGinMode] = useState('debug');
  const [cfgLogLevel, setCfgLogLevel] = useState('info');
  const [cfgTimezone, setCfgTimezone] = useState('Asia/Shanghai');
  const [cfgLateStart, setCfgLateStart] = useState(0);
  const [cfgLateEnd, setCfgLateEnd] = useState(5);
  const [cfgSessionGap, setCfgSessionGap] = useState(21600);
  const [cfgWorkerCount, setCfgWorkerCount] = useState(4);
  const [cfgLateMinMsg, setCfgLateMinMsg] = useState(100);
  const [cfgLateTopN, setCfgLateTopN] = useState(20);
  const [cfgLoading, setCfgLoading] = useState(true);
  const [cfgSaving, setCfgSaving] = useState(false);
  const [cfgMsg, setCfgMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    axios.get('/api/preferences').then(({ data }) => {
      if (data.port) setCfgPort(data.port);
      if (data.gin_mode) setCfgGinMode(data.gin_mode);
      if (data.log_level) setCfgLogLevel(data.log_level);
      if (data.timezone) setCfgTimezone(data.timezone);
      if (data.late_night_start_hour !== undefined) setCfgLateStart(data.late_night_start_hour);
      if (data.late_night_end_hour) setCfgLateEnd(data.late_night_end_hour);
      if (data.session_gap_seconds) setCfgSessionGap(data.session_gap_seconds);
      if (data.worker_count) setCfgWorkerCount(data.worker_count);
      if (data.late_night_min_messages) setCfgLateMinMsg(data.late_night_min_messages);
      if (data.late_night_top_n) setCfgLateTopN(data.late_night_top_n);
    }).catch(() => {}).finally(() => setCfgLoading(false));
  }, []);

  const saveConfig = async () => {
    setCfgSaving(true);
    setCfgMsg(null);
    try {
      const { data } = await axios.put('/api/preferences/config', {
        port: cfgPort,
        gin_mode: cfgGinMode,
        log_level: cfgLogLevel,
        timezone: cfgTimezone,
        late_night_start_hour: cfgLateStart,
        late_night_end_hour: cfgLateEnd,
        session_gap_seconds: cfgSessionGap,
        worker_count: cfgWorkerCount,
        late_night_min_messages: cfgLateMinMsg,
        late_night_top_n: cfgLateTopN,
      });
      if (data.needs_restart) {
        setCfgMsg({ ok: true, text: '已保存，端口或运行模式变更需要重启后生效' });
      } else {
        setCfgMsg({ ok: true, text: '已保存，分析参数已热加载生效' });
      }
    } catch {
      setCfgMsg({ ok: false, text: '保存失败，请重试' });
    } finally {
      setCfgSaving(false);
    }
  };

  useEffect(() => {
    if (!isAppMode) return;
    appApi.getConfig().then((cfg) => {
      setDataDir(cfg.data_dir || '');
      setLogDir(cfg.log_dir || '');
    }).catch(() => {}).finally(() => setLoadingCfg(false));
    // 下载目录：单独拉取（configured + effective）
    axios.get<{ configured?: string; effective?: string }>('/api/preferences/download-dir')
      .then(({ data }) => {
        setDownloadDir(data.configured || '');
        setDownloadDirEffective(data.effective || '');
      }).catch(() => {});
  }, [isAppMode]);


  const browse = useCallback(async (type: 'data' | 'log' | 'download') => {
    setBrowsing(type);
    try {
      const prompt = type === 'data' ? '选择解密后的微信数据库目录（decrypted/）'
                   : type === 'log'  ? '选择日志文件存放目录'
                   :                   '选择导出图片/文件的保存目录';
      const path = await appApi.browse(prompt);
      if (type === 'data') setDataDir(path);
      else if (type === 'log') setLogDir(path);
      else setDownloadDir(path);
    } catch {
      // 用户取消，忽略
    } finally {
      setBrowsing(null);
    }
  }, []);

  const handleRestart = async () => {
    setError('');
    setSubmitting(true);
    try {
      // 下载目录不需要重启，先独立保存 + 校验；校验失败直接中止，不要带着坏配置重启
      try {
        await axios.put('/api/preferences/download-dir', { download_dir: downloadDir.trim() });
      } catch (e: unknown) {
        const anyE = e as { response?: { data?: { error?: string } } };
        const detail = anyE?.response?.data?.error || '下载目录无效';
        setError('下载目录保存失败：' + detail);
        setSubmitting(false);
        return;
      }
      await appApi.restart(dataDir.trim(), logDir.trim());
      setRestarting(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError('保存失败：' + msg);
      setSubmitting(false);
    }
  };

  // label 解析
  const userLabelFor = (id: string): string => {
    const c = allContacts.find((c) => c.username === id || c.nickname === id || c.remark === id);
    return c ? (c.remark || c.nickname || id) : id;
  };
  const groupLabelFor = (id: string): string => {
    const g = allGroups.find((g) => g.username === id || g.name === id);
    return g ? g.name : id;
  };

  // 关系预测「不再推荐此人」名单
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

  if (restarting) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 text-gray-500 dark:text-gray-400">
        <CheckCircle2 size={40} className="text-[#07c160]" />
        <p className="font-semibold text-[#1d1d1f] dk-text">配置已保存，应用正在重启…</p>
        <p className="text-sm text-gray-400">稍后新窗口会自动打开</p>
      </div>
    );
  }

  const jumpToSection = (keyword: string) => {
    const el = settingsRootRef.current?.querySelector<HTMLElement>(`[data-settings-tags*="${keyword}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const SECTION_JUMPS = [
    { title: '录屏',       kw: '录屏' },
    { title: '显示',       kw: '显示 暗色' },
    { title: '基本配置',   kw: '基本 配置' },
    { title: '隐私屏蔽',   kw: 'blocked' },
    { title: '关系预测',   kw: 'forecast 忽略' },
    { title: '多账号',     kw: '多账号' },
    { title: 'AI 备份',    kw: 'backup' },
    { title: 'LLM 用量',   kw: 'LLM 用量' },
    { title: 'Prompt 模板',kw: 'prompt 模板' },
    { title: '诊断',       kw: '诊断' },
    { title: '应用配置',   kw: '应用配置' },
    { title: '关于',       kw: '关于' },
  ];

  // IntersectionObserver 检测当前视口内的 section，用于高亮左栏活跃项
  const [activeJumpKw, setActiveJumpKw] = useState<string>('');
  useEffect(() => {
    const root = settingsRootRef.current;
    if (!root) return;
    // 按 kw 找到对应的 section element
    const sectionEls: { kw: string; el: HTMLElement }[] = [];
    for (const s of SECTION_JUMPS) {
      const el = root.querySelector<HTMLElement>(`[data-settings-tags*="${s.kw}"]`);
      if (el) sectionEls.push({ kw: s.kw, el });
    }
    if (sectionEls.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        // 取最靠上的正在相交的 section
        const visible = entries
          .filter(e => e.isIntersecting)
          .map(e => ({ kw: sectionEls.find(s => s.el === e.target)?.kw ?? '', y: (e.target as HTMLElement).offsetTop }))
          .filter(x => x.kw !== '')
          .sort((a, b) => a.y - b.y);
        if (visible.length > 0) setActiveJumpKw(visible[0].kw);
      },
      { rootMargin: '-20% 0px -60% 0px', threshold: 0 }
    );
    sectionEls.forEach(s => io.observe(s.el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="lg:flex lg:gap-6" ref={settingsRootRef}>
      {/* 左栏导航（lg+ sticky 左侧）*/}
      <aside className="hidden lg:block w-44 flex-shrink-0 sticky top-0 self-start pt-2 pb-6 max-h-[calc(100vh-2rem)] overflow-y-auto">
        <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2 px-2">设置目录</div>
        <nav className="flex flex-col gap-0.5">
          {SECTION_JUMPS.map(s => {
            const active = activeJumpKw === s.kw;
            return (
              <button
                key={s.kw}
                onClick={() => jumpToSection(s.kw)}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-left transition-colors ${
                  active
                    ? 'bg-[#07c160]/10 text-[#07c160]'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-700 dk-text'
                }`}
              >
                <span className={`w-1 h-4 rounded-full transition-colors ${active ? 'bg-[#07c160]' : 'bg-transparent'}`} />
                {s.title}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* 主内容区 */}
      <div className="max-w-2xl flex-1 min-w-0">
        <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
          <h2 className="text-2xl font-black text-[#1d1d1f] dk-text">设置</h2>
          <div className="relative flex-1 max-w-xs">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" strokeLinecap="round" />
            </svg>
            <input
              value={settingsQuery}
              onChange={e => setSettingsQuery(e.target.value)}
              placeholder="搜索设置项…（例：下载 / 诊断 / LLM）"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-[#f8f9fb] dk-input focus:outline-none focus:border-[#07c160]"
            />
          </div>
        </div>

        {/* 小屏兼容：横向快速跳转栏（sticky，lg+ 隐藏，用左栏代替） */}
        <div className="lg:hidden sticky top-0 z-10 bg-white dark:bg-[#1c1c1e] -mx-2 px-2 py-2 mb-6 border-b border-gray-100 dark:border-white/5 overflow-x-auto whitespace-nowrap">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-bold text-gray-400 flex-shrink-0">快速跳转</span>
            {SECTION_JUMPS.map(s => (
              <button
                key={s.kw}
                onClick={() => jumpToSection(s.kw)}
                className="flex-shrink-0 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-gray-400 hover:bg-[#07c160]/10 hover:text-[#07c160] transition-colors"
              >
                {s.title}
              </button>
            ))}
          </div>
        </div>

      {/* ── 录屏模式 ── */}
      <section className="mb-8" data-settings-tags="隐私 录屏 privacy 屏蔽马赛克">
        <div className="flex items-center gap-2 mb-3">
          <EyeOff size={18} className="text-[#07c160]" />
          <h3 className="text-base font-bold text-[#1d1d1f] dk-text">录屏模式</h3>
        </div>
        <p className="text-sm text-gray-400 mb-4">开启后，所有联系人姓名、群名及词云内容将模糊显示，适合录制演示视频时保护隐私。<span className="text-amber-500 font-medium">注意：AI 首页的分析对象名字也会模糊，请选择好分析对象再开启。</span></p>
        <div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center justify-between dk-card dk-border">
          <div>
            <p className="text-sm font-semibold text-[#1d1d1f] dk-text">模糊姓名与词云</p>
            <p className="text-xs text-gray-400 mt-0.5">页面刷新后仍保持此设置</p>
          </div>
          <button
            onClick={() => onTogglePrivacyMode?.(!privacyMode)}
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${privacyMode ? 'bg-[#07c160]' : 'bg-gray-200 dark:bg-white/15'}`}
          >
            <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${privacyMode ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
      </section>

      {/* ── 显示设置 ── */}
      <section className="mb-8" data-settings-tags="显示 暗色 主题 字号 group 群成员 宽度 name 暗黑">
        <div className="flex items-center gap-2 mb-3">
          <BarChart2 size={18} className="text-[#07c160]" />
          <h3 className="text-base font-bold text-[#1d1d1f] dk-text">显示设置</h3>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-5 dk-card dk-border">
          {onToggleDark && (
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-[#1d1d1f] dk-text">暗色模式</p>
                <p className="text-xs text-gray-400 mt-0.5">切换界面深色 / 浅色主题</p>
              </div>
              <button
                type="button"
                onClick={onToggleDark}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${dark ? 'bg-[#07c160]' : 'bg-gray-200 dark:bg-white/20'}`}
              >
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${dark ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
              </button>
            </div>
          )}
          {/* 字号调节 */}
          {onFontSizeChange && (
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-[#1d1d1f] dk-text">字号大小</p>
                <p className="text-xs text-gray-400 mt-0.5">调整全局文字大小（默认 16px）</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-6 text-right">{fontSize}</span>
                <input
                  type="range"
                  min={12}
                  max={22}
                  step={1}
                  value={fontSize}
                  onChange={e => onFontSizeChange(Number(e.target.value))}
                  className="w-28 accent-[#07c160]"
                />
                <div className="flex gap-1">
                  {[14, 16, 18, 20].map(s => (
                    <button
                      key={s}
                      onClick={() => onFontSizeChange(s)}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-all ${
                        fontSize === s ? 'bg-[#07c160] text-white' : 'bg-gray-100 dark:bg-white/10 text-gray-400 hover:bg-gray-200'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-[#1d1d1f] dk-text">群聊发言排行显示人数</p>
              <p className="text-xs text-gray-400 mt-0.5">默认展示 Top N，最多支持 500（实时生效）</p>
            </div>
            <input
              type="number"
              min={1}
              max={500}
              value={rankLimit}
              onChange={(e) => {
                const v = Math.min(500, Math.max(1, Number(e.target.value) || DEFAULT_RANK_LIMIT));
                setRankLimit(v);
                localStorage.setItem(MEMBER_RANK_LIMIT_KEY, String(v));
              }}
              className="w-20 text-sm border border-gray-200 rounded-xl px-3 py-1.5 text-center focus:outline-none focus:border-[#07c160] dk-input"
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-[#1d1d1f] dk-text">发言排行名字列宽度</p>
              <p className="text-xs text-gray-400 mt-0.5">单位 px，也可在排行图表中直接拖拽调整（实时生效）</p>
            </div>
            <input
              type="number"
              min={60}
              max={400}
              value={nameWidth}
              onChange={(e) => {
                const v = Math.min(400, Math.max(60, Number(e.target.value) || DEFAULT_NAME_WIDTH));
                setNameWidth(v);
                localStorage.setItem(MEMBER_NAME_WIDTH_KEY, String(v));
              }}
              className="w-20 text-sm border border-gray-200 rounded-xl px-3 py-1.5 text-center focus:outline-none focus:border-[#07c160] dk-input"
            />
          </div>
        </div>
      </section>

      {/* ── 基本配置 + 分析参数 ── */}
      <section className="mb-8" data-settings-tags="基本 配置 端口 port 时区 深夜 worker 工作协程 gin 日志级别 port">
        <div className="flex items-center gap-2 mb-3">
          <Settings size={18} className="text-[#07c160]" />
          <h3 className="text-base font-bold text-[#1d1d1f] dk-text">服务配置</h3>
        </div>
        <p className="text-sm text-gray-400 mb-4">基本运行参数与分析参数。分析参数保存后立即热加载，端口和运行模式变更需重启。</p>

        {cfgLoading ? (
          <div className="flex items-center justify-center h-32 text-gray-400">
            <Loader2 size={24} className="animate-spin" />
          </div>
        ) : (
          <>
            {/* 基本配置 */}
            <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4 mb-4 dk-card dk-border">
              <h4 className="text-sm font-bold text-[#1d1d1f] dk-text flex items-center gap-1.5">
                <Cpu size={14} className="text-[#07c160]" />
                基本配置
                <span className="text-xs text-amber-500 font-medium ml-1">修改后需重启</span>
              </h4>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[#1d1d1f] dk-text">端口</p>
                  <p className="text-xs text-gray-400 mt-0.5">服务监听端口，默认 8080</p>
                </div>
                <input
                  type="text"
                  value={cfgPort}
                  onChange={(e) => setCfgPort(e.target.value.replace(/\D/g, ''))}
                  className="w-24 text-sm border border-gray-200 rounded-xl px-3 py-1.5 text-center focus:outline-none focus:border-[#07c160] dk-input"
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[#1d1d1f] dk-text">运行模式</p>
                  <p className="text-xs text-gray-400 mt-0.5">release 模式隐藏 Gin 调试日志</p>
                </div>
                <select
                  value={cfgGinMode}
                  onChange={(e) => setCfgGinMode(e.target.value)}
                  className="w-28 text-sm border border-gray-200 rounded-xl px-3 py-1.5 focus:outline-none focus:border-[#07c160] dk-input bg-white dark:bg-transparent"
                >
                  <option value="debug">debug</option>
                  <option value="release">release</option>
                </select>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[#1d1d1f] dk-text">日志等级</p>
                  <p className="text-xs text-gray-400 mt-0.5">控制日志输出详细程度</p>
                </div>
                <select
                  value={cfgLogLevel}
                  onChange={(e) => setCfgLogLevel(e.target.value)}
                  className="w-28 text-sm border border-gray-200 rounded-xl px-3 py-1.5 focus:outline-none focus:border-[#07c160] dk-input bg-white dark:bg-transparent"
                >
                  <option value="debug">debug</option>
                  <option value="info">info</option>
                  <option value="warn">warn</option>
                  <option value="error">error</option>
                </select>
              </div>
            </div>

            {/* 分析参数 */}
            <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4 mb-4 dk-card dk-border">
              <h4 className="text-sm font-bold text-[#1d1d1f] dk-text flex items-center gap-1.5">
                <Clock size={14} className="text-[#07c160]" />
                分析参数
                <span className="text-xs text-green-600 font-medium ml-1">保存后立即生效</span>
              </h4>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[#1d1d1f] dk-text">时区</p>
                  <p className="text-xs text-gray-400 mt-0.5">用于消息时间的时区转换</p>
                </div>
                <select
                  value={cfgTimezone}
                  onChange={(e) => setCfgTimezone(e.target.value)}
                  className="w-48 text-sm border border-gray-200 rounded-xl px-3 py-1.5 focus:outline-none focus:border-[#07c160] dk-input bg-white dark:bg-gray-800"
                >
                  {[
                    'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Taipei', 'Asia/Tokyo',
                    'Asia/Seoul', 'Asia/Singapore', 'Asia/Kolkata', 'Asia/Dubai',
                    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow',
                    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
                    'America/Sao_Paulo', 'Australia/Sydney', 'Pacific/Auckland', 'UTC',
                  ].map(tz => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[#1d1d1f] dk-text">深夜时段</p>
                  <p className="text-xs text-gray-400 mt-0.5">起止小时（0–23），用于深夜聊天统计</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={cfgLateStart}
                    onChange={(e) => setCfgLateStart(Math.min(23, Math.max(0, Number(e.target.value) || 0)))}
                    className="w-16 text-sm border border-gray-200 rounded-xl px-2 py-1.5 text-center focus:outline-none focus:border-[#07c160] dk-input"
                  />
                  <span className="text-gray-400 text-sm">–</span>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={cfgLateEnd}
                    onChange={(e) => setCfgLateEnd(Math.min(23, Math.max(0, Number(e.target.value) || 0)))}
                    className="w-16 text-sm border border-gray-200 rounded-xl px-2 py-1.5 text-center focus:outline-none focus:border-[#07c160] dk-input"
                  />
                  <span className="text-xs text-gray-400">时</span>
                </div>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[#1d1d1f] dk-text">会话间隔</p>
                  <p className="text-xs text-gray-400 mt-0.5">超过此秒数视为新会话（默认 21600 = 6 小时）</p>
                </div>
                <input
                  type="number"
                  min={60}
                  max={86400}
                  value={cfgSessionGap}
                  onChange={(e) => setCfgSessionGap(Number(e.target.value) || 21600)}
                  className="w-24 text-sm border border-gray-200 rounded-xl px-3 py-1.5 text-center focus:outline-none focus:border-[#07c160] dk-input"
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[#1d1d1f] dk-text">并发 Worker 数</p>
                  <p className="text-xs text-gray-400 mt-0.5">联系人分析并行线程数</p>
                </div>
                <input
                  type="number"
                  min={1}
                  max={32}
                  value={cfgWorkerCount}
                  onChange={(e) => setCfgWorkerCount(Math.min(32, Math.max(1, Number(e.target.value) || 4)))}
                  className="w-20 text-sm border border-gray-200 rounded-xl px-3 py-1.5 text-center focus:outline-none focus:border-[#07c160] dk-input"
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[#1d1d1f] dk-text">深夜最少消息数</p>
                  <p className="text-xs text-gray-400 mt-0.5">消息少于此数的联系人不参与深夜统计</p>
                </div>
                <input
                  type="number"
                  min={1}
                  max={10000}
                  value={cfgLateMinMsg}
                  onChange={(e) => setCfgLateMinMsg(Number(e.target.value) || 100)}
                  className="w-24 text-sm border border-gray-200 rounded-xl px-3 py-1.5 text-center focus:outline-none focus:border-[#07c160] dk-input"
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[#1d1d1f] dk-text">深夜排行 Top N</p>
                  <p className="text-xs text-gray-400 mt-0.5">深夜聊天排行榜显示人数</p>
                </div>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={cfgLateTopN}
                  onChange={(e) => setCfgLateTopN(Math.min(100, Math.max(1, Number(e.target.value) || 20)))}
                  className="w-20 text-sm border border-gray-200 rounded-xl px-3 py-1.5 text-center focus:outline-none focus:border-[#07c160] dk-input"
                />
              </div>
            </div>

            {/* 保存按钮 + 状态提示 */}
            {cfgMsg && (
              <div className={`mb-3 flex items-start gap-2 rounded-2xl px-4 py-3 border ${cfgMsg.ok ? 'bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/30' : 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30'}`}>
                {cfgMsg.ok ? <CheckCircle2 size={16} className="text-green-500 flex-shrink-0 mt-0.5" /> : <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />}
                <p className={`text-sm ${cfgMsg.ok ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>{cfgMsg.text}</p>
              </div>
            )}
            <button
              onClick={saveConfig}
              disabled={cfgSaving}
              className="w-full bg-[#07c160] hover:bg-[#06ad56] disabled:opacity-50 text-white font-bold text-sm py-3 rounded-2xl flex items-center justify-center gap-2 transition-colors mb-4"
            >
              {cfgSaving ? (
                <><Loader2 size={16} className="animate-spin" /> 保存中…</>
              ) : (
                <><Save size={16} /> 保存配置</>
              )}
            </button>
          </>
        )}
      </section>

      {/* ── AI 配置（分析模型 / Embedding / 记忆提炼） ── */}
      <AIConfigGroup />

      {/* ── 隐私屏蔽 ── */}
      <section className="mb-8" data-settings-tags="隐私 屏蔽 blocked 黑名单 mask privacy">
        <div className="flex items-center gap-2 mb-3">
          <ShieldOff size={18} className="text-[#07c160]" />
          <h3 className="text-base font-bold text-[#1d1d1f] dk-text">隐私屏蔽</h3>
        </div>
        <p className="text-sm text-gray-400 mb-4">被屏蔽的联系人和群聊将从所有列表中隐藏，数据仍保留在数据库中。</p>

        <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-4 dk-card dk-border">
          <div className="flex items-center gap-2 mb-4">
            <User size={16} className="text-[#07c160]" />
            <h4 className="font-bold text-[#1d1d1f] dk-text">屏蔽联系人</h4>
            {blockedUsers.length > 0 && (
              <>
                <span className="ml-auto text-xs font-bold px-2.5 py-1 rounded-full bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400">
                  {blockedUsers.length} 条
                </span>
                <button
                  onClick={() => {
                    if (confirm(`确定清空全部 ${blockedUsers.length} 个屏蔽联系人？`)) {
                      blockedUsers.forEach(u => onRemoveBlockedUser(u));
                    }
                  }}
                  className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                >
                  清空
                </button>
              </>
            )}
          </div>
          <TagList items={blockedUsers} onRemove={onRemoveBlockedUser} emptyText="暂无屏蔽联系人" labelFor={userLabelFor} privacyMode={privacyMode} />
          <AddInput placeholder="输入微信ID、昵称或备注名，按回车添加" onAdd={onAddBlockedUser} />
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-6 dk-card dk-border">
          <div className="flex items-center gap-2 mb-4">
            <Users size={16} className="text-[#07c160]" />
            <h4 className="font-bold text-[#1d1d1f] dk-text">屏蔽群聊</h4>
            {blockedGroups.length > 0 && (
              <>
                <span className="ml-auto text-xs font-bold px-2.5 py-1 rounded-full bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400">
                  {blockedGroups.length} 条
                </span>
                <button
                  onClick={() => {
                    if (confirm(`确定清空全部 ${blockedGroups.length} 个屏蔽群聊？`)) {
                      blockedGroups.forEach(g => onRemoveBlockedGroup(g));
                    }
                  }}
                  className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                >
                  清空
                </button>
              </>
            )}
          </div>
          <TagList items={blockedGroups} onRemove={onRemoveBlockedGroup} emptyText="暂无屏蔽群聊" labelFor={groupLabelFor} privacyMode={privacyMode} />
          <AddInput placeholder="输入群名称或群ID（以 @chatroom 结尾），按回车添加" onAdd={onAddBlockedGroup} />
        </div>
      </section>

      {/* ── 关系预测 · 忽略名单 ── */}
      <section className="mb-8" data-settings-tags="关系预测 forecast 忽略 不再推荐 冷却">
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

      {/* ── 数据目录 / 多账号（App 与 Docker 通用） ── */}
      <section className="mb-8" data-settings-tags="数据目录 多账号 profile 切换 decrypted path 目录">
        <div className="flex items-center gap-2 mb-3">
          <Users size={18} className="text-[#07c160]" />
          <h3 className="text-base font-bold text-[#1d1d1f] dk-text">数据目录 · 多账号切换</h3>
        </div>
        <p className="text-sm text-gray-400 mb-4">
          {isAppMode
            ? '把多个 decrypted/ 目录加入列表，就能在不同账号之间切换（无需重启）'
            : '把多个挂载在容器内的 decrypted 目录加入列表（要求 Docker 同时挂载它们）'}
        </p>
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 dk-card dk-border">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-[#1d1d1f] dk-text">已保存的数据目录</span>
            <button
              onClick={addProfileManual}
              className="text-xs text-[#07c160] hover:underline"
            >
              + 添加目录
            </button>
          </div>
          {profiles.length === 0 ? (
            <p className="text-xs text-gray-400 py-2">尚无 profile，点击右上角添加</p>
          ) : (
            <div className="space-y-1.5">
              {profiles.map(p => {
                const active = p.path === activeDir;
                return (
                  <div
                    key={p.id}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${
                      active
                        ? 'border-[#07c160]/40 bg-[#07c160]/5'
                        : 'border-gray-100 bg-[#f8f9fb] dk-bg-soft'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-[#1d1d1f] dk-text truncate">{p.name}</span>
                        {active && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#07c160] text-white font-bold">使用中</span>}
                      </div>
                      <div className="text-[10px] text-gray-400 font-mono truncate">{p.path}</div>
                      {p.last_indexed_at ? (
                        <div className="text-[10px] text-gray-400 mt-0.5">
                          最近索引：<RelativeTime ts={p.last_indexed_at} />
                        </div>
                      ) : null}
                    </div>
                    <button
                      onClick={() => switchToProfile(p.id)}
                      disabled={active || switchingId !== null}
                      className="text-xs text-[#07c160] hover:underline disabled:opacity-30 disabled:no-underline whitespace-nowrap"
                    >
                      {switchingId === p.id ? '切换中…' : active ? '当前' : '切换到'}
                    </button>
                    <button
                      onClick={() => removeProfile(p.id)}
                      disabled={active}
                      className="text-xs text-gray-400 hover:text-red-500 disabled:opacity-30 whitespace-nowrap"
                    >
                      移除
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {profileMsg && (
            <p className={`mt-2 text-xs ${profileMsg.ok ? 'text-[#07c160]' : 'text-red-500'}`}>{profileMsg.text}</p>
          )}
        </div>
      </section>

      {/* ── AI 数据备份 / 恢复（App 与 Docker 通用） ── */}
      <section className="mb-8" data-settings-tags="AI 备份 恢复 backup restore skills 记忆 memories 对话历史 ai_analysis">
        <div className="flex items-center gap-2 mb-3">
          <Bot size={18} className="text-[#07c160]" />
          <h3 className="text-base font-bold text-[#1d1d1f] dk-text">AI 数据备份</h3>
        </div>
        <p className="text-sm text-gray-400 mb-4">Skills、聊天历史、记忆都在 ai_analysis.db；建议定期导出</p>
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 dk-card dk-border">
          <div className="flex flex-wrap gap-2 items-center">
            <button
              onClick={() => {
                if (isAppMode) {
                  handleAIBackup();
                } else {
                  // Docker / 浏览器：直接触发流式下载
                  window.location.href = '/api/ai-backup-download';
                }
              }}
              disabled={aiBackuping}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#07c160] text-white text-sm font-semibold hover:bg-[#06ad56] disabled:opacity-50 transition-colors"
            >
              {aiBackuping ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
              {isAppMode ? '导出备份到下载目录' : '下载备份'}
            </button>
            <button
              onClick={() => aiRestoreInputRef.current?.click()}
              disabled={aiBackuping}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 text-sm font-semibold hover:bg-gray-200 dark:hover:bg-white/15 disabled:opacity-50 transition-colors"
            >
              <FolderOpen size={14} />
              从备份恢复
            </button>
            <input
              ref={aiRestoreInputRef}
              type="file"
              accept=".db,.sqlite"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleAIRestore(f);
                e.target.value = '';
              }}
            />
            <span className="text-[10px] text-gray-400 ml-auto">
              {isAppMode ? '导出会写到设置里的下载目录' : '浏览器会触发文件下载'}
            </span>
          </div>
          {aiBackupResult && (
            <p className={`mt-3 text-xs break-all ${aiBackupResult.ok ? 'text-[#07c160]' : 'text-red-500'}`}>
              {aiBackupResult.text}
              {aiBackupResult.path && isAppMode && (
                <button
                  type="button"
                  onClick={async () => { await axios.post('/api/app/reveal', { path: aiBackupResult.path }); }}
                  className="ml-2 underline hover:no-underline"
                >
                  在 Finder 中显示
                </button>
              )}
            </p>
          )}
        </div>
      </section>

      {/* ── 诊断 ── */}
      <section className="mb-8" data-diag-anchor data-settings-tags="诊断 diagnostics 健康检查 反馈 问题 feedback issue bug llm">
        <div className="flex items-center gap-2 mb-3">
          <Stethoscope size={18} className="text-[#07c160]" />
          <h3 className="text-base font-bold text-[#1d1d1f] dk-text">诊断</h3>
          <button
            onClick={() => setFeedbackOpen(true)}
            data-feedback-open
            className="ml-auto text-xs text-[#07c160] hover:underline flex items-center gap-1"
            title="带上诊断报告一起反馈问题"
          >
            反馈问题 →
          </button>
        </div>
        <p className="text-sm text-gray-400 mb-4">一键检查数据目录、索引状态、LLM 配置和磁盘占用；遇到问题可把诊断结果附到反馈</p>
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 dk-card dk-border">
          <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
            <span className="text-sm text-gray-500">
              {diag ? <>上次检查：<RelativeTime ts={Math.floor(new Date(diag.generated_at).getTime() / 1000)} /></> : '尚未运行'}
            </span>
            <div className="flex gap-2">
              {diag && (
                <button
                  onClick={copyDiagMd}
                  className="px-3 py-2 rounded-xl bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 text-sm font-semibold hover:bg-gray-200 dark:hover:bg-white/15 transition-colors flex items-center gap-1.5"
                  title="复制为 Markdown（贴到 issue / Slack 友好）"
                >
                  <Copy size={14} />
                  复制为 Markdown
                </button>
              )}
              <button
                onClick={runDiag}
                disabled={diagRunning}
                data-diag-run
                className="px-4 py-2 rounded-xl bg-[#07c160] text-white text-sm font-semibold hover:bg-[#06ad56] disabled:opacity-50 transition-colors flex items-center gap-1.5"
              >
                {diagRunning ? <><Loader2 size={14} className="animate-spin" />检查中…</> : <><RefreshCw size={14} />运行诊断</>}
              </button>
            </div>
          </div>
          {diag && (() => {
            const StatusIcon = ({ s }: { s: string }) => {
              if (s === 'ok') return <CheckCircle2 size={16} className="text-[#07c160] flex-shrink-0" />;
              if (s === 'warn') return <AlertTriangle size={16} className="text-amber-500 flex-shrink-0" />;
              if (s === 'skipped') return <AlertCircle size={16} className="text-gray-400 flex-shrink-0" />;
              return <XCircle size={16} className="text-red-500 flex-shrink-0" />;
            };
            const Row = ({ label, status, message, sub }: { label: string; status: string; message: string; sub?: React.ReactNode }) => (
              <div className="flex items-start gap-3 py-2.5 border-t border-gray-100 dk-border first:border-t-0">
                <StatusIcon s={status} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold text-[#1d1d1f] dk-text">{label}</span>
                    <span className={`text-xs ${status === 'ok' ? 'text-[#07c160]' : status === 'warn' ? 'text-amber-600' : status === 'skipped' ? 'text-gray-400' : 'text-red-500'}`}>{message}</span>
                  </div>
                  {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
                </div>
              </div>
            );
            return (
              <div>
                <Row
                  label="数据目录"
                  status={diag.data_dir.status}
                  message={diag.data_dir.message}
                  sub={
                    <>
                      {diag.data_dir.path && <div className="font-mono break-all">{diag.data_dir.path}</div>}
                      {diag.data_dir.warnings?.map((w, i) => <div key={i} className="text-amber-600">⚠ {w}</div>)}
                    </>
                  }
                />
                <Row
                  label="索引"
                  status={diag.index.status}
                  message={diag.index.message}
                  sub={diag.index.last_error && <div className="text-red-500">{diag.index.last_error}</div>}
                />
                {diag.llm_profiles.length === 0 ? (
                  <Row label="LLM" status="warn" message="未配置任何 LLM profile" />
                ) : (
                  diag.llm_profiles.map((p, i) => (
                    <Row
                      key={i}
                      label={`LLM · ${p.name}`}
                      status={p.status}
                      message={p.message}
                      sub={
                        <>
                          <div>{p.provider} / {p.model || '(未指定 model)'}</div>
                          {p.base_url && <div className="font-mono text-[10px] text-gray-400 break-all">{p.base_url}</div>}
                          {!p.has_api_key && <div className="text-amber-600">未配置 API Key</div>}
                        </>
                      }
                    />
                  ))
                )}
                <Row label="磁盘" status={diag.disk.status} message={diag.disk.message} />
              </div>
            );
          })()}
        </div>
      </section>

      {/* ── LLM 用量统计 ── */}
      <section className="mb-8" data-settings-tags="LLM 用量 token 字符 统计 usage">
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

      {/* ── App 配置（仅 App 模式） ── */}
      {isAppMode && (
        <section className="mb-8" data-settings-tags="应用配置 数据目录 日志 log 下载 download reveal finder 打包日志 更新 version">
          <div className="flex items-center gap-2 mb-3">
            <Database size={18} className="text-[#07c160]" />
            <h3 className="text-base font-bold text-[#1d1d1f] dk-text">应用配置</h3>
          </div>
          <p className="text-sm text-gray-400 mb-4">修改配置后需要重启应用生效</p>

          {loadingCfg ? (
            <div className="flex items-center justify-center h-32 text-gray-400">
              <Loader2 size={24} className="animate-spin" />
            </div>
          ) : (
            <>
              <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 mb-4 dk-card dk-border">
                {/* 数据库目录 */}
                <div className="mb-5">
                  <label className="block text-sm font-bold text-[#1d1d1f] dk-text mb-2 flex items-center gap-1.5">
                    <Database size={14} className="text-[#07c160]" />
                    解密数据库目录
                    <span className="text-xs text-gray-400 font-normal">（留空则使用演示数据）</span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={dataDir}
                      onChange={(e) => setDataDir(e.target.value)}
                      placeholder="留空则使用演示数据"
                      className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#07c160] bg-[#f8f9fb] font-mono dk-input"
                    />
                    <button
                      onClick={() => browse('data')}
                      disabled={browsing !== null}
                      className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-[#e7f8f0] dark:bg-[#07c160]/10 text-[#07c160] text-sm font-semibold hover:bg-[#d0f0e0] dark:hover:bg-[#07c160]/20 disabled:opacity-50 transition-colors flex-shrink-0"
                    >
                      {browsing === 'data' ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
                      浏览
                    </button>
                  </div>
                </div>

                {/* 日志目录 */}
                <div className="mb-5">
                  <label className="block text-sm font-bold text-[#1d1d1f] dk-text mb-2 flex items-center gap-1.5">
                    <FileText size={14} className="text-gray-400" />
                    日志目录
                    <span className="text-xs text-gray-400 font-normal">（可选）</span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={logDir}
                      onChange={(e) => setLogDir(e.target.value)}
                      placeholder="留空则不记录日志文件"
                      className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#07c160] bg-[#f8f9fb] font-mono dk-input"
                    />
                    <button
                      onClick={() => browse('log')}
                      disabled={browsing !== null}
                      className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400 text-sm font-semibold hover:bg-gray-200 dark:hover:bg-white/15 disabled:opacity-50 transition-colors flex-shrink-0"
                    >
                      {browsing === 'log' ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
                      浏览
                    </button>
                  </div>
                </div>

                {/* 下载目录（导出图片/文件保存位置） */}
                <div>
                  <label className="block text-sm font-bold text-[#1d1d1f] dk-text mb-2 flex items-center gap-1.5">
                    <FolderOpen size={14} className="text-gray-400" />
                    导出图片保存位置
                    <span className="text-xs text-gray-400 font-normal">（留空使用系统默认）</span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={downloadDir}
                      onChange={(e) => setDownloadDir(e.target.value)}
                      placeholder={downloadDirEffective || '~/Downloads'}
                      className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#07c160] bg-[#f8f9fb] font-mono dk-input"
                    />
                    <button
                      onClick={() => browse('download')}
                      disabled={browsing !== null}
                      className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400 text-sm font-semibold hover:bg-gray-200 dark:hover:bg-white/15 disabled:opacity-50 transition-colors flex-shrink-0"
                    >
                      {browsing === 'download' ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
                      浏览
                    </button>
                  </div>
                  {downloadDirEffective && (
                    <p className="mt-1.5 text-xs text-gray-400">实际生效：<span className="font-mono">{downloadDirEffective}</span></p>
                  )}
                </div>
              </div>

              {error && (
                <div className="mb-4 flex items-start gap-2 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-2xl px-4 py-3">
                  <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
                </div>
              )}

              <button
                onClick={handleRestart}
                disabled={submitting}
                className="w-full bg-[#07c160] hover:bg-[#06ad56] disabled:opacity-50 text-white font-black text-base py-4 rounded-2xl flex items-center justify-center gap-2 transition-colors shadow-lg shadow-green-200"
              >
                {submitting ? (
                  <>
                    <Loader2 size={20} className="animate-spin" />
                    正在保存并重启…
                  </>
                ) : (
                  <>
                    <RotateCcw size={20} strokeWidth={2.5} />
                    保存并重启
                  </>
                )}
              </button>
            </>
          )}
        </section>
      )}

      {/* Prompt 模板 */}
      <PromptTemplateSection />

      {/* 版本信息 + 日志打包 */}
      <section className="mb-8 bg-white rounded-3xl border border-gray-100 p-6 sm:p-8 dk-card dk-border" data-settings-tags="版本 关于 about version 日志 log 更新 update">
        <h2 className="text-lg font-black text-[#1d1d1f] dk-text mb-4 flex items-center gap-2">
          <FileText size={18} className="text-gray-400" />
          关于 WeLink
        </h2>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              当前版本：<span className="font-mono font-bold text-[#1d1d1f] dk-text">{appVersion ?? 'dev'}</span>
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              <a href="https://github.com/runzhliu/welink/releases" target="_blank" rel="noreferrer" className="hover:text-[#07c160] underline">更新日志</a>
              {' · '}
              <a href="https://welink.click" target="_blank" rel="noreferrer" className="hover:text-[#07c160] underline">官方文档</a>
              {' · '}
              <a href="https://github.com/runzhliu/WeLink" target="_blank" rel="noreferrer" className="hover:text-[#07c160] underline">GitHub</a>
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            {/* 检查更新 */}
            <button
              onClick={async () => {
                setCheckingUpdate(true);
                setUpdateInfo(null);
                try {
                  const resp = await fetch('/api/app/check-update');
                  const data = await resp.json();
                  setUpdateInfo(data);
                } catch {
                  setUpdateInfo({ has_update: false, latest: '', changelog: '', url: '', assets: [], error: '网络请求失败' });
                } finally {
                  setCheckingUpdate(false);
                }
              }}
              disabled={checkingUpdate}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#07c160] hover:bg-[#06ad56] text-white text-sm font-semibold disabled:opacity-50 transition-colors"
            >
              {checkingUpdate ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
              检查更新
            </button>
          </div>
        </div>

        {/* 更新检测结果 */}
        {updateInfo && (
          <div className="mt-4">
            {updateInfo.error ? (
              <p className="text-xs text-red-500">{updateInfo.error}</p>
            ) : updateInfo.has_update ? (
              <div className="bg-[#e7f8f0] dark:bg-[#07c160]/10 border border-[#07c160]/20 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-[#07c160]">发现新版本 {updateInfo.latest}</span>
                  <span className="text-[10px] text-gray-400">当前 {appVersion}</span>
                </div>
                {updateInfo.changelog && (
                  <pre className="text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap max-h-32 overflow-y-auto bg-white/50 dark:bg-black/10 rounded-lg p-3">{updateInfo.changelog}</pre>
                )}
                {updateInfo.assets.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-bold text-gray-500">下载安装包：</p>
                    {updateInfo.assets.map(a => (
                      <div key={a.name} className="flex items-center gap-2 text-xs">
                        <span className="text-gray-600 dark:text-gray-300 font-mono truncate flex-1">{a.name}</span>
                        <span className="text-gray-400 flex-shrink-0">{(a.size / 1024 / 1024).toFixed(1)} MB</span>
                        <a href={a.url} target="_blank" rel="noreferrer"
                          className="px-2 py-0.5 rounded-lg bg-[#07c160] text-white font-bold hover:bg-[#06ad56] transition-colors flex-shrink-0">
                          GitHub 下载
                        </a>
                      </div>
                    ))}
                  </div>
                )}
                <a href={updateInfo.url} target="_blank" rel="noreferrer"
                  className="inline-block text-xs text-[#07c160] font-bold hover:underline">
                  在 GitHub 上查看完整发布说明 →
                </a>
              </div>
            ) : (
              <p className="text-xs text-[#07c160] font-semibold">✓ 当前已是最新版本</p>
            )}
          </div>
        )}

        {/* AI 备份已移出到独立 section（在「数据目录·多账号」和「应用配置」之间） */}

        {/* 日志打包 */}
        <div className="flex flex-wrap items-center justify-between gap-4 mt-4 pt-4 border-t border-gray-100 dark:border-white/10">
          <p className="text-xs text-gray-400">遇到问题？打包日志发送给开发者</p>
          {isAppMode && (
            <div className="flex flex-col items-end gap-1.5">
              <button
                onClick={async () => {
                  setBundling(true);
                  setBundlePath(null);
                  try {
                    const r = await appApi.bundleLogs();
                    if (r.error) throw new Error(r.error);
                    setBundlePath(r.path);
                  } catch (e: any) {
                    toast.error('打包失败：' + (e?.message || '未知错误'));
                  } finally {
                    setBundling(false);
                  }
                }}
                disabled={bundling}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/15 text-gray-600 dark:text-gray-300 text-sm font-semibold disabled:opacity-50 transition-colors"
              >
                {bundling ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
                一键打包日志
              </button>
              <p className="text-[10px] text-gray-400 max-w-xs text-right">API Key 等敏感信息会自动脱敏，可放心分享</p>
              {bundlePath && (
                <p className="text-xs text-[#07c160] font-mono break-all max-w-xs text-right">
                  ✓ 已保存至：{bundlePath}
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} appVersion={appVersion} />
      </div>{/* /主内容区 */}
    </div>
  );
};
