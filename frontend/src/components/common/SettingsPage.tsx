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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-gray-100 text-gray-700"
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
        className="flex-1 px-4 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#07c160]/20 focus:border-[#07c160] transition-all"
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
  { value: 'openai',   label: 'OpenAI', defaultURL: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini' },
  { value: 'claude',   label: 'Claude (Anthropic)', defaultURL: '', defaultModel: 'claude-haiku-4-5-20251001' },
  { value: 'ollama',   label: 'Ollama（本地）', defaultURL: 'http://localhost:11434/v1', defaultModel: 'llama3' },
  { value: 'custom',   label: '自定义 OpenAI 兼容接口', defaultURL: '', defaultModel: '' },
] as const;

type ProviderValue = typeof PROVIDERS[number]['value'];

const AISettingsSection: React.FC = () => {
  const [provider, setProvider] = useState<ProviderValue>('deepseek');
  const [apiKey, setApiKey] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [model, setModel] = useState('');
  const [aiDBPath, setAiDBPath] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Gemini OAuth
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
      llm_provider?: string; llm_api_key?: string;
      llm_base_url?: string; llm_model?: string;
      gemini_client_id?: string; gemini_client_secret?: string;
      ai_analysis_db_path?: string;
      embedding_provider?: string; embedding_api_key?: string;
      embedding_base_url?: string; embedding_model?: string; embedding_dims?: number;
    }>('/api/preferences').then(r => {
      if (r.data.llm_provider) setProvider(r.data.llm_provider as ProviderValue);
      setApiKey(r.data.llm_api_key ?? '');
      setBaseURL(r.data.llm_base_url ?? '');
      setModel(r.data.llm_model ?? '');
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

  const providerInfo = PROVIDERS.find(p => p.value === provider) ?? PROVIDERS[0];

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      await axios.put('/api/preferences/llm', {
        llm_provider: provider,
        llm_api_key: apiKey,
        llm_base_url: baseURL,
        llm_model: model,
        gemini_client_id: geminiClientID,
        gemini_client_secret: geminiClientSecret,
        ai_analysis_db_path: aiDBPath,
        ...embeddingPrefsRef.current,
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
        llm_provider: provider,
        llm_api_key: apiKey,
        llm_base_url: baseURL,
        llm_model: model,
        gemini_client_id: geminiClientID,
        gemini_client_secret: geminiClientSecret,
        ai_analysis_db_path: aiDBPath,
        ...embeddingPrefsRef.current,
      });
      const r = await axios.post<{ ok: boolean; provider: string; model: string }>('/api/ai/llm/test');
      setSaveMsg({ ok: true, text: `连接成功（${r.data.provider} · ${r.data.model}）` });
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? '连接失败';
      setSaveMsg({ ok: false, text: msg });
    } finally {
      setTesting(false);
      setTimeout(() => setSaveMsg(null), 5000);
    }
  };

  const handleGeminiAuth = async () => {
    if (!geminiClientID || !geminiClientSecret) {
      setSaveMsg({ ok: false, text: '请先填写并保存 Client ID 和 Client Secret' });
      setTimeout(() => setSaveMsg(null), 3000);
      return;
    }
    // 先保存 client_id / client_secret
    await axios.put('/api/preferences/llm', {
      llm_provider: provider, llm_api_key: apiKey,
      llm_base_url: baseURL, llm_model: model,
      gemini_client_id: geminiClientID, gemini_client_secret: geminiClientSecret,
      ...embeddingPrefsRef.current,
    }).catch(() => {});

    try {
      const r = await axios.get<{ url: string }>('/api/auth/gemini/url');
      window.open(r.data.url, '_blank');
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? '获取授权地址失败';
      setSaveMsg({ ok: false, text: msg });
      setTimeout(() => setSaveMsg(null), 3000);
      return;
    }

    // 轮询等待回调完成
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

  const urlPlaceholder = providerInfo.defaultURL ? `默认：${providerInfo.defaultURL}` : '请输入 Base URL';
  const modelPlaceholder = providerInfo.defaultModel ? `默认：${providerInfo.defaultModel}` : '请输入模型名';

  return (
    <section className="mb-8">
      <div className="flex items-center gap-2 mb-3">
        <Bot size={18} className="text-[#07c160]" />
        <h3 className="text-base font-bold text-[#1d1d1f]">AI 分析配置</h3>
      </div>
      <p className="text-sm text-gray-400 mb-4">配置后可在联系人聊天记录中使用 AI 分析功能。</p>

      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        {/* Provider */}
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase tracking-wide">AI 提供商</label>
          <select
            value={provider}
            onChange={e => setProvider(e.target.value as ProviderValue)}
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#07c160] bg-[#f8f9fb]"
          >
            {PROVIDERS.map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        {/* API Key */}
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase tracking-wide">
            API Key
            {provider === 'ollama' && <span className="ml-1 text-gray-400 font-normal normal-case">（本地无需填写）</span>}
            {provider === 'gemini' && geminiAuthorized && <span className="ml-1 text-gray-400 font-normal normal-case">（使用 OAuth 时可留空）</span>}
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={provider === 'ollama' ? '留空即可' : provider === 'gemini' && geminiAuthorized ? '已通过 OAuth 授权，可留空' : '请输入 API Key'}
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#07c160] bg-[#f8f9fb] font-mono"
          />
        </div>

        {/* Gemini OAuth */}
        {provider === 'gemini' && (
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 space-y-3">
            <p className="text-xs font-bold text-blue-700 uppercase tracking-wide">Google OAuth 登录（可选）</p>
            <p className="text-xs text-blue-600 leading-relaxed">
              在 <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="underline">Google Cloud Console</a> 创建「桌面应用」类型的 OAuth 2.0 客户端，
              将 <code className="bg-blue-100 px-1 rounded text-[11px]">http://localhost:PORT/api/auth/gemini/callback</code> 添加为授权重定向 URI，然后填入以下信息。
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-bold text-blue-600 mb-1 uppercase tracking-wide">Client ID</label>
                <input
                  type="text"
                  value={geminiClientID}
                  onChange={e => setGeminiClientID(e.target.value)}
                  placeholder="xxxxx.apps.googleusercontent.com"
                  className="w-full text-xs border border-blue-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-blue-400 bg-white font-mono"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-blue-600 mb-1 uppercase tracking-wide">Client Secret</label>
                <input
                  type="password"
                  value={geminiClientSecret}
                  onChange={e => setGeminiClientSecret(e.target.value)}
                  placeholder="GOCSPX-…"
                  className="w-full text-xs border border-blue-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-blue-400 bg-white font-mono"
                />
              </div>
            </div>
            {geminiAuthorized ? (
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-green-600">
                  <Check size={13} className="text-green-500" />
                  已通过 Google 授权
                </span>
                <button
                  onClick={handleGeminiRevoke}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors"
                >
                  <LogOut size={11} />
                  撤销授权
                </button>
              </div>
            ) : (
              <button
                onClick={handleGeminiAuth}
                disabled={geminiAuthBusy}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-white border border-blue-300 text-blue-600 hover:bg-blue-50 disabled:opacity-50 transition-colors"
              >
                {geminiAuthBusy
                  ? <><Loader2 size={12} className="animate-spin" />等待授权完成…</>
                  : <><LogIn size={12} />通过 Google 账号授权</>}
              </button>
            )}
          </div>
        )}

        {/* Base URL */}
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase tracking-wide">
            Base URL <span className="text-gray-400 font-normal normal-case">（留空使用默认）</span>
          </label>
          <input
            type="text"
            value={baseURL}
            onChange={e => setBaseURL(e.target.value)}
            placeholder={urlPlaceholder}
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#07c160] bg-[#f8f9fb] font-mono"
          />
        </div>

        {/* Model */}
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase tracking-wide">
            模型 <span className="text-gray-400 font-normal normal-case">（留空使用默认）</span>
          </label>
          <input
            type="text"
            value={model}
            onChange={e => setModel(e.target.value)}
            placeholder={modelPlaceholder}
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#07c160] bg-[#f8f9fb] font-mono"
          />
        </div>

        {/* AI 分析历史数据库路径 */}
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase tracking-wide">
            分析历史数据库路径 <span className="text-gray-400 font-normal normal-case">（留空使用默认路径）</span>
          </label>
          <input
            type="text"
            value={aiDBPath}
            onChange={e => setAiDBPath(e.target.value)}
            placeholder="留空则与配置文件同目录，如 /data/ai_analysis.db"
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#07c160] bg-[#f8f9fb] font-mono"
          />
          <p className="text-[10px] text-gray-400 mt-1">
            Docker 建议设为挂载目录下的路径，确保容器重启后分析记录不丢失。
          </p>
        </div>

        {/* Save */}
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
            className="flex items-center gap-1.5 px-4 py-2.5 border border-gray-200 text-gray-600 text-sm font-bold rounded-xl hover:border-[#07c160] hover:text-[#07c160] disabled:opacity-50 transition-colors"
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
    </section>
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
      llm_provider?: string; llm_api_key?: string; llm_base_url?: string; llm_model?: string;
      gemini_client_id?: string; gemini_client_secret?: string; ai_analysis_db_path?: string;
    }>('/api/preferences').then(r => {
      if (r.data.embedding_provider) setProvider(r.data.embedding_provider as EmbeddingProviderValue);
      setApiKey(r.data.embedding_api_key ?? '');
      setBaseURL(r.data.embedding_base_url ?? '');
      setModel(r.data.embedding_model ?? '');
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
    <section className="mb-8">
      <div className="flex items-center gap-2 mb-3">
        <Database size={18} className="text-[#07c160]" />
        <h3 className="text-base font-bold text-[#1d1d1f]">向量 Embedding 配置</h3>
      </div>
      <p className="text-sm text-gray-400 mb-4">
        用于混合检索模式的语义向量化。推荐使用 Ollama 本地运行，无需 API Key，完全免费。
        <br />
        Ollama 安装后执行：<code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono">ollama pull nomic-embed-text</code>
      </p>

      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        {/* Provider */}
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase tracking-wide">Embedding 提供商</label>
          <select
            value={provider}
            onChange={e => setProvider(e.target.value as EmbeddingProviderValue)}
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#07c160] bg-[#f8f9fb]"
          >
            {EMBEDDING_PROVIDERS.map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        {/* API Key（Ollama 不需要） */}
        {providerInfo.needsKey && (
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase tracking-wide">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="请输入 API Key"
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#07c160] bg-[#f8f9fb] font-mono"
            />
          </div>
        )}

        {/* Base URL */}
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase tracking-wide">
            Base URL <span className="text-gray-400 font-normal normal-case">（留空使用默认）</span>
          </label>
          <input
            type="text"
            value={baseURL}
            onChange={e => setBaseURL(e.target.value)}
            placeholder={urlPlaceholder}
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#07c160] bg-[#f8f9fb] font-mono"
          />
          {provider === 'ollama' && (
            <p className="text-[10px] text-gray-400 mt-1">
              Docker 容器内访问宿主机 Ollama 请填：
              <code
                className="ml-1 bg-gray-100 px-1 rounded font-mono cursor-pointer hover:bg-gray-200 transition-colors"
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
          <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase tracking-wide">
            模型 <span className="text-gray-400 font-normal normal-case">（留空使用默认）</span>
          </label>
          <input
            type="text"
            value={model}
            onChange={e => setModel(e.target.value)}
            placeholder={modelPlaceholder}
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#07c160] bg-[#f8f9fb] font-mono"
          />
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
            className="flex items-center gap-1.5 px-4 py-2.5 border border-gray-200 text-gray-600 text-sm font-bold rounded-xl hover:border-[#07c160] hover:text-[#07c160] disabled:opacity-50 transition-colors"
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
    </section>
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
    <section className="mb-8">
      <div className="flex items-center gap-2 mb-1">
        <Bot size={18} className="text-[#07c160]" />
        <h3 className="text-base font-bold text-[#1d1d1f]">记忆提炼模型</h3>
      </div>
      <p className="text-sm text-gray-400 mb-3">
        提炼记忆事实时使用的模型。<strong className="text-gray-600">两个字段均留空 = 复用上方主 AI 配置</strong>；
        填写后使用本地 Ollama 模型，原始聊天内容不经过云端，更安全可靠。
      </p>
      {/* 安全提示 */}
      <div className="mb-4 flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-100 text-xs text-amber-700 leading-relaxed">
        <AlertCircle size={13} className="flex-shrink-0 mt-0.5 text-amber-500" />
        <span>
          <strong>推荐使用本地 Ollama 模型进行提炼</strong>（如 <code className="bg-amber-100 px-1 rounded">qwen2.5:7b</code>）——
          提炼时会读取大量原始聊天记录，本地模型可确保数据不离开本机。
          云端大模型同样可用，但内容会上传至第三方服务器。
        </span>
      </div>
      {/* 当前生效配置 */}
      <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-xl bg-[#f0f9f4] border border-[#c3e6d0] text-xs">
        <span className="text-gray-400">当前将使用：</span>
        <span className="font-semibold text-[#07c160]">{effectiveProviderLabel}</span>
        <span className="text-gray-300">·</span>
        <code className="text-gray-600 bg-white px-1.5 py-0.5 rounded border border-gray-100">{effectiveModelName}</code>
        {isUsingMain && <span className="ml-1 text-gray-400">（与主 AI 相同）</span>}
      </div>
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Base URL</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={baseURL}
              onChange={e => setBaseURL(e.target.value)}
              placeholder="留空则使用主 AI 配置"
              className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#07c160]/20 focus:border-[#07c160] transition-all"
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
          <label className="block text-xs font-semibold text-gray-500 mb-1">模型</label>
          <input
            type="text"
            value={model}
            onChange={e => setModel(e.target.value)}
            placeholder="留空则使用主 AI 配置"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#07c160]/20 focus:border-[#07c160] transition-all"
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
            className="flex items-center gap-1.5 px-4 py-2.5 border border-gray-200 text-gray-600 text-sm font-bold rounded-xl hover:border-[#07c160] hover:text-[#07c160] disabled:opacity-50 transition-colors"
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
      <div className="flex flex-col items-center justify-center h-64 gap-4 text-gray-500">
        <CheckCircle2 size={40} className="text-[#07c160]" />
        <p className="font-semibold text-[#1d1d1f]">配置已保存，应用正在重启…</p>
        <p className="text-sm text-gray-400">稍后新窗口会自动打开</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-black text-[#1d1d1f] mb-8">设置</h2>

      {/* ── 录屏模式 ── */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <EyeOff size={18} className="text-[#07c160]" />
          <h3 className="text-base font-bold text-[#1d1d1f]">录屏模式</h3>
        </div>
        <p className="text-sm text-gray-400 mb-4">开启后，所有联系人姓名、群名及词云内容将模糊显示，适合录制演示视频时保护隐私。</p>
        <div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-[#1d1d1f]">模糊姓名与词云</p>
            <p className="text-xs text-gray-400 mt-0.5">页面刷新后仍保持此设置</p>
          </div>
          <button
            onClick={() => onTogglePrivacyMode?.(!privacyMode)}
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${privacyMode ? 'bg-[#07c160]' : 'bg-gray-200'}`}
          >
            <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${privacyMode ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
      </section>

      {/* ── 显示设置 ── */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <BarChart2 size={18} className="text-[#07c160]" />
          <h3 className="text-base font-bold text-[#1d1d1f]">显示设置</h3>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-[#1d1d1f]">群聊发言排行显示人数</p>
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
              className="w-20 text-sm border border-gray-200 rounded-xl px-3 py-1.5 text-center focus:outline-none focus:border-[#07c160]"
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-[#1d1d1f]">发言排行名字列宽度</p>
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
              className="w-20 text-sm border border-gray-200 rounded-xl px-3 py-1.5 text-center focus:outline-none focus:border-[#07c160]"
            />
          </div>
        </div>
      </section>

      {/* ── AI 分析配置 ── */}
      <AISettingsSection />

      {/* ── 向量 Embedding 配置 ── */}
      <EmbeddingSettingsSection />

      {/* ── 记忆提炼模型（本地专用） ── */}
      <MemLLMSettingsSection />

      {/* ── 隐私屏蔽 ── */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <ShieldOff size={18} className="text-[#07c160]" />
          <h3 className="text-base font-bold text-[#1d1d1f]">隐私屏蔽</h3>
        </div>
        <p className="text-sm text-gray-400 mb-4">被屏蔽的联系人和群聊将从所有列表中隐藏，数据仍保留在数据库中。</p>

        <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <User size={16} className="text-[#07c160]" />
            <h4 className="font-bold text-[#1d1d1f]">屏蔽联系人</h4>
            {blockedUsers.length > 0 && (
              <span className="ml-auto text-xs font-bold px-2.5 py-1 rounded-full bg-gray-100 text-gray-500">
                {blockedUsers.length} 条
              </span>
            )}
          </div>
          <TagList items={blockedUsers} onRemove={onRemoveBlockedUser} emptyText="暂无屏蔽联系人" labelFor={userLabelFor} privacyMode={privacyMode} />
          <AddInput placeholder="输入微信ID、昵称或备注名，按回车添加" onAdd={onAddBlockedUser} />
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Users size={16} className="text-[#07c160]" />
            <h4 className="font-bold text-[#1d1d1f]">屏蔽群聊</h4>
            {blockedGroups.length > 0 && (
              <span className="ml-auto text-xs font-bold px-2.5 py-1 rounded-full bg-gray-100 text-gray-500">
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
            <h3 className="text-base font-bold text-[#1d1d1f]">应用配置</h3>
          </div>
          <p className="text-sm text-gray-400 mb-4">修改配置后需要重启应用生效</p>

          {loadingCfg ? (
            <div className="flex items-center justify-center h-32 text-gray-400">
              <Loader2 size={24} className="animate-spin" />
            </div>
          ) : (
            <>
              <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 mb-4">
                {/* 数据库目录 */}
                <div className="mb-5">
                  <label className="block text-sm font-bold text-[#1d1d1f] mb-2 flex items-center gap-1.5">
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
                      className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#07c160] bg-[#f8f9fb] font-mono"
                    />
                    <button
                      onClick={() => browse('data')}
                      disabled={browsing !== null}
                      className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-[#e7f8f0] text-[#07c160] text-sm font-semibold hover:bg-[#d0f0e0] disabled:opacity-50 transition-colors flex-shrink-0"
                    >
                      {browsing === 'data' ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
                      浏览
                    </button>
                  </div>
                </div>

                {/* 日志目录 */}
                <div>
                  <label className="block text-sm font-bold text-[#1d1d1f] mb-2 flex items-center gap-1.5">
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
                      className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#07c160] bg-[#f8f9fb] font-mono"
                    />
                    <button
                      onClick={() => browse('log')}
                      disabled={browsing !== null}
                      className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-gray-100 text-gray-500 text-sm font-semibold hover:bg-gray-200 disabled:opacity-50 transition-colors flex-shrink-0"
                    >
                      {browsing === 'log' ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
                      浏览
                    </button>
                  </div>
                </div>
              </div>

              {error && (
                <div className="mb-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
                  <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{error}</p>
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
      <section className="bg-white rounded-3xl border border-gray-100 p-6 sm:p-8">
        <h2 className="text-lg font-black text-[#1d1d1f] mb-4 flex items-center gap-2">
          <FileText size={18} className="text-gray-400" />
          关于 WeLink
        </h2>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm text-gray-500">
              当前版本：<span className="font-mono font-bold text-[#1d1d1f]">{appVersion ?? 'dev'}</span>
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              <a href="https://github.com/runzhliu/welink/releases" target="_blank" rel="noreferrer" className="hover:text-[#07c160] underline">查看更新日志</a>
              {' · '}
              <a href="https://welink.click" target="_blank" rel="noreferrer" className="hover:text-[#07c160] underline">官方文档</a>
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
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-semibold disabled:opacity-50 transition-colors"
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
