/**
 * 设置页 — 隐私屏蔽（两种模式通用）+ App 配置（仅 App 模式）
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  X, Plus, ShieldOff, User, Users,
  FolderOpen, Loader2, Database, FileText, AlertCircle, RotateCcw, CheckCircle2, EyeOff, BarChart2, Bot, Check, LogIn, LogOut,
} from 'lucide-react';
import axios from 'axios';

export const MEMBER_RANK_LIMIT_KEY = 'welink_member_rank_limit';
export const MEMBER_NAME_WIDTH_KEY = 'welink_member_name_width';
export const DEFAULT_RANK_LIMIT = 10;
export const DEFAULT_NAME_WIDTH = 144; // px, roughly w-36
import { appApi } from '../../services/appApi';
import type { ContactStats, GroupInfo } from '../../types';

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
  { value: 'kimi',     label: 'Kimi (Moonshot)', defaultURL: 'https://api.moonshot.cn/v1', defaultModel: 'moonshot-v1-8k' },
  { value: 'gemini',   label: 'Gemini', defaultURL: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-2.0-flash' },
  { value: 'glm',      label: 'GLM（智谱 AI）', defaultURL: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4-flash' },
  { value: 'grok',     label: 'Grok (xAI)', defaultURL: 'https://api.x.ai/v1', defaultModel: 'grok-3-mini' },
  { value: 'minimax',  label: 'MiniMax', defaultURL: 'https://api.minimax.io/v1', defaultModel: 'MiniMax-Text-01' },
  { value: 'openai',   label: 'OpenAI', defaultURL: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini' },
  { value: 'claude',   label: 'Claude (Anthropic)', defaultURL: '', defaultModel: 'claude-haiku-4-5-20251001' },
  { value: 'ollama',   label: 'Ollama（本地）', defaultURL: 'http://localhost:11434/v1', defaultModel: 'qwen2.5:3b' },
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
          onChange={e => set('provider', e.target.value)}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#07c160] bg-white dk-input"
        >
          {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </div>

      {/* API Key */}
      <div>
        <label className="block text-[10px] font-bold text-gray-400 mb-1 uppercase tracking-wide">
          API Key
          {profile.provider === 'ollama' && <span className="ml-1 font-normal normal-case text-gray-400">（本地无需填写）</span>}
          {profile.provider === 'gemini' && geminiAuthorized && <span className="ml-1 font-normal normal-case text-gray-400">（OAuth 已授权，可留空）</span>}
        </label>
        <input
          type="password"
          value={profile.api_key ?? ''}
          onChange={e => set('api_key', e.target.value)}
          placeholder={profile.provider === 'ollama' ? '留空即可' : profile.provider === 'gemini' && geminiAuthorized ? '已通过 OAuth 授权' : '请输入 API Key'}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#07c160] bg-white font-mono dk-input"
        />
      </div>

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
              <input type="password" value={geminiClientSecret} onChange={e => onGeminiClientSecretChange(e.target.value)}
                placeholder="GOCSPX-…"
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

  useEffect(() => {
    axios.get<{
      llm_profiles?: LLMProfile[];
      llm_provider?: string; llm_api_key?: string;
      llm_base_url?: string; llm_model?: string;
      gemini_client_id?: string; gemini_client_secret?: string;
      ai_analysis_db_path?: string;
      embedding_provider?: string; embedding_api_key?: string;
      embedding_base_url?: string; embedding_model?: string; embedding_dims?: number;
    }>('/api/preferences').then(r => {
      if (r.data.llm_profiles && r.data.llm_profiles.length > 0) {
        setProfiles(r.data.llm_profiles);
      } else if (r.data.llm_provider) {
        // 从旧版单配置迁移
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
    }).catch(() => {}).finally(() => setLoaded(true));
    checkGeminiStatus();
  }, []);

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
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="请输入 API Key"
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
}) => {
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
  const [loadingCfg, setLoadingCfg] = useState(isAppMode);
  const [bundling, setBundling] = useState(false);
  const [bundlePath, setBundlePath] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState<'data' | 'log' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    if (!isAppMode) return;
    appApi.getConfig().then((cfg) => {
      setDataDir(cfg.data_dir || '');
      setLogDir(cfg.log_dir || '');
    }).catch(() => {}).finally(() => setLoadingCfg(false));
  }, [isAppMode]);

  const browse = useCallback(async (type: 'data' | 'log') => {
    setBrowsing(type);
    try {
      const prompt = type === 'data' ? '选择解密后的微信数据库目录（decrypted/）' : '选择日志文件存放目录';
      const path = await appApi.browse(prompt);
      if (type === 'data') setDataDir(path);
      else setLogDir(path);
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

  if (restarting) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 text-gray-500 dark:text-gray-400">
        <CheckCircle2 size={40} className="text-[#07c160]" />
        <p className="font-semibold text-[#1d1d1f] dk-text">配置已保存，应用正在重启…</p>
        <p className="text-sm text-gray-400">稍后新窗口会自动打开</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-black text-[#1d1d1f] dk-text mb-8">设置</h2>

      {/* ── 录屏模式 ── */}
      <section className="mb-8">
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
      <section className="mb-8">
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

      {/* ── AI 配置（分析模型 / Embedding / 记忆提炼） ── */}
      <AIConfigGroup />

      {/* ── 隐私屏蔽 ── */}
      <section className="mb-8">
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
              <span className="ml-auto text-xs font-bold px-2.5 py-1 rounded-full bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400">
                {blockedUsers.length} 条
              </span>
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
              <span className="ml-auto text-xs font-bold px-2.5 py-1 rounded-full bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400">
                {blockedGroups.length} 条
              </span>
            )}
          </div>
          <TagList items={blockedGroups} onRemove={onRemoveBlockedGroup} emptyText="暂无屏蔽群聊" labelFor={groupLabelFor} privacyMode={privacyMode} />
          <AddInput placeholder="输入群名称或群ID（以 @chatroom 结尾），按回车添加" onAdd={onAddBlockedGroup} />
        </div>
      </section>

      {/* ── App 配置（仅 App 模式） ── */}
      {isAppMode && (
        <section>
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
                <div>
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

      {/* 版本信息 + 日志打包 */}
      <section className="bg-white rounded-3xl border border-gray-100 p-6 sm:p-8 dk-card dk-border">
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
                    alert('打包失败：' + (e?.message || '未知错误'));
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
              {bundlePath && (
                <p className="text-xs text-[#07c160] font-mono break-all max-w-xs text-right">
                  ✓ 已保存至：{bundlePath}
                </p>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
