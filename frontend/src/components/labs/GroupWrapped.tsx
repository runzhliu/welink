/**
 * 群聊 Wrapped —— 单个群的统计卡片
 *
 * 选群（≥ 100 条消息的群）→ GET /api/groups/wrapped?room=...
 * 与 group-year-review（AI 叙事年报）区分：这个完全不调 LLM，
 * 强调 Spotify Wrapped 风格的可截图卡片。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  Sparkles, Loader2, Search, Wand2, Share2, Check, Crown, Clock, AtSign, Quote,
  Sunrise, Moon, Image as ImageIcon, Mic, Video, FileText, Smile, Hash,
} from 'lucide-react';
import html2canvas from 'html2canvas';
import { groupsApi } from '../../services/api';
import type { GroupInfo } from '../../types';
import { avatarSrc } from '../../utils/avatar';
import { prepareForCapture } from '../../utils/exportPng';
import { useToast } from '../common/Toast';

interface GWMember {
  username: string;
  display_name: string;
  avatar_url?: string;
  messages: number;
}
interface GWMediaChampion {
  speaker: string;
  display_name: string;
  avatar_url?: string;
  count: number;
  kind: 'image' | 'voice' | 'video' | 'file';
  label: string;
}
interface GWLongest {
  speaker: string;
  display_name: string;
  avatar_url?: string;
  length: number;
  date?: string;
  content: string;
}
interface GWMention { name: string; count: number; }
interface GWPhrase { text: string; count: number; }
interface GWEmoji { emoji: string; count: number; }
interface GWNocturnal {
  speaker: string;
  display_name: string;
  avatar_url?: string;
  count: number;
}
interface GWResp {
  group_name: string;
  avatar?: string;
  room_id: string;
  total_messages: number;
  historical_total: number;
  truncated: boolean;
  active_days: number;
  member_count: number;
  first_date?: string;
  last_date?: string;
  peak_hour: number;
  peak_hour_pct: number;
  busiest_day?: string;
  busiest_day_count: number;
  top_members: GWMember[];
  most_mentioned?: GWMention;
  media_champions: GWMediaChampion[];
  early_bird?: GWNocturnal;
  night_owl?: GWNocturnal;
  longest_message?: GWLongest;
  top_emojis: GWEmoji[];
  top_phrases: GWPhrase[];
}

const fmtNum = (n: number) => n.toLocaleString('zh-CN');

const MEDIA_ICON: Record<string, React.ReactNode> = {
  image: <ImageIcon size={14} />,
  voice: <Mic size={14} />,
  video: <Video size={14} />,
  file: <FileText size={14} />,
};

export const GroupWrapped: React.FC = () => {
  const toast = useToast();
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [picked, setPicked] = useState<GroupInfo | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [data, setData] = useState<GWResp | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // 拉群列表（懒加载，第一次进入这个 lab 时才请求）
  useEffect(() => {
    let cancelled = false;
    setGroupsLoading(true);
    groupsApi.getList()
      .then(d => { if (!cancelled) setGroups(d || []); })
      .catch(() => { /* 静默 */ })
      .finally(() => { if (!cancelled) setGroupsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // 搜索 + 阈值过滤（≥ 100 条消息才能 Wrapped）
  const filtered = useMemo(() => {
    const base = groups.filter(g => (g.total_messages || 0) >= 100);
    base.sort((a, b) => (b.total_messages || 0) - (a.total_messages || 0));
    const q = search.trim().toLowerCase();
    if (!q) return base.slice(0, 80);
    return base.filter(g => (g.name || '').toLowerCase().includes(q)).slice(0, 80);
  }, [groups, search]);

  const generate = async () => {
    if (!picked || loading) return;
    setLoading(true);
    setErr('');
    setData(null);
    try {
      const r = await axios.get<GWResp>('/api/groups/wrapped', { params: { room: picked.username } });
      setData(r.data);
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } }; message?: string })
        ?.response?.data?.error || (e as Error).message || '生成失败';
      setErr(msg);
    } finally {
      setLoading(false);
    }
  };

  const exportPng = async () => {
    if (!data || !cardRef.current || exporting) return;
    setExporting(true);
    let wrapper: HTMLElement | null = null;
    try {
      const node = cardRef.current.cloneNode(true) as HTMLElement;
      wrapper = document.createElement('div');
      wrapper.style.cssText = `
        width: 720px; background: #0b0b14; padding: 0;
        font-family: system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
        position: fixed; left: -10000px; top: 0; z-index: -1;
      `;
      wrapper.appendChild(node);
      const footer = document.createElement('div');
      footer.style.cssText =
        'padding:14px 28px; background:#0b0b14; color:#888; font-size:11px; text-align:center; border-top:1px solid rgba(255,255,255,0.06);';
      footer.innerHTML = `WeLink · 群聊 Wrapped · ${new Date().toLocaleDateString('zh-CN')}`;
      wrapper.appendChild(footer);
      document.body.appendChild(wrapper);
      await prepareForCapture(wrapper);
      const canvas = await html2canvas(wrapper, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#0b0b14',
        logging: false,
      });
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `welink-group-wrapped-${Date.now()}.png`;
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
      {/* 选群 */}
      <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={16} className="text-[#07c160]" />
          <div className="text-sm font-bold text-[#1d1d1f] dark:text-gray-100">挑一个群，浓缩成一张 Wrapped 卡</div>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          消息 ≥ 100 条的群可生成。统计内容：发言榜、最常被 @、媒体大王、早鸟夜猫子、最长一句话、Top emoji、群口头禅。
          纯统计、无 LLM、即时返回。
        </div>
        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜群名"
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-gray-50 dark:bg-white/5 text-sm text-[#1d1d1f] dark:text-gray-100 border border-transparent focus:border-[#07c160] outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-1.5 max-h-44 overflow-y-auto">
          {groupsLoading && groups.length === 0 && (
            <div className="text-xs text-gray-400 py-4 px-2">加载群列表…</div>
          )}
          {!groupsLoading && filtered.length === 0 && (
            <div className="text-xs text-gray-400 py-4 px-2">没有满足条件的群（消息需 ≥ 100 条）</div>
          )}
          {filtered.map(g => {
            const sel = picked?.username === g.username;
            return (
              <button
                key={g.username}
                onClick={() => setPicked(g)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs transition-colors ${
                  sel
                    ? 'bg-[#07c160] text-white font-bold'
                    : 'bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10'
                }`}
              >
                {g.small_head_url && (
                  <img src={avatarSrc(g.small_head_url) || ''} alt="" className="w-4 h-4 rounded-full object-cover" />
                )}
                <span className="max-w-[14em] truncate">{g.name || g.username}</span>
                <span className={`text-[10px] ${sel ? 'opacity-80' : 'text-gray-400'}`}>
                  {fmtNum(g.total_messages || 0)}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between mt-3">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {picked
              ? <>已选：<strong className="text-[#1d1d1f] dark:text-gray-100">{picked.name || picked.username}</strong></>
              : '请先选一个群'}
          </div>
          <button
            onClick={generate}
            disabled={!picked || loading}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-[#07c160] hover:bg-[#06a850] disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
            {loading ? '生成中…' : data ? '重新生成' : '生成 Wrapped'}
          </button>
        </div>
      </div>

      {err && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/30 p-3 mb-4 text-xs text-red-700 dark:text-red-300">
          {err}
        </div>
      )}

      {data && (
        <>
          <div className="flex justify-end mb-2">
            <button
              onClick={exportPng}
              disabled={exporting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 disabled:opacity-50"
            >
              {exporting ? <Loader2 size={12} className="animate-spin" />
                : exported ? <Check size={12} className="text-[#07c160]" />
                : <Share2 size={12} />}
              {exporting ? '生成图片…' : exported ? '已下载' : '导出分享图'}
            </button>
          </div>

          <div ref={cardRef} className="rounded-2xl overflow-hidden bg-[#0b0b14] text-white">
            {/* Hero */}
            <div className="px-7 py-8 bg-gradient-to-br from-[#07c160] to-[#10aeff]">
              <div className="text-xs uppercase tracking-[0.2em] text-white/80 font-bold mb-2">
                GROUP WRAPPED · 群聊年度卡
              </div>
              <div className="text-3xl font-black mb-3 leading-tight">
                {data.group_name}<br/>
                <span className="text-white">{fmtNum(data.total_messages)}</span> 条消息 · {fmtNum(data.active_days)} 个活跃日
              </div>
              <div className="text-xs text-white/85">
                {data.first_date && <>{data.first_date} → {data.last_date} · </>}
                {fmtNum(data.member_count)} 位成员发过言
                {data.truncated && <> · 仅展示最近 {fmtNum(data.total_messages)} 条</>}
              </div>
            </div>

            {/* 基础数 grid */}
            <div className="grid grid-cols-2 gap-px bg-white/5">
              <Stat icon={<Clock size={14} />} label="峰值时段" value={`${data.peak_hour}:00`} sub={`${(data.peak_hour_pct * 100).toFixed(0)}% 的消息发生在这小时`} />
              <Stat icon={<Hash size={14} />} label="最忙的一天" value={data.busiest_day || '—'} sub={data.busiest_day_count ? `${fmtNum(data.busiest_day_count)} 条消息` : ''} />
            </div>

            {/* Top 发言榜 */}
            {data.top_members.length > 0 && (
              <div className="px-7 py-5 border-t border-white/5">
                <SectionTitle icon={<Crown size={14} className="text-[#07c160]" />}>发言榜 Top {data.top_members.length}</SectionTitle>
                <div className="space-y-2.5">
                  {data.top_members.map((m, i) => (
                    <div key={m.username} className="flex items-center gap-3">
                      <div className="text-[#07c160] font-black text-lg w-5 text-center">{i + 1}</div>
                      {m.avatar_url ? (
                        <img src={avatarSrc(m.avatar_url) || ''} className="w-9 h-9 rounded-full object-cover bg-white/10" alt="" />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-white/10" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">{m.display_name}</div>
                        <div className="text-[11px] text-white/50">{fmtNum(m.messages)} 条消息</div>
                      </div>
                      <div className="w-24 h-2 rounded-full bg-white/5 overflow-hidden">
                        <div
                          className="h-full bg-[#07c160]"
                          style={{ width: `${(m.messages / data.top_members[0].messages) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 角色卡：最常被 @ / 早鸟 / 夜猫子 / 最长一句话 */}
            {(data.most_mentioned || data.early_bird || data.night_owl || data.longest_message) && (
              <div className="px-7 py-5 border-t border-white/5 space-y-3">
                <SectionTitle icon={<Sparkles size={14} className="text-[#07c160]" />}>角色之最</SectionTitle>
                {data.most_mentioned && (
                  <BadgeCard
                    icon={<AtSign size={14} className="text-[#07c160]" />}
                    title={`最常被 @ · ${data.most_mentioned.name}`}
                    desc={`被 cue 了 ${data.most_mentioned.count} 次`}
                  />
                )}
                {data.early_bird && (
                  <BadgeCard
                    icon={<Sunrise size={14} className="text-[#ffa94d]" />}
                    title={`早鸟 · ${data.early_bird.display_name}`}
                    desc={`5–9 点发了 ${data.early_bird.count} 条消息`}
                    avatar={data.early_bird.avatar_url}
                  />
                )}
                {data.night_owl && (
                  <BadgeCard
                    icon={<Moon size={14} className="text-[#a78bfa]" />}
                    title={`夜猫子 · ${data.night_owl.display_name}`}
                    desc={`23–3 点发了 ${data.night_owl.count} 条消息`}
                    avatar={data.night_owl.avatar_url}
                  />
                )}
                {data.longest_message && (
                  <BadgeCard
                    icon={<Quote size={14} className="text-[#07c160]" />}
                    title={`最长一句话 · ${data.longest_message.display_name}（${data.longest_message.length} 字）`}
                    desc={data.longest_message.content}
                    avatar={data.longest_message.avatar_url}
                  />
                )}
              </div>
            )}

            {/* 媒体大王 */}
            {data.media_champions.length > 0 && (
              <div className="px-7 py-5 border-t border-white/5">
                <SectionTitle icon={<ImageIcon size={14} className="text-[#10aeff]" />}>媒体大王</SectionTitle>
                <div className="flex flex-wrap gap-2">
                  {data.media_champions.map(mc => (
                    <div key={mc.kind} className="inline-flex items-center gap-2 bg-white/5 rounded-xl px-3 py-2">
                      <span className="text-[#10aeff]">{MEDIA_ICON[mc.kind]}</span>
                      {mc.avatar_url && (
                        <img src={avatarSrc(mc.avatar_url) || ''} className="w-5 h-5 rounded-full object-cover" alt="" />
                      )}
                      <span className="text-xs">
                        <span className="font-bold">{mc.label}</span>
                        <span className="text-white/60 ml-1">{mc.display_name}</span>
                        <span className="text-white/40 ml-1">×{mc.count}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Top emoji + 群口头禅 */}
            <div className="grid grid-cols-2 gap-px bg-white/5">
              <div className="px-7 py-5">
                <SectionTitle icon={<Smile size={14} className="text-[#07c160]" />}>最爱用的 emoji</SectionTitle>
                {data.top_emojis.length === 0 ? (
                  <div className="text-xs text-white/40">没找到 emoji 痕迹</div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {data.top_emojis.map(e => (
                      <div key={e.emoji} className="inline-flex items-center gap-1 bg-white/5 rounded-lg px-2 py-1 text-sm">
                        <span>{e.emoji}</span>
                        <span className="text-[10px] text-white/40">×{e.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="px-7 py-5">
                <SectionTitle icon={<Quote size={14} className="text-[#07c160]" />}>群口头禅</SectionTitle>
                {data.top_phrases.length === 0 ? (
                  <div className="text-xs text-white/40">还没有典型用语</div>
                ) : (
                  <div className="space-y-1.5">
                    {data.top_phrases.map(p => (
                      <div key={p.text} className="flex items-center justify-between text-sm">
                        <span className="text-white/90 truncate">{p.text}</span>
                        <span className="text-[10px] text-white/40 ml-2 shrink-0">×{p.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

const Stat: React.FC<{ icon: React.ReactNode; label: string; value: string; sub?: string }> = ({ icon, label, value, sub }) => (
  <div className="px-5 py-4 bg-[#0b0b14]">
    <div className="flex items-center gap-1.5 text-[11px] text-white/50 mb-1.5">{icon}{label}</div>
    <div className="text-2xl font-black tracking-tight">{value}</div>
    {sub && <div className="text-[10px] text-white/40 mt-0.5">{sub}</div>}
  </div>
);

const SectionTitle: React.FC<{ icon: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
  <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-white/60 font-bold mb-3">{icon}{children}</div>
);

const BadgeCard: React.FC<{ icon: React.ReactNode; title: string; desc: string; avatar?: string }> = ({ icon, title, desc, avatar }) => (
  <div className="flex items-start gap-3 rounded-xl bg-white/5 p-3">
    {avatar ? (
      <img src={avatarSrc(avatar) || ''} className="w-10 h-10 rounded-full object-cover bg-white/10 shrink-0" alt="" />
    ) : (
      <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center shrink-0">{icon}</div>
    )}
    <div className="min-w-0">
      <div className="text-sm font-bold flex items-center gap-1.5">{icon}<span className="truncate">{title}</span></div>
      <div className="text-[11px] text-white/60 break-words leading-relaxed">{desc}</div>
    </div>
  </div>
);

export default GroupWrapped;
