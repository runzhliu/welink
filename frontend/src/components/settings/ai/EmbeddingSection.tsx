import React, { useState, useEffect } from 'react';
import { Loader2, AlertCircle, Check } from 'lucide-react';
import axios from 'axios';

const EMBEDDING_PROVIDERS = [
  { value: 'ollama',  label: 'Ollama（本地，免费）', defaultURL: 'http://localhost:11434', defaultModel: 'nomic-embed-text', needsKey: false },
  { value: 'openai',  label: 'OpenAI', defaultURL: 'https://api.openai.com/v1', defaultModel: 'text-embedding-3-small', needsKey: true },
  { value: 'jina',    label: 'Jina AI', defaultURL: 'https://api.jina.ai/v1', defaultModel: 'jina-embeddings-v3', needsKey: true },
  { value: 'custom',  label: '自定义（OpenAI 兼容）', defaultURL: '', defaultModel: '', needsKey: true },
] as const;

type EmbeddingProviderValue = typeof EMBEDDING_PROVIDERS[number]['value'];

export const EmbeddingSection: React.FC = () => {
  const [provider, setProvider] = useState<EmbeddingProviderValue>('ollama');
  const [apiKey, setApiKey] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [model, setModel] = useState('');
  const [cacheMaxKeys, setCacheMaxKeys] = useState(3);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    axios.get<{
      embedding_provider?: string; embedding_api_key?: string;
      embedding_base_url?: string; embedding_model?: string;
      vec_cache_max_keys?: number;
    }>('/api/preferences').then(r => {
      if (r.data.embedding_provider) setProvider(r.data.embedding_provider as EmbeddingProviderValue);
      setApiKey(r.data.embedding_api_key ?? '');
      setBaseURL(r.data.embedding_base_url ?? '');
      setModel(r.data.embedding_model ?? '');
      setCacheMaxKeys(r.data.vec_cache_max_keys || 3);
    }).catch(() => {}).finally(() => setLoaded(true));
  }, []);

  const providerInfo = EMBEDDING_PROVIDERS.find(p => p.value === provider) ?? EMBEDDING_PROVIDERS[0];

  // save 时实时拉最新 prefs 再 merge —— 不会覆盖 LLM tab 刚保存的字段
  const buildPayload = async () => {
    let fresh: Record<string, unknown> = {};
    try {
      const r = await axios.get<Record<string, unknown>>('/api/preferences');
      fresh = r.data;
    } catch { /* ignore */ }
    return {
      ...fresh,
      embedding_provider: provider,
      embedding_api_key: apiKey,
      embedding_base_url: baseURL,
      embedding_model: model,
      vec_cache_max_keys: cacheMaxKeys,
    };
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      await axios.put('/api/preferences/llm', await buildPayload());
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
      await axios.put('/api/preferences/llm', await buildPayload());
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
