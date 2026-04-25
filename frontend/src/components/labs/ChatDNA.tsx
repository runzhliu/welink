/**
 * 我的聊天 DNA —— Wrapped 风格的年度个人卡片
 *
 * 一次 GET /api/me/dna，把整体统计渲染成一张大卡片，可截图导出。
 */

import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
  Sparkles, Loader2, Share2, Check, Crown, Clock, Moon, MessageSquare, Zap, Smile, Quote,
} from 'lucide-react';
import { toPng } from 'html-to-image';
import { avatarSrc } from '../../utils/avatar';

interface TopContact {
  username: string;
  display_name: string;
  avatar?: string;
  messages: number;
}
interface QuickestReplier {
  username: string;
  display_name: string;
  avatar?: string;
  median_sec: number;
  samples: number;
}
interface LateNightBuddy {
  username: string;
  display_name: string;
  avatar?: string;
  count: number;
}
interface LongestDay {
  date: string;
  username: string;
  display_name: string;
  message_count: number;
}
interface DNAResp {
  total_contacts_analyzed: number;
  total_messages: number;
  my_messages: number;
  their_messages: number;
  my_chars: number;
  first_date: string;
  days_active: number;
  busiest_hour: number;
  busiest_hour_pct: number;
  late_night_pct: number;
  top_contacts: TopContact[];
  top_openers: { text: string; count: number }[];
  top_emojis: { emoji: string; count: number }[];
  quickest_replier?: QuickestReplier | null;
  late_night_buddy?: LateNightBuddy | null;
  longest_single_day?: LongestDay | null;
  longest_message: string;
  longest_message_len: number;
}

const fmtNum = (n: number) => n.toLocaleString('zh-CN');
const fmtSec = (s: number) => {
  if (s < 60) return `${Math.round(s)}秒`;
  if (s < 3600) return `${Math.round(s / 60)}分钟`;
  return `${(s / 3600).toFixed(1)}小时`;
};

