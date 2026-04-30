/**
 * 断联预警 / Drift Alert
 *
 * GET /api/me/drift —— 找出消息频率从高变低、长期没说话的老朋友。
 * 纯统计、零 LLM、可截图分享，是 ChatDNA 的反向卡片。
 */

import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
  AlertCircle, Loader2, Share2, Check, Clock, Heart, History, Zap, Crown,
} from 'lucide-react';
import html2canvas from 'html2canvas';
import { avatarSrc } from '../../utils/avatar';
import { prepareForCapture } from '../../utils/exportPng';
import { useToast } from '../common/Toast';

interface DriftEntry {
  username: string;
  display_name: string;
  avatar?: string;
  total_messages: number;
  last_message_ts: number;
  last_date: string;
  days_silent: number;
  heartbreak_index: number;
}

interface DriftSummary {
  tier_30_plus: number;
  tier_90_plus: number;
  tier_180_plus: number;
}

interface DriftSuperlatives {
  longest_silent?: DriftEntry;
  biggest_volume?: DriftEntry;
  oldest_friend?: DriftEntry;
}

interface DriftResp {
  today: string;
  total_analyzed: number;
  total_adrift: number;
  summary: DriftSummary;
  top: DriftEntry[];
  superlatives: DriftSuperlatives;
}

const fmtNum = (n: number) => n.toLocaleString('zh-CN');
const fmtDays = (d: number) => {
  if (d < 60) return `${d} 天`;
  if (d < 365) return `${Math.floor(d / 30)} 个月`;
  const years = (d / 365).toFixed(1);
  return `${years} 年`;
};

