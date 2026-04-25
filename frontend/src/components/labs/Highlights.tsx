/**
 * 高光瞬间 —— 选一个联系人，AI 从全部聊天记录里挑出 5-8 段最有故事感的对话
 *
 * 流程：选联系人 → POST /api/contacts/highlights → 渲染卡片 → 可截图导出
 */

import React, { useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Sparkles, Loader2, Search, Share2, Check, Wand2, RefreshCw } from 'lucide-react';
import { toPng } from 'html-to-image';
import type { ContactStats } from '../../types';
import { avatarSrc } from '../../utils/avatar';

interface Props {
  contacts: ContactStats[];
}

interface Excerpt {
  speaker: string;
  time: string;
  content: string;
}

interface Highlight {
  category: string;
  title: string;
  summary: string;
  date: string;
  excerpt: Excerpt[];
}

interface HighlightsResp {
  display_name: string;
  total_messages: number;
  days_known: number;
  first_date: string;
  last_date: string;
  highlights: Highlight[];
}

const displayOf = (c: ContactStats) => c.remark || c.nickname || c.username;


export const Highlights: React.FC<Props> = ({ contacts }) => {
  const [picked, setPicked] = useState<ContactStats | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [data, setData] = useState<HighlightsResp | null>(null);
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
      .filter(
        c =>
          (c.remark || '').toLowerCase().includes(q) ||
          (c.nickname || '').toLowerCase().includes(q) ||
          c.username.toLowerCase().includes(q),
      )
      .slice(0, 80);
  }, [contacts, search]);

  const generate = async () => {
    if (!picked || loading) return;
    setLoading(true);
    setErr('');
    setData(null);
    try {
      const r = await axios.post<HighlightsResp>('/api/contacts/highlights', {
        username: picked.username,
      });
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
    setExported(false);
    try {
      const node = cardRef.current.cloneNode(true) as HTMLElement;
      const wrapper = document.createElement('div');
      wrapper.style.cssText = `
        width: 720px; background: #ffffff; padding: 0;
        font-family: system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
        position: fixed; left: -10000px; top: 0; z-index: -1;
      `;
      // 强制白底，避免 dark 模式被截图
      node.style.background = '#ffffff';
      node.style.color = '#1d1d1f';
      wrapper.appendChild(node);

      const footer = document.createElement('div');
      footer.style.cssText =
        'padding:16px 28px; background:#f8f9fb; border-top: 1px solid #eee; display:flex; justify-content:space-between; align-items:center; font-size:11px; color:#888;';
      footer.innerHTML = `
        <div>
          <div><strong style="color:#555">github.com/runzhliu/welink</strong></div>
          <div style="color:#bbb; margin-top:2px;">© ${new Date().getFullYear()} @runzhliu · AGPL-3.0</div>
        </div>
        <div style="color:#07c160; font-weight:700;">welink.click →</div>
      `;
      wrapper.appendChild(footer);
      document.body.appendChild(wrapper);

      const dataUrl = await toPng(wrapper, { pixelRatio: 2, cacheBust: true });
      document.body.removeChild(wrapper);

      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `welink-highlights-${data.display_name}-${Date.now()}.png`;
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
      {/* 选联系人区 */}
      <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={16} className="text-[#07c160]" />
          <div className="text-sm font-bold text-[#1d1d1f] dark:text-gray-100">
            选一位联系人，看看你们的故事
          </div>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          AI 会从全部聊天记录里挑出 5-8 段最有"故事感"的瞬间 —— 那些深夜长谈、第一次见面、彼此成习惯的小梗。生成约需 10-30 秒。
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
            {loading ? '生成中…' : data ? '重新生成' : '生成高光'}
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
              {exporting ? <Loader2 size={12} className="animate-spin" /> : exported ? <Check size={12} className="text-[#07c160]" /> : <Share2 size={12} />}
              {exporting ? '生成图片…' : exported ? '已下载' : '导出分享图'}
            </button>
          </div>

          <div ref={cardRef} className="rounded-2xl bg-white dark:bg-[#1c1c1e] overflow-hidden border border-gray-100 dark:border-white/10">
            {/* Hero */}
            <div className="px-7 py-6 bg-[#07c160]/8 dark:bg-[#07c160]/10 border-b border-[#07c160]/15">
              <div className="text-xs uppercase tracking-widest text-[#07c160] font-bold mb-1">
                Highlights · 高光瞬间
              </div>
              <div className="text-3xl font-black text-[#1d1d1f] dark:text-gray-100 mb-1">
                我和 {data.display_name} 的故事
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {data.first_date} → {data.last_date} · 相识 {data.days_known} 天 · 共 {data.total_messages.toLocaleString()} 条消息
              </div>
            </div>

            {/* Highlights list */}
            <div className="px-7 py-5 space-y-5">
              {data.highlights.map((h, idx) => {
                return (
                  <div key={idx} className="relative pl-5">
                    <div className="absolute left-0 top-1.5 w-1 bottom-1.5 rounded-full bg-[#07c160]" />
                    <div className="flex items-baseline gap-2 mb-1 flex-wrap">
                      <span className="inline-block text-[10px] font-bold uppercase tracking-wider text-[#07c160] bg-[#07c160]/10 px-2 py-0.5 rounded-full">
                        {h.category}
                      </span>
                      <span className="text-[11px] text-gray-400 dark:text-gray-500">{h.date}</span>
                    </div>
                    <div className="text-base font-bold text-[#1d1d1f] dark:text-gray-100 mb-1.5">
                      {h.title}
                    </div>
                    <div className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed mb-2.5">
                      {h.summary}
                    </div>
                    {h.excerpt && h.excerpt.length > 0 && (
                      <div className="rounded-xl bg-gray-50 dark:bg-white/5 px-3 py-2.5 space-y-1.5">
                        {h.excerpt.map((e, i) => {
                          const mine = e.speaker === '我';
                          return (
                            <div key={i} className="text-xs leading-snug">
                              <span className={`font-bold ${mine ? 'text-[#07c160]' : 'text-gray-600 dark:text-gray-400'}`}>
                                {e.speaker}
                              </span>
                              <span className="text-gray-400 dark:text-gray-500 mx-1.5 text-[10px]">{e.time}</span>
                              <span className="text-gray-700 dark:text-gray-300">{e.content}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="px-7 py-4 bg-gray-50 dark:bg-white/5 text-[11px] text-gray-500 dark:text-gray-400 flex items-center justify-between border-t border-gray-100 dark:border-white/5">
              <span>WeLink · 高光瞬间 by AI</span>
              <span>{new Date().toLocaleDateString('zh-CN')}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Highlights;