export const ChatDNA: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [data, setData] = useState<DNAResp | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const fetchData = async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await axios.get<DNAResp>('/api/me/dna');
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
    try {
      const node = cardRef.current.cloneNode(true) as HTMLElement;
      const wrapper = document.createElement('div');
      wrapper.style.cssText = `
        width: 720px; background: #0b0b14; padding: 0;
        font-family: system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
        position: fixed; left: -10000px; top: 0; z-index: -1;
      `;
      wrapper.appendChild(node);
      const footer = document.createElement('div');
      footer.style.cssText =
        'padding:14px 28px; background:#0b0b14; color:#888; font-size:11px; text-align:center; border-top:1px solid rgba(255,255,255,0.06);';
      footer.innerHTML = `WeLink · 我的聊天 DNA · ${new Date().toLocaleDateString('zh-CN')}`;
      wrapper.appendChild(footer);
      document.body.appendChild(wrapper);
      const dataUrl = await toPng(wrapper, { pixelRatio: 2, cacheBust: true });
      document.body.removeChild(wrapper);
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `welink-chat-dna-${Date.now()}.png`;
      a.click();
      setExported(true);
      setTimeout(() => setExported(false), 3000);
    } catch (e) {
      alert('导出失败：' + ((e as Error).message || '未知错误'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-4 mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Sparkles size={16} className="text-[#07c160]" />
            <div className="text-sm font-bold text-[#1d1d1f] dark:text-gray-100">我的聊天 DNA</div>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            把你的微信聊天浓缩成一张可分享的"年度卡片"，纯本地统计，无 LLM 调用。
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={fetchData}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white bg-[#07c160] hover:bg-[#06a850] disabled:opacity-50"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
            {loading ? '统计中…' : data ? '重新统计' : '生成'}
          </button>
          {data && (
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
        <div className="text-center py-16 text-gray-400 text-sm">扫描你的聊天数据中… 大约需要 20-60 秒</div>
      )}

      {data && (
        <div ref={cardRef} className="rounded-2xl overflow-hidden bg-[#0b0b14] text-white">
          {/* Hero */}
          <div className="px-7 py-8 bg-[#07c160]">
            <div className="text-xs uppercase tracking-[0.2em] text-white/70 font-bold mb-2">
              CHAT DNA · 我的聊天 DNA
            </div>
            <div className="text-3xl font-black mb-3 leading-tight">
              你和 {data.total_contacts_analyzed} 位好友<br/>聊出了 <span className="text-white">{fmtNum(data.total_messages)}</span> 条消息
            </div>
            <div className="text-xs text-white/75">
              {data.first_date && <>从 {data.first_date} 起 · </>}活跃 {data.days_active} 天 · 你敲了 {fmtNum(data.my_chars)} 个字
            </div>
          </div>

          {/* 大数 grid */}
          <div className="grid grid-cols-2 gap-px bg-white/5">
            <Stat icon={<Clock size={14} />} label="最爱聊天的时段" value={`${data.busiest_hour}:00`} sub={`${(data.busiest_hour_pct * 100).toFixed(0)}% 的消息发生在这个小时`} />
            <Stat icon={<Moon size={14} />} label="深夜含量" value={`${(data.late_night_pct * 100).toFixed(0)}%`} sub="00:00-05:00 的消息占比" />
            <Stat icon={<MessageSquare size={14} />} label="我说了多少" value={fmtNum(data.my_messages)} sub={`Ta 们回了 ${fmtNum(data.their_messages)} 条`} />
            <Stat icon={<Sparkles size={14} />} label="平均每天" value={data.days_active ? fmtNum(Math.round(data.total_messages / data.days_active)) : '—'} sub="条聊天" />
          </div>

          {/* Top 联系人 */}
          {data.top_contacts.length > 0 && (
            <div className="px-7 py-5 border-t border-white/5">
              <SectionTitle icon={<Crown size={14} className="text-[#07c160]" />}>本年的 5 位主角</SectionTitle>
              <div className="space-y-2.5">
                {data.top_contacts.map((c, i) => (
                  <div key={c.username} className="flex items-center gap-3">
                    <div className="text-[#07c160] font-black text-lg w-5 text-center">{i + 1}</div>
                    {(c.avatar) ? (
                      <img src={avatarSrc(c.avatar) || ''} className="w-9 h-9 rounded-full object-cover bg-white/10" alt="" />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-white/10" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{c.display_name}</div>
                      <div className="text-[11px] text-white/50">{fmtNum(c.messages)} 条消息</div>
                    </div>
                    {/* bar */}
                    <div className="w-24 h-2 rounded-full bg-white/5 overflow-hidden">
                      <div
                        className="h-full bg-[#07c160]"
                        style={{ width: `${(c.messages / data.top_contacts[0].messages) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 角色卡 */}
          <div className="px-7 py-5 border-t border-white/5 space-y-4">
            {data.quickest_replier && (
              <BadgeCard
                icon={<Zap size={14} className="text-[#07c160]" />}
                title={`最爱秒回的人 · ${data.quickest_replier.display_name}`}
                desc={`你给 ta 的中位回复速度是 ${fmtSec(data.quickest_replier.median_sec)}（${data.quickest_replier.samples} 次）`}
                avatar={data.quickest_replier.avatar}
              />
            )}
            {data.late_night_buddy && (
              <BadgeCard
                icon={<Moon size={14} className="text-[#07c160]" />}
                title={`深夜搭子 · ${data.late_night_buddy.display_name}`}
                desc={`和 ta 在 0-5 点之间聊了 ${data.late_night_buddy.count} 条`}
                avatar={data.late_night_buddy.avatar}
              />
            )}
            {data.longest_single_day && (
              <BadgeCard
                icon={<MessageSquare size={14} className="text-[#07c160]" />}
                title={`最长的一天 · ${data.longest_single_day.date}`}
                desc={`和 ${data.longest_single_day.display_name} 一天聊了 ${data.longest_single_day.message_count} 条`}
              />
            )}
          </div>

          {/* Top emoji + opener */}
          <div className="grid grid-cols-2 gap-px bg-white/5">
            <div className="px-7 py-5">
              <SectionTitle icon={<Smile size={14} className="text-[#07c160]" />}>最爱用的 emoji</SectionTitle>
              {data.top_emojis.length === 0 ? (
                <div className="text-xs text-white/40">没找到 emoji 痕迹</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {data.top_emojis.slice(0, 8).map(e => (
                    <div key={e.emoji} className="inline-flex items-center gap-1 bg-white/5 rounded-lg px-2 py-1 text-sm">
                      <span>{e.emoji}</span>
                      <span className="text-[10px] text-white/40">×{e.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="px-7 py-5">
              <SectionTitle icon={<Quote size={14} className="text-[#07c160]" />}>常用开场白</SectionTitle>
              {data.top_openers.length === 0 ? (
                <div className="text-xs text-white/40">还没有典型开场白</div>
              ) : (
                <div className="space-y-1.5">
                  {data.top_openers.map(o => (
                    <div key={o.text} className="flex items-center justify-between text-sm">
                      <span className="text-white/90 truncate">"{o.text}"</span>
                      <span className="text-[10px] text-white/40 ml-2 shrink-0">×{o.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 长句 */}
          {data.longest_message && (
            <div className="px-7 py-5 border-t border-white/5 bg-white/[0.02]">
              <SectionTitle icon={<Quote size={14} className="text-[#07c160]" />}>你说过最长的一句话</SectionTitle>
              <div className="text-sm text-white/90 italic leading-relaxed">"{data.longest_message}"</div>
              <div className="text-[11px] text-white/40 mt-2">{data.longest_message_len} 字</div>
            </div>
          )}
        </div>
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

export default ChatDNA;
