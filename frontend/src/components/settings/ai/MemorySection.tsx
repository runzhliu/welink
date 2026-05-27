import React, { useState, useEffect } from 'react';
import { Loader2, AlertCircle, Check } from 'lucide-react';
import axios from 'axios';
import { PROVIDERS } from './types';

export const MemorySection: React.FC = () => {
  const [baseURL, setBaseURL] = useState('');
  const [model, setModel] = useState('');
  const [mainProvider, setMainProvider] = useState('deepseek');
  const [mainModel, setMainModel] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    axios.get<Record<string, unknown>>('/api/preferences').then(r => {
      setBaseURL((r.data.mem_llm_base_url as string) ?? '');
      setModel((r.data.mem_llm_model as string) ?? '');
      setMainProvider((r.data.llm_provider as string) ?? 'deepseek');
      setMainModel((r.data.llm_model as string) ?? '');
    }).catch(() => {}).finally(() => setLoaded(true));
  }, []);

  // save 时实时拉最新 prefs 再 merge —— 不会覆盖 LLM / Embedding tab 刚保存的字段
  const buildPayload = async () => {
    let fresh: Record<string, unknown> = {};
    try {
      const r = await axios.get<Record<string, unknown>>('/api/preferences');
      fresh = r.data;
    } catch { /* ignore */ }
    return {
      ...fresh,
      mem_llm_base_url: baseURL,
      mem_llm_model: model,
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

  const handleMemTest = async () => {
    setTesting(true);
    setSaveMsg(null);
    try {
      await axios.put('/api/preferences/llm', await buildPayload());
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
