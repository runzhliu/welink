/**
 * 关系考古 / Milestones —— 单联系人时间轴卡
 *
 * 选联系人 → POST /api/contacts/milestones → 渲染竖向时间轴
 * 包含：首次互动 / 首条长文 / 首次深夜 / 最高频一周 / 最长断联 / 重联 / 单日纪录 / 周年
 * 纯统计、零 LLM、可截图分享。
 */

import React, { useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  Compass, Loader2, Search, Wand2, Share2, Check, RefreshCw,
  MessageCircle, BookOpen, Moon, TrendingUp, CloudOff, Hand, Flame, Cake,
} from 'lucide-react';
import html2canvas from 'html2canvas';
import type { ContactStats } from '../../types';
import { avatarSrc } from '../../utils/avatar';
import { prepareForCapture } from '../../utils/exportPng';
import { useToast } from '../common/Toast';

interface Props {
  contacts: ContactStats[];
}

interface MSEvent {
  date: string;
  time?: string;
  speaker: string;
  content?: string;
  length?: number;
}
interface MSPeakWeek {
  week_start: string;
  week_end: string;
  message_count: number;
}
interface MSGap {
  from_date: string;
  to_date: string;
  gap_days: number;
}
interface MSBusiestDay {
  date: string;
  message_count: number;
}
interface MSAnniversary {
  first_date: string;
  years_count: number;
  next_date: string;
  days_until_next: number;
}
interface MSResp {
  username: string;
  display_name: string;
  avatar?: string;
  total_messages: number;
  first_date?: string;
  last_date?: string;
  days_known: number;
  first_message?: MSEvent;
  first_long_message?: MSEvent;
  first_late_night?: MSEvent;
  peak_week?: MSPeakWeek;
  longest_gap?: MSGap;
  reunion?: MSEvent;
  busiest_day?: MSBusiestDay;
  anniversary?: MSAnniversary;
}

interface TLItem {
  /** 主排序日期（YYYY-MM-DD） */
  sortDate: string;
  /** 显示日期（人话） */
  displayDate: string;
  kind: string;
  icon: React.ReactNode;
  iconColor: string;
  title: string;
  body?: React.ReactNode;
  quote?: { speaker: string; content: string };
}

const displayOf = (c: ContactStats) => c.remark || c.nickname || c.username;
const fmtNum = (n: number) => n.toLocaleString('zh-CN');

