import React, { useState, useEffect } from 'react';
import { Sparkles, Loader2, AlertCircle, Copy, ExternalLink } from 'lucide-react';
import axios from 'axios';
import { openProviderUrl } from '../constants';

// 都兼容 OpenAI /audio/speech 协议；keyUrl 为 '' 表示自建/免费（本地）无需注册
interface TtsPreset {
  label: string;
  baseUrl: string;
  model: string;
  voiceA: string;
  voiceB: string;
  keyUrl: string;
  desc: string;
}

const TTS_PRESETS: TtsPreset[] = [
  {
    label: 'OpenAI 官方',
    baseUrl: 'https://api.openai.com/v1',
    model: 'tts-1',
    voiceA: 'alloy',
    voiceB: 'nova',
    keyUrl: 'https://platform.openai.com/api-keys',
    desc: '官方 TTS，英文最佳；需海外账号',
  },
  {
    label: '硅基流动 SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'FunAudioLLM/CosyVoice2-0.5B',
    voiceA: 'FunAudioLLM/CosyVoice2-0.5B:alex',
    voiceB: 'FunAudioLLM/CosyVoice2-0.5B:anna',
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    desc: '国内友好，支持 CosyVoice 高质量中文',
  },
  {
    label: '自建 Edge-TTS',
    // 默认 host.docker.internal：WeLink backend 跑在容器里时，localhost 指容器自身
    // 连不到宿主机上 `docker run edge-tts` 暴露的 :5050。host.docker.internal 会解到
    // 宿主网关。App / bare go run 的用户可手动改回 localhost。
    baseUrl: 'http://host.docker.internal:5050/v1',
    model: 'tts-1',
    voiceA: 'zh-CN-YunxiNeural',
    voiceB: 'zh-CN-XiaoyiNeural',
    keyUrl: '',
    desc: '本地 openai-edge-tts 代理，完全免费',
  },
];