export const DriftAlert: React.FC = () => {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [data, setData] = useState<DriftResp | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const fetchData = async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await axios.get<DriftResp>('/api/me/drift');
      setData(r.data);
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } }; message?: string })
        ?.response?.data?.error || (e as Error).message || '加载失败';
      setErr(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const exportPng = async () => {
    if (!data || !cardRef.current || exporting) return;
    setExporting(true);
    let wrapper: HTMLElement | null = null;
    try {
      const node = cardRef.current.cloneNode(true) as HTMLElement;
      wrapper = document.createElement('div');
      wrapper.style.cssText = `
        width: 720px; background: #1a0d12; padding: 0;
        font-family: system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
        position: fixed; left: -10000px; top: 0; z-index: -1;
      `;
      wrapper.appendChild(node);
      const footer = document.createElement('div');
      footer.style.cssText =
        'padding:14px 28px; background:#1a0d12; color:#888; font-size:11px; text-align:center; border-top:1px solid rgba(255,255,255,0.06);';
      footer.innerHTML = `WeLink · 断联预警 · ${data.today}`;
      wrapper.appendChild(footer);
      document.body.appendChild(wrapper);
      await prepareForCapture(wrapper);
      const canvas = await html2canvas(wrapper, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#1a0d12',
        logging: false,
      });
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `welink-drift-${Date.now()}.png`;
      a.click();
      setExported(true);
      setTimeout(() => setExported(false), 3000);
    } catch (e) {
      toast.error('导出失败：' + ((e as Error).message || '未知错误'));
    } finally {
      if (wrapper && wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
      setExporting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-4 mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <AlertCircle size={16} className="text-[#ff6b6b]" />
            <div className="text-sm font-bold text-[#1d1d1f] dark:text-gray-100">断联预警</div>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            消息频率从高变低、超过 30 天没说话的老朋友。纯本地统计，无 LLM 调用。
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={fetchData}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white bg-[#ff6b6b] hover:bg-[#ee5252] disabled:opacity-50"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
            {loading ? '统计中…' : data ? '重新统计' : '生成'}
          </button>
          {data && data.total_adrift > 0 && (
            <button
              onClick={exportPng}
              disabled={exporting}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 disabled:opacity-50"
            >
              {exporting ? <Loader2 size={12} className="animate-spin" /> : exported ? <Check size={12} className="text-[#07c160]" /> : <Share2 size={12} />}
              {exporting ? '生成图片…' : exported ? '已下载' : '导出'}
            </button>
          )}
        </div>
      </div>

      {err && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/30 p-3 mb-4 text-xs text-red-700 dark:text-red-300">{err}</div>
      )}

      {loading && !data && (
        <div className="text-center py-16 text-gray-400 text-sm">扫描你的联系人活跃度…</div>
      )}

      {data && data.total_adrift === 0 && (
        <div className="rounded-2xl border border-[#07c160]/30 bg-[#07c160]/5 p-8 text-center">
          <div className="text-4xl mb-3">🎉</div>
          <div className="text-base font-bold text-[#07c160] mb-1">关系网络很健康</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            分析了 {data.total_analyzed} 位高频联系人，没有人超过 30 天没说话。
          </div>
        </div>
      )}

      {data && data.total_adrift > 0 && (
        <div ref={cardRef} className="rounded-2xl overflow-hidden bg-[#1a0d12] text-white">
          {/* Hero —— 暖色警示，跟 DNA 的绿色形成"两面镜子"的视觉对照 */}
          <div className="px-7 py-8 bg-gradient-to-br from-[#ff6b6b] to-[#c92a2a]">
            <div className="text-xs uppercase tracking-[0.2em] text-white/80 font-bold mb-2">
              DRIFT ALERT · 断联预警
            </div>
            <div className="text-3xl font-black mb-3 leading-tight">
              你有 <span className="text-white">{fmtNum(data.total_adrift)}</span> 位老朋友<br/>已经超过 30 天没和你说话
            </div>
            <div className="text-xs text-white/85">
              在 {data.total_analyzed} 位高频联系人里筛出 · {data.today}
            </div>
          </div>

          {/* 三档分级 */}
          <div className="grid grid-cols-3 gap-px bg-white/5">
            <Tier label="30+ 天" count={data.summary.tier_30_plus} sub="开始疏远" color="#ffa94d" />
            <Tier label="90+ 天" count={data.summary.tier_90_plus} sub="深度断联" color="#ff6b6b" />
            <Tier label="180+ 天" count={data.summary.tier_180_plus} sub="几乎失联" color="#c92a2a" />
          </div>

          {/* 之最 */}
          {(data.superlatives.longest_silent || data.superlatives.biggest_volume || data.superlatives.oldest_friend) && (
            <div className="px-7 py-5 border-t border-white/5 space-y-3">
              <SectionTitle icon={<Crown size={14} className="text-[#ffa94d]" />}>断联之最</SectionTitle>
              {data.superlatives.longest_silent && (
                <SuperlativeCard
                  icon={<Clock size={14} className="text-[#ffa94d]" />}
                  title={`静默最久 · ${data.superlatives.longest_silent.display_name}`}
                  desc={`已经 ${fmtDays(data.superlatives.longest_silent.days_silent)} 没说话（共聊过 ${fmtNum(data.superlatives.longest_silent.total_messages)} 条）`}
                  avatar={data.superlatives.longest_silent.avatar}
                />
              )}
              {data.superlatives.biggest_volume &&
                data.superlatives.biggest_volume.username !== data.superlatives.longest_silent?.username && (
                <SuperlativeCard
                  icon={<Heart size={14} className="text-[#ff6b6b]" />}
                  title={`曾经最熟 · ${data.superlatives.biggest_volume.display_name}`}
                  desc={`一起聊过 ${fmtNum(data.superlatives.biggest_volume.total_messages)} 条，但已 ${fmtDays(data.superlatives.biggest_volume.days_silent)} 没联系`}
                  avatar={data.superlatives.biggest_volume.avatar}
                />
              )}
              {data.superlatives.oldest_friend &&
                data.superlatives.oldest_friend.username !== data.superlatives.longest_silent?.username &&
                data.superlatives.oldest_friend.username !== data.superlatives.biggest_volume?.username && (
                <SuperlativeCard
                  icon={<History size={14} className="text-[#ffa94d]" />}
                  title={`认识最久 · ${data.superlatives.oldest_friend.display_name}`}
                  desc={`这位老朋友已经 ${fmtDays(data.superlatives.oldest_friend.days_silent)} 没联系了`}
                  avatar={data.superlatives.oldest_friend.avatar}
                />
              )}
            </div>
          )}

          {/* Top 榜单 */}
          {data.top.length > 0 && (
            <div className="px-7 py-5 border-t border-white/5">
              <SectionTitle icon={<AlertCircle size={14} className="text-[#ff6b6b]" />}>
                心碎指数 Top {data.top.length}
              </SectionTitle>
              <div className="space-y-2">
                {data.top.map((e, i) => (
                  <div key={e.username} className="flex items-center gap-3">
                    <div className="text-[#ff6b6b] font-black text-sm w-6 text-center">{i + 1}</div>
                    {e.avatar ? (
                      <img src={avatarSrc(e.avatar) || ''} className="w-8 h-8 rounded-full object-cover bg-white/10" alt="" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-white/10" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{e.display_name}</div>
                      <div className="text-[11px] text-white/50">
                        共 {fmtNum(e.total_messages)} 条 · 上次 {e.last_date}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-black text-[#ff6b6b]">{fmtDays(e.days_silent)}</div>
                      <div className="text-[10px] text-white/40">没说话</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CTA */}
          <div className="px-7 py-5 border-t border-white/5 bg-white/[0.02] text-center">
            <div className="text-sm text-white/85 leading-relaxed">
              要不要今天挑一个，发条消息？<br/>
              <span className="text-[11px] text-white/40">关系最怕的从来不是吵架，是没声音了。</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const Tier: React.FC<{ label: string; count: number; sub: string; color: string }> = ({ label, count, sub, color }) => (
  <div className="px-5 py-4 bg-[#1a0d12]">
    <div className="text-[11px] uppercase tracking-wider font-bold mb-1.5" style={{ color }}>{label}</div>
    <div className="text-2xl font-black tracking-tight">{count.toLocaleString('zh-CN')}<span className="text-[11px] text-white/40 ml-1 font-normal">人</span></div>
    <div className="text-[10px] text-white/40 mt-0.5">{sub}</div>
  </div>
);

const SectionTitle: React.FC<{ icon: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
  <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-white/60 font-bold mb-3">{icon}{children}</div>
);

const SuperlativeCard: React.FC<{ icon: React.ReactNode; title: string; desc: string; avatar?: string }> = ({ icon, title, desc, avatar }) => (
  <div className="flex items-center gap-3 rounded-xl bg-white/5 p-3">
    {avatar ? (
      <img src={avatarSrc(avatar) || ''} className="w-10 h-10 rounded-full object-cover bg-white/10" alt="" />
    ) : (
      <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">{icon}</div>
    )}
    <div className="min-w-0">
      <div className="text-sm font-bold flex items-center gap-1.5">{icon}<span className="truncate">{title}</span></div>
      <div className="text-[11px] text-white/60 truncate">{desc}</div>
    </div>
  </div>
);

export default DriftAlert;
