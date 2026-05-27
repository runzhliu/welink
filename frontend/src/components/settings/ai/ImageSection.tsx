import React, { useState, useEffect } from 'react';
import { X, Loader2, AlertCircle, Check, ExternalLink } from 'lucide-react';
import axios from 'axios';
import { openProviderUrl } from '../constants';
import { genId } from './types';

interface ImageProviderMeta {
  value: string;
  label: string;
  default_base_url: string;
  default_model: string;
  models: { value: string; label: string }[];
  sizes: string[];
  key_url?: string;
  auth_hint?: string;
  price_hint?: string;
}

interface ImageProfile {
  id: string;
  name: string;
  provider: string;
  api_key?: string;
  base_url?: string;
  model?: string;
}

function newImageProfile(meta: ImageProviderMeta[] | null, index: number): ImageProfile {
  const provider = meta?.[0]?.value ?? 'doubao';
  return { id: genId(), name: `配置 ${index}`, provider, api_key: '', base_url: '', model: '' };
}

const ImageProfileCard: React.FC<{
  profile: ImageProfile;
  index: number;
  total: number;
  providers: ImageProviderMeta[];
  onChange: (p: ImageProfile) => void;
  onDelete: () => void;
  onSaveAndTest: (id: string) => void;
  testing: boolean;
  testMsg: { ok: boolean; text: string; image?: string } | null;
}> = ({ profile, index, total, providers, onChange, onDelete, onSaveAndTest, testing, testMsg }) => {
  const meta = providers.find(p => p.value === profile.provider) ?? providers[0];
  const set = (field: keyof ImageProfile, val: string) => onChange({ ...profile, [field]: val });

  return (
    <div className="rounded-xl border border-gray-100 dark:border-white/10 bg-[#fafafa] dark:bg-white/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">配置 {index + 1}</span>
        <input type="text" value={profile.name} onChange={e => set('name', e.target.value)}
          placeholder={`配置 ${index + 1}`}
          className="flex-1 text-sm font-semibold border-0 bg-transparent focus:outline-none text-[#1d1d1f] dark:text-gray-200 placeholder-gray-300" />
        {total > 1 && (
          <button onClick={onDelete} className="p-1 text-gray-300 hover:text-red-400 transition-colors" title="删除此配置">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Provider */}
      <div>
        <label className="block text-[10px] font-bold text-gray-400 mb-1 uppercase tracking-wide">生图提供商</label>
        <select
          value={profile.provider}
          onChange={e => {
            const newProvider = e.target.value;
            const oldProvider = profile.provider;
            const oldProviderNames = providers.map(p => p.value);
            const shouldAutoRename = !profile.name || oldProviderNames.includes(profile.name);
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
          {providers.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </div>

      {/* API Key */}
      <div>
        <label className="flex items-center gap-2 text-[10px] font-bold text-gray-400 mb-1 uppercase tracking-wide">
          <span>API Key</span>
          {meta?.key_url && (
            <button type="button" onClick={() => openProviderUrl(meta.key_url!)}
              className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold normal-case tracking-normal bg-[#07c160]/10 dark:bg-[#07c160]/20 text-[#07c160] hover:bg-[#07c160]/20 dark:hover:bg-[#07c160]/30 transition-colors">
              获取 Key <ExternalLink size={10} />
            </button>
          )}
        </label>
        <input
          type="password"
          value={profile.api_key === '__HAS_KEY__' ? '' : (profile.api_key ?? '')}
          onChange={e => set('api_key', e.target.value)}
          placeholder={profile.api_key === '__HAS_KEY__' ? '●●●●●●●● 已保存（留空保留，输入则覆盖）' : '请输入 API Key'}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#07c160] bg-white font-mono dk-input"
        />
        {meta?.auth_hint && (
          <p className="text-[10px] text-gray-400 mt-1">{meta.auth_hint}</p>
        )}
      </div>

      {/* Base URL */}
      <div>
        <label className="block text-[10px] font-bold text-gray-400 mb-1 uppercase tracking-wide">
          Base URL <span className="font-normal normal-case">（留空使用默认）</span>
        </label>
        <input type="text" value={profile.base_url ?? ''} onChange={e => set('base_url', e.target.value)}
          placeholder={meta?.default_base_url ? `默认：${meta.default_base_url}` : '请输入 Base URL'}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#07c160] bg-white font-mono dk-input" />
      </div>

      {/* Model：有 models 推荐列表用 datalist + 输入框 */}
      <div>
        <label className="block text-[10px] font-bold text-gray-400 mb-1 uppercase tracking-wide">
          模型 <span className="font-normal normal-case">（留空使用默认 {meta?.default_model || ''}）</span>
        </label>
        <input type="text" value={profile.model ?? ''} onChange={e => set('model', e.target.value)}
          list={`image-models-${profile.id}`}
          placeholder={meta?.default_model ? `默认：${meta.default_model}` : '请输入模型名'}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#07c160] bg-white font-mono dk-input" />
        {meta?.models && meta.models.length > 0 && (
          <datalist id={`image-models-${profile.id}`}>
            {meta.models.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </datalist>
        )}
        {meta?.price_hint && (
          <p className="text-[10px] text-gray-400 mt-1">{meta.price_hint}</p>
        )}
      </div>

      {/* 测试按钮 */}
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={() => onSaveAndTest(profile.id)}
          disabled={testing}
          className="flex items-center gap-1.5 px-4 py-2 border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 text-sm font-bold rounded-lg hover:border-[#07c160] hover:text-[#07c160] disabled:opacity-50 transition-colors"
        >
          {testing ? <Loader2 size={14} className="animate-spin" /> : <AlertCircle size={14} />}
          保存并测试（生 1 张图）
        </button>
        {testMsg && (
          <span className={`text-sm font-semibold ${testMsg.ok ? 'text-[#07c160]' : 'text-red-500'}`}>
            {testMsg.ok ? '✓ ' : '✕ '}{testMsg.text}
          </span>
        )}
      </div>
      {testMsg?.image && (
        <div className="pt-2">
          <img src={testMsg.image} alt="测试图" className="w-32 h-32 rounded-xl border border-gray-100 dark:border-white/10 object-cover" />
        </div>
      )}
    </div>
  );
};

export const ImageSection: React.FC = () => {
  const [enabled, setEnabled] = useState(false);
  const [providers, setProviders] = useState<ImageProviderMeta[]>([]);
  const [profiles, setProfiles] = useState<ImageProfile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testMsgs, setTestMsgs] = useState<Record<string, { ok: boolean; text: string; image?: string }>>({});

  useEffect(() => {
    // 并行拉 provider 元数据 + 现有偏好
    Promise.all([
      axios.get<{ providers: ImageProviderMeta[] }>('/api/image/providers').then(r => r.data.providers).catch(() => [] as ImageProviderMeta[]),
      axios.get<Record<string, unknown>>('/api/preferences').then(r => r.data).catch(() => ({} as Record<string, unknown>)),
    ]).then(([metas, prefs]) => {
      setProviders(metas);
      setEnabled(Boolean(prefs.image_enabled));
      const arr = (prefs.image_profiles as ImageProfile[] | undefined) ?? [];
      if (arr.length > 0) {
        setProfiles(arr);
      } else {
        // 老用户：把单字段降级成一条默认 profile
        const single: ImageProfile = {
          id: (prefs.image_provider as string) ? 'img-default' : genId(),
          name: '默认',
          provider: (prefs.image_provider as string) || (metas[0]?.value ?? 'doubao'),
          api_key: (prefs.image_api_key as string) ?? '',
          base_url: (prefs.image_base_url as string) ?? '',
          model: (prefs.image_model as string) ?? '',
        };
        setProfiles([single]);
      }
    }).finally(() => setLoaded(true));
  }, []);

  const buildPayload = (overrideProfiles?: ImageProfile[]) => ({
    image_enabled: enabled,
    image_profiles: overrideProfiles ?? profiles,
  });

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      await axios.put('/api/preferences/image', buildPayload());
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
      await axios.put('/api/preferences/image', buildPayload());
      const r = await axios.post<{ ok: boolean; url: string; provider: string; model: string }>('/api/image/test', { profile_id: profileId });
      setTestMsgs(prev => ({ ...prev, [profileId]: { ok: true, text: `连接成功（${r.data.provider} · ${r.data.model}）`, image: r.data.url } }));
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? '连接失败';
      setTestMsgs(prev => ({ ...prev, [profileId]: { ok: false, text: msg } }));
    } finally {
      setTestingId(null);
    }
  };

  const addProfile = () => {
    setProfiles(prev => [...prev, newImageProfile(providers, prev.length + 1)]);
  };

  const updateProfile = (idx: number, updated: ImageProfile) => {
    setProfiles(prev => prev.map((p, i) => i === idx ? updated : p));
  };

  const deleteProfile = (idx: number) => {
    setProfiles(prev => prev.filter((_, i) => i !== idx));
  };

  if (!loaded) return null;

  return (
    <div>
      <p className="text-sm text-gray-400 mb-4">
        用于群年报封面、高光瞬间插画、联系人 AI 头像。所有生图都需要在卡片上手动点「生成」按钮触发，不会自动调用。
        <br />
        生图费用约为文本调用的 10-50 倍。配置多个 provider 后，第一条作为默认；卡片可分别测试。
      </p>

      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4 dk-card dk-border">
        {/* 总开关 */}
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="w-4 h-4 accent-[#07c160]" />
          <span className="text-sm font-bold text-gray-700 dark:text-gray-300">启用 AI 生图</span>
          <span className="text-xs text-gray-400">关闭后所有「生成插画」按钮会被隐藏</span>
        </label>

        {/* Profile 卡片列表 */}
        <div className="space-y-3">
          {profiles.map((p, idx) => (
            <ImageProfileCard
              key={p.id}
              profile={p}
              index={idx}
              total={profiles.length}
              providers={providers}
              onChange={(updated) => updateProfile(idx, updated)}
              onDelete={() => deleteProfile(idx)}
              onSaveAndTest={handleSaveAndTest}
              testing={testingId === p.id}
              testMsg={testMsgs[p.id] ?? null}
            />
          ))}
        </div>

        {/* 增 + 保存 */}
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={addProfile}
            className="flex items-center gap-1.5 px-4 py-2 border border-dashed border-gray-300 dark:border-white/20 text-gray-500 dark:text-gray-400 text-sm font-bold rounded-xl hover:border-[#07c160] hover:text-[#07c160] transition-colors"
          >
            + 增加配置
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-5 py-2.5 bg-[#07c160] text-white text-sm font-bold rounded-xl hover:bg-[#06ad56] disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            保存全部
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