export const TtsSection: React.FC = () => {
  // 播客 TTS 配置
  const [ttsConfig, setTtsConfig] = useState({
    base_url: '',
    model: '',
    voice_a: '',
    voice_b: '',
    api_key: '',
    has_key: false,
  });
  const [ttsSaving, setTtsSaving] = useState(false);
  const [ttsSaveMsg, setTtsSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [ttsTesting, setTtsTesting] = useState(false);
  const [ttsTestMsg, setTtsTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    axios.get<{ base_url: string; has_key: boolean; model: string; voice_a: string; voice_b: string }>('/api/podcast/config')
      .then(r => setTtsConfig(c => ({ ...c, ...r.data, api_key: r.data.has_key ? '__HAS_KEY__' : '' })))
      .catch(() => { /* 忽略 */ });
  }, []);

  const saveTtsConfig = async () => {
    setTtsSaving(true);
    setTtsSaveMsg(null);
    try {
      await axios.put('/api/podcast/config', {
        base_url: ttsConfig.base_url,
        api_key: ttsConfig.api_key,
        model: ttsConfig.model,
        voice_a: ttsConfig.voice_a,
        voice_b: ttsConfig.voice_b,
      });
      setTtsSaveMsg({ ok: true, text: '已保存' });
      setTtsConfig(c => ({ ...c, api_key: '__HAS_KEY__', has_key: c.api_key ? true : c.has_key }));
    } catch (e: unknown) {
      const anyE = e as { response?: { data?: { error?: string } }; message?: string };
      setTtsSaveMsg({ ok: false, text: anyE?.response?.data?.error || anyE?.message || '保存失败' });
    } finally {
      setTtsSaving(false);
    }
  };

  // 先保存（幂等），再用一句短文本跑 /api/podcast/tts，验证 base_url + key 都通。
  // 走真实合成链路，不走单独 mock，连接上有任何问题都会暴露在这里。
  const testTtsConfig = async () => {
    setTtsTesting(true);
    setTtsTestMsg(null);
    try {
      await axios.put('/api/podcast/config', {
        base_url: ttsConfig.base_url,
        api_key: ttsConfig.api_key,
        model: ttsConfig.model,
        voice_a: ttsConfig.voice_a,
        voice_b: ttsConfig.voice_b,
      });
      setTtsConfig(c => ({ ...c, api_key: '__HAS_KEY__', has_key: c.api_key ? true : c.has_key }));
      const resp = await axios.post('/api/podcast/tts', { text: '测试', speaker: 'A' }, { responseType: 'blob' });
      const blob = resp.data as Blob;
      if (blob.size > 200) {
        setTtsTestMsg({ ok: true, text: `连接正常（收到 ${(blob.size / 1024).toFixed(1)} KB 音频）` });
      } else {
        // 后端错误也可能带 200，但 blob 很小（JSON 错误字符串）
        try {
          const j = JSON.parse(await blob.text());
          setTtsTestMsg({ ok: false, text: j.error || '音频过小，疑似异常' });
        } catch {
          setTtsTestMsg({ ok: false, text: '音频过小，疑似异常' });
        }
      }
    } catch (e: unknown) {
      const anyE = e as { response?: { data?: unknown }; message?: string };
      let msg = anyE?.message || '测试失败';
      const d = anyE?.response?.data;
      if (d instanceof Blob) {
        try {
          const t = await d.text();
          const j = JSON.parse(t);
          msg = j.error || t;
        } catch { /* 非 JSON 就用默认 msg */ }
      } else if (d && typeof d === 'object' && 'error' in d) {
        msg = (d as { error: string }).error;
      }
      setTtsTestMsg({ ok: false, text: msg });
    } finally {
      setTtsTesting(false);
    }
  };

  return (
    <section className="mb-8" data-section-id="tts" data-settings-tags="播客 podcast tts 语音 朗读 openai voice 主持人 硅基流动 siliconflow edge-tts">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={18} className="text-pink-500" />
        <h3 className="text-base font-bold text-[#1d1d1f] dk-text">朗读 TTS 配置（播客 + AI 分析朗读）</h3>
      </div>
      <p className="text-sm text-gray-400 mb-4">一处配置，两处用：<strong>「🎙 播客」</strong>合成双主持人对话 + 所有 AI 回答旁的<strong>「🔊 朗读」</strong>按钮（洞察卡 / 对话分析 / 分身 / 破冰 / 跨联系人问答 / 群年报）。兼容 OpenAI <code className="text-[11px]">/audio/speech</code> 协议的任何服务</p>
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 dk-card dk-border space-y-3">
        {/* 推荐服务 —— 一键填充 Base URL / 模型 / 默认声音 */}
        <div>
          <label className="text-xs text-gray-500 font-semibold block mb-2">推荐服务（点击一键填充）</label>
          <div className="flex flex-wrap gap-2">
            {TTS_PRESETS.map(preset => (
              <button
                key={preset.label}
                type="button"
                onClick={() => setTtsConfig(c => ({
                  ...c,
                  base_url: preset.baseUrl,
                  model: preset.model,
                  voice_a: preset.voiceA,
                  voice_b: preset.voiceB,
                  // 切换服务时 api_key 可能失效，置空让用户重填
                  api_key: '',
                }))}
                className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 hover:border-[#07c160] hover:bg-[#07c160]/5 hover:text-[#07c160] transition-colors"
                title={preset.desc}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* 自建 Edge-TTS 命中时的快速入门卡 */}
        {ttsConfig.base_url && /:5050(\/|$)/.test(ttsConfig.base_url) && (
          <div className="rounded-xl border border-blue-100 dark:border-blue-500/30 bg-blue-50/70 dark:bg-blue-500/10 p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-blue-700 dark:text-blue-400 uppercase tracking-wide">
              <AlertCircle size={12} />
              自建 Edge-TTS 快速上手
            </div>
            <p className="text-[11px] text-blue-800/80 dark:text-blue-300/80 leading-relaxed">
              <strong className="font-bold">Ollama 不支持 TTS</strong>。本预设使用 <code className="bg-white/60 dark:bg-black/30 px-1 rounded text-[10px]">openai-edge-tts</code> 把微软 Edge TTS 云端服务包装成 OpenAI 协议，**免费**、声音丰富，但需网络可通微软云。一条 docker 命令即可启动：
            </p>
            <div className="flex items-center gap-2 bg-white dark:bg-black/30 rounded-lg px-2.5 py-1.5 border border-blue-100 dark:border-blue-500/20">
              <code className="flex-1 text-[11px] font-mono text-gray-700 dark:text-gray-200 break-all">docker run -d --name edge-tts -p 5050:5050 -e REQUIRE_API_KEY=false travisvn/openai-edge-tts</code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText('docker run -d --name edge-tts -p 5050:5050 -e REQUIRE_API_KEY=false travisvn/openai-edge-tts').catch(() => {});
                }}
                className="flex-shrink-0 p-1 rounded text-gray-400 hover:text-[#07c160] transition-colors"
                title="复制命令"
              >
                <Copy size={12} />
              </button>
            </div>
            <p className="text-[11px] text-blue-800/80 dark:text-blue-300/80 leading-relaxed">
              上面的 <code className="bg-white/60 dark:bg-black/30 px-1 rounded text-[10px]">REQUIRE_API_KEY=false</code> 关掉服务端鉴权，API Key 字段可留空。若省略该参数，服务端默认 <code className="bg-white/60 dark:bg-black/30 px-1 rounded text-[10px]">API_KEY=your_api_key_here</code>，需原样填入此 Key 字段。<br/>
              <strong>WeLink 跑在 docker 里时</strong>请用预设里的 <code className="bg-white/60 dark:bg-black/30 px-1 rounded text-[10px]">http://host.docker.internal:5050/v1</code>（容器内 localhost 不等于宿主机）。声音字段支持所有 <code className="bg-white/60 dark:bg-black/30 px-1 rounded text-[10px]">zh-CN-*Neural</code> 等微软 Neural 声音名。完整声音列表见{' '}
              <button
                type="button"
                onClick={() => openProviderUrl('https://speech.microsoft.com/portal/voicegallery')}
                className="inline-flex items-center gap-0.5 font-semibold text-blue-600 dark:text-blue-300 hover:underline"
              >
                微软语音库 <ExternalLink size={10} />
              </button>
              ；项目地址{' '}
              <button
                type="button"
                onClick={() => openProviderUrl('https://github.com/travisvn/openai-edge-tts')}
                className="inline-flex items-center gap-0.5 font-semibold text-blue-600 dark:text-blue-300 hover:underline"
              >
                travisvn/openai-edge-tts <ExternalLink size={10} />
              </button>
              。
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 font-semibold block mb-1">Base URL</label>
            <input
              type="text"
              value={ttsConfig.base_url}
              onChange={(e) => setTtsConfig(c => ({ ...c, base_url: e.target.value }))}
              placeholder="https://api.openai.com/v1"
              className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-sm dk-text outline-none focus:border-[#07c160]"
            />
          </div>
          <div>
            <label className="flex items-center gap-2 text-xs text-gray-500 font-semibold mb-1">
              <span>API Key</span>
              {(() => {
                const matched = TTS_PRESETS.find(p => ttsConfig.base_url && ttsConfig.base_url.startsWith(p.baseUrl.replace(/\/v1$/, '')) && p.keyUrl);
                return matched && (
                  <button
                    type="button"
                    onClick={() => openProviderUrl(matched.keyUrl)}
                    className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold normal-case tracking-normal bg-[#07c160]/10 dark:bg-[#07c160]/20 text-[#07c160] hover:bg-[#07c160]/20 dark:hover:bg-[#07c160]/30 transition-colors"
                    title={matched.keyUrl}
                  >
                    获取 Key
                    <ExternalLink size={10} />
                  </button>
                );
              })()}
            </label>
            <input
              type="password"
              value={ttsConfig.api_key === '__HAS_KEY__' ? '' : ttsConfig.api_key}
              placeholder={ttsConfig.has_key ? '已配置（输入新值覆盖）' : 'sk-...'}
              onChange={(e) => setTtsConfig(c => ({ ...c, api_key: e.target.value }))}
              className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-sm dk-text outline-none focus:border-[#07c160]"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 font-semibold block mb-1">模型</label>
            <input
              type="text"
              value={ttsConfig.model}
              onChange={(e) => setTtsConfig(c => ({ ...c, model: e.target.value }))}
              placeholder="tts-1 / FunAudioLLM/CosyVoice2-0.5B / ..."
              list="tts-model-suggestions"
              className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-sm dk-text outline-none focus:border-[#07c160]"
            />
            <datalist id="tts-model-suggestions">
              <option value="tts-1" />
              <option value="tts-1-hd" />
              <option value="FunAudioLLM/CosyVoice2-0.5B" />
            </datalist>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500 font-semibold block mb-1">主持人 A 声音</label>
              <input
                type="text"
                value={ttsConfig.voice_a}
                onChange={(e) => setTtsConfig(c => ({ ...c, voice_a: e.target.value }))}
                placeholder="alloy"
                list="tts-voice-suggestions"
                className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-sm dk-text outline-none focus:border-[#07c160]"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 font-semibold block mb-1">主持人 B 声音</label>
              <input
                type="text"
                value={ttsConfig.voice_b}
                onChange={(e) => setTtsConfig(c => ({ ...c, voice_b: e.target.value }))}
                placeholder="nova"
                list="tts-voice-suggestions"
                className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-sm dk-text outline-none focus:border-[#07c160]"
              />
            </div>
            <datalist id="tts-voice-suggestions">
              <option value="alloy">OpenAI · 中性</option>
              <option value="echo">OpenAI · 男</option>
              <option value="onyx">OpenAI · 低沉男</option>
              <option value="fable">OpenAI · 英式</option>
              <option value="nova">OpenAI · 女</option>
              <option value="shimmer">OpenAI · 温柔女</option>
              <option value="FunAudioLLM/CosyVoice2-0.5B:alex">CosyVoice · alex</option>
              <option value="FunAudioLLM/CosyVoice2-0.5B:anna">CosyVoice · anna</option>
              <option value="FunAudioLLM/CosyVoice2-0.5B:bella">CosyVoice · bella</option>
              <option value="FunAudioLLM/CosyVoice2-0.5B:benjamin">CosyVoice · benjamin</option>
              <option value="zh-CN-YunxiNeural">Edge · 云希（男）</option>
              <option value="zh-CN-XiaoyiNeural">Edge · 晓伊（女）</option>
              <option value="zh-CN-XiaoxiaoNeural">Edge · 晓晓（女）</option>
              <option value="zh-CN-YunyangNeural">Edge · 云扬（男）</option>
            </datalist>
          </div>
        </div>
        <div className="flex items-center gap-2 pt-2 flex-wrap">
          <button
            onClick={saveTtsConfig}
            disabled={ttsSaving || ttsTesting}
            className="px-4 py-2 rounded-xl bg-[#07c160] text-white text-sm font-semibold hover:bg-[#06ad56] disabled:opacity-50 flex items-center gap-1.5"
          >
            {ttsSaving && <Loader2 size={14} className="animate-spin" />}
            保存
          </button>
          <button
            onClick={testTtsConfig}
            disabled={ttsSaving || ttsTesting}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 dark:border-white/10 text-gray-500 dark:text-gray-400 text-xs font-bold rounded-lg hover:border-[#07c160] hover:text-[#07c160] disabled:opacity-50 transition-colors"
            title="会调用一次 TTS 合成一句短音频，验证 Base URL / API Key 是否可用"
          >
            {ttsTesting ? <Loader2 size={12} className="animate-spin" /> : <AlertCircle size={12} />}
            测试连接
          </button>
          {ttsSaveMsg && !ttsTestMsg && (
            <span className={`text-xs ${ttsSaveMsg.ok ? 'text-[#07c160]' : 'text-red-500'}`}>
              {ttsSaveMsg.text}
            </span>
          )}
          {ttsTestMsg && (
            <span className={`text-xs font-semibold ${ttsTestMsg.ok ? 'text-[#07c160]' : 'text-red-500'}`}>
              {ttsTestMsg.ok ? '✓ ' : '✕ '}{ttsTestMsg.text}
            </span>
          )}
        </div>
        <p className="text-[11px] text-gray-400 leading-relaxed">
          官方 OpenAI 声音：alloy / echo / onyx / fable / nova / shimmer。<br />
          硅基流动 CosyVoice：用 <code>模型:voiceId</code> 格式，如 <code>FunAudioLLM/CosyVoice2-0.5B:alex</code>。<br />
          自建 Edge-TTS 网关：用微软 Neural 声音名，如 <code>zh-CN-YunxiNeural</code>。详见{' '}
          <a href="https://welink.click/podcast.html" target="_blank" rel="noreferrer" className="text-[#07c160] hover:underline">播客文档</a>。
        </p>
      </div>
    </section>
  );
};