const buildTimeline = (data: MSResp): TLItem[] => {
  const items: TLItem[] = [];
  const name = data.display_name;

  if (data.first_message) {
    items.push({
      sortDate: data.first_message.date,
      displayDate: data.first_message.date,
      kind: 'first',
      icon: <MessageCircle size={14} />,
      iconColor: '#07c160',
      title: '首次互动',
      body: <span className="text-white/70">这一天，你和 {name} 的故事开始了。</span>,
      quote: data.first_message.content
        ? { speaker: data.first_message.speaker, content: data.first_message.content }
        : undefined,
    });
  }
  if (data.first_long_message) {
    items.push({
      sortDate: data.first_long_message.date,
      displayDate: data.first_long_message.date,
      kind: 'first_long',
      icon: <BookOpen size={14} />,
      iconColor: '#10aeff',
      title: `首条长文 · ${data.first_long_message.length} 字`,
      body: <span className="text-white/70">关系开始有"想多说几句"的瞬间。</span>,
      quote: data.first_long_message.content
        ? { speaker: data.first_long_message.speaker, content: data.first_long_message.content }
        : undefined,
    });
  }
  if (data.first_late_night) {
    items.push({
      sortDate: data.first_late_night.date,
      displayDate: `${data.first_late_night.date} ${data.first_late_night.time || ''}`.trim(),
      kind: 'first_night',
      icon: <Moon size={14} />,
      iconColor: '#a78bfa',
      title: '首次深夜聊天',
      body: <span className="text-white/70">凌晨 0–5 点之间的第一条消息。这里通常藏着最掏心窝子的话。</span>,
      quote: data.first_late_night.content
        ? { speaker: data.first_late_night.speaker, content: data.first_late_night.content }
        : undefined,
    });
  }
  if (data.peak_week) {
    items.push({
      sortDate: data.peak_week.week_start,
      displayDate: `${data.peak_week.week_start} → ${data.peak_week.week_end}`,
      kind: 'peak_week',
      icon: <TrendingUp size={14} />,
      iconColor: '#07c160',
      title: '最高频的一周',
      body: <span className="text-white/70">这一周你们一共聊了 <strong className="text-white">{fmtNum(data.peak_week.message_count)}</strong> 条消息。</span>,
    });
  }
  if (data.busiest_day) {
    items.push({
      sortDate: data.busiest_day.date,
      displayDate: data.busiest_day.date,
      kind: 'busiest',
      icon: <Flame size={14} />,
      iconColor: '#ffa94d',
      title: '一天里聊得最多的那天',
      body: <span className="text-white/70">仅这一天就聊了 <strong className="text-white">{fmtNum(data.busiest_day.message_count)}</strong> 条。那天到底发生了什么？</span>,
    });
  }
  if (data.longest_gap) {
    items.push({
      sortDate: data.longest_gap.from_date,
      displayDate: `${data.longest_gap.from_date} → ${data.longest_gap.to_date}`,
      kind: 'longest_gap',
      icon: <CloudOff size={14} />,
      iconColor: '#ff6b6b',
      title: `最长的一次沉默 · ${data.longest_gap.gap_days} 天`,
      body: <span className="text-white/70">从 {data.longest_gap.from_date} 到 {data.longest_gap.to_date}，整整 {data.longest_gap.gap_days} 天没说话。</span>,
    });
  }
  if (data.reunion) {
    items.push({
      sortDate: data.reunion.date,
      displayDate: `${data.reunion.date} ${data.reunion.time || ''}`.trim(),
      kind: 'reunion',
      icon: <Hand size={14} />,
      iconColor: '#07c160',
      title: '重联那一刻',
      body: <span className="text-white/70">长沉默结束的第一句话。</span>,
      quote: data.reunion.content
        ? { speaker: data.reunion.speaker, content: data.reunion.content }
        : undefined,
    });
  }
  if (data.anniversary) {
    items.push({
      sortDate: data.anniversary.next_date,
      displayDate: data.anniversary.next_date,
      kind: 'anniversary',
      icon: <Cake size={14} />,
      iconColor: '#f59e0b',
      title: data.anniversary.years_count > 0
        ? `下一次"周年" · 你们认识的第 ${data.anniversary.years_count + 1} 年`
        : '第一个周年纪念日',
      body: data.anniversary.days_until_next === 0
        ? <span className="text-[#f59e0b] font-bold">今天就是！</span>
        : <span className="text-white/70">距离 <strong className="text-white">{data.anniversary.next_date}</strong> 还有 <strong className="text-[#f59e0b]">{data.anniversary.days_until_next}</strong> 天。</span>,
    });
  }

  // 排序：按日期升序，但"周年"始终放最后
  items.sort((a, b) => {
    if (a.kind === 'anniversary' && b.kind !== 'anniversary') return 1;
    if (b.kind === 'anniversary' && a.kind !== 'anniversary') return -1;
    return a.sortDate.localeCompare(b.sortDate);
  });
  return items;
};

