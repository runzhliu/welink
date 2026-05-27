import React, { useState, useCallback, useEffect } from 'react';
import { Plus, Loader2, Check } from 'lucide-react';
import axios from 'axios';
import { ProfileCard } from './ProfileCard';
import { genId, newProfile, type LLMProfile, type ProviderValue } from './types';

export const LLMSection: React.FC = () => {
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