export const Milestones: React.FC<Props> = ({ contacts }) => {
  const toast = useToast();
  const [picked, setPicked] = useState<ContactStats | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [data, setData] = useState<MSResp | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const base = contacts.filter(
      c => !c.username.endsWith('@chatroom') && (c.total_messages || 0) >= 30,
    );
    base.sort((a, b) => (b.total_messages || 0) - (a.total_messages || 0));
    const q = search.trim().toLowerCase();
    if (!q) return base.slice(0, 80);
    return base
      .filter(c =>
        (c.remark || '').toLowerCase().includes(q) ||
        (c.nickname || '').toLowerCase().includes(q) ||
        c.username.toLowerCase().includes(q)
      )
      .slice(0, 80);
  }, [contacts, search]);

  const generate = async () => {
    if (!picked || loading) return;
    setLoading(true);
    setErr('');
    setData(null);
    try {
      const r = await axios.post<MSResp>('/api/contacts/milestones', { username: picked.username });
      setData(r.data);
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } }; message?: string })
        ?.response?.data?.error || (e as Error).message || '生成失败';
      setErr(msg);
    } finally {
      setLoading(false);
    }
  };

  const timeline = useMemo(() => (data ? buildTimeline(data) : []), [data]);

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
      footer.innerHTML = `WeLink · 关系考古 · ${new Date().toLocaleDateString('zh-CN')}`;
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
      a.download = `welink-milestones-${data.display_name}-${Date.now()}.png`;
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
      {/* 选联系人 */}
      <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Compass size={16} className="text-[#07c160]" />
          <div className="text-sm font-bold text-[#1d1d1f] dark:text-gray-100">关系考古 · 你和 TA 的时间轴</div>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          挑一位联系人，自动整理 8 个关系里程碑：首次互动、首条长文、首次深夜聊天、最高频的一周、最长断联、重联那一刻、单日聊天纪录、周年。纯统计、即时返回。
        </div>
        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜联系人（备注/昵称）"
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-gray-50 dark:bg-white/5 text-sm text-[#1d1d1f] dark:text-gray-100 border border-transparent focus:border-[#07c160] outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-1.5 max-h-44 overflow-y-auto">
          {filtered.map(c => {
            const sel = picked?.username === c.username;
            return (
              <button
                key={c.username}
                onClick={() => setPicked(c)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs transition-colors ${
                  sel
                    ? 'bg-[#07c160] text-white font-bold'
                    : 'bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10'
                }`}
              >
                {(c.big_head_url || c.small_head_url) && (
                  <img
                    src={avatarSrc(c.big_head_url || c.small_head_url) || ''}
                    alt=""
                    className="w-4 h-4 rounded-full object-cover"
                  />
                )}
                <span>{displayOf(c)}</span>
                <span className={`text-[10px] ${sel ? 'opacity-80' : 'text-gray-400'}`}>
                  {c.total_messages}
                </span>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="text-xs text-gray-400 py-4 px-2">没找到联系人（消息需 ≥ 30 条）</div>
          )}
        </div>

        <div className="flex items-center justify-between mt-3">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {picked ? <>已选：<strong className="text-[#1d1d1f] dark:text-gray-100">{displayOf(picked)}</strong></> : '请先选一位'}
          </div>
          <button
            onClick={generate}
            disabled={!picked || loading}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-[#07c160] hover:bg-[#06a850] disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : data ? <RefreshCw size={14} /> : <Wand2 size={14} />}
            {loading ? '生成中…' : data ? '重新挖' : '开始考古'}
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
            <div className="px-7 py-7 bg-gradient-to-br from-[#07c160] to-[#10aeff]">
              <div className="text-xs uppercase tracking-[0.2em] text-white/80 font-bold mb-2">
                MILESTONES · 关系考古
              </div>
              <div className="flex items-center gap-3">
                {data.avatar && (
                  <img src={avatarSrc(data.avatar) || ''} className="w-12 h-12 rounded-full object-cover bg-white/20 shrink-0" alt="" />
                )}
                <div className="min-w-0">
                  <div className="text-2xl font-black mb-1 truncate">我和 {data.display_name} 的考古档案</div>
                  <div className="text-xs text-white/85">
                    {data.first_date && <>{data.first_date} → {data.last_date} · </>}
                    相识 {fmtNum(data.days_known)} 天 · 共 {fmtNum(data.total_messages)} 条消息
                  </div>
                </div>
              </div>
            </div>

            {/* 时间轴 */}
            <div className="px-7 py-6">
              {timeline.length === 0 ? (
                <div className="text-center text-white/40 text-sm py-10">
                  这位联系人的消息不够触发任何里程碑（≥ 20 条才行）
                </div>
              ) : (
                <div className="relative">
                  {/* 竖线 */}
                  <div className="absolute left-[11px] top-2 bottom-2 w-px bg-white/10" />
                  <div className="space-y-5">
                    {timeline.map((it, idx) => (
                      <div key={idx} className="relative pl-8">
                        {/* 圆点 */}
                        <div
                          className="absolute left-0 top-1 w-[22px] h-[22px] rounded-full flex items-center justify-center text-white shrink-0"
                          style={{ background: it.iconColor }}
                        >
                          {it.icon}
                        </div>
                        <div className="text-[10px] uppercase tracking-wider text-white/40 mb-0.5">
                          {it.displayDate}
                        </div>
                        <div className="text-sm font-bold mb-1">{it.title}</div>
                        {it.body && <div className="text-[12px] leading-relaxed">{it.body}</div>}
                        {it.quote && (
                          <div className="mt-2 rounded-xl bg-white/5 px-3 py-2.5">
                            <div className="text-[11px] text-white/60 mb-0.5">
                              <strong className={it.quote.speaker === '我' ? 'text-[#07c160]' : 'text-white/80'}>
                                {it.quote.speaker}
                              </strong>
                            </div>
                            <div className="text-xs text-white/85 leading-relaxed break-words">
                              "{it.quote.content}"
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="px-7 py-4 bg-white/[0.02] text-[11px] text-white/40 flex items-center justify-between border-t border-white/5">
              <span>WeLink · 关系考古</span>
              <span>{new Date().toLocaleDateString('zh-CN')}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Milestones;
