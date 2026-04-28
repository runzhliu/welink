/**
 * 灵魂提问机 —— AI 出 5 道"只有你俩才答得上"的默契选择题
 *
 * 选联系人 → POST /api/contacts/soul-quiz → 答题（隐藏答案）→ 翻面看答案
 */

import React, { useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  HelpCircle, Loader2, Search, Wand2, RefreshCw, Share2, Check, Eye, Trophy,
} from 'lucide-react';
import html2canvas from 'html2canvas';
import type { ContactStats } from '../../types';
import { avatarSrc } from '../../utils/avatar';
import { prepareForCapture } from '../../utils/exportPng';
import { useToast } from '../common/Toast';

interface Props {
  contacts: ContactStats[];
}

interface Question {
  question: string;
  options: string[];
  answer_index: number;
  why?: string;
  category: string;
}
interface QuizResp {
  display_name: string;
  questions: Question[];
}

const displayOf = (c: ContactStats) => c.remark || c.nickname || c.username;

// 所有 category 共用主题绿；不同类别靠文字本身区分（"回忆"/"梗"等已经够清楚）
const CAT_COLOR = 'bg-[#07c160]/12 text-[#07c160] dark:text-[#07c160]';

const LETTER = ['A', 'B', 'C', 'D'];

export const SoulQuiz: React.FC<Props> = ({ contacts }) => {
  const toast = useToast();
  const [picked, setPicked] = useState<ContactStats | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [data, setData] = useState<QuizResp | null>(null);
  const [picks, setPicks] = useState<Record<number, number>>({}); // qi -> chosen
  const [reveal, setReveal] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const base = contacts.filter(c => !c.username.endsWith('@chatroom') && (c.total_messages || 0) >= 50);
    base.sort((a, b) => (b.total_messages || 0) - (a.total_messages || 0));
    const q = search.trim().toLowerCase();
    if (!q) return base.slice(0, 80);
    return base.filter(c =>
      (c.remark || '').toLowerCase().includes(q) ||
      (c.nickname || '').toLowerCase().includes(q) ||
      c.username.toLowerCase().includes(q),
    ).slice(0, 80);
  }, [contacts, search]);

  const generate = async () => {
    if (!picked || loading) return;
    setLoading(true);
    setErr('');
    setData(null);
    setPicks({});
    setReveal(false);
    try {
      const r = await axios.post<QuizResp>('/api/contacts/soul-quiz', { username: picked.username });
      setData(r.data);
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } }; message?: string })
        ?.response?.data?.error || (e as Error).message || '生成失败';
      setErr(msg);
    } finally {
      setLoading(false);
    }
  };

  const score = data
    ? data.questions.reduce((acc, q, i) => acc + (picks[i] === q.answer_index ? 1 : 0), 0)
    : 0;

  const exportPng = async () => {
    if (!data || !cardRef.current || exporting) return;
    setExporting(true);
    const root = document.documentElement;
    const hadDark = root.classList.contains('dark');
    if (hadDark) root.classList.remove('dark');
    // wrapper 在 try 外声明，toPng 抛错时 finally 也能把它从 DOM 拆掉，避免悬挂节点累积。
    let wrapper: HTMLElement | null = null;
    try {
      const node = cardRef.current.cloneNode(true) as HTMLElement;
      wrapper = document.createElement('div');
      wrapper.style.cssText = `
        width: 720px; background: #ffffff; padding: 0;
        font-family: system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
        position: fixed; left: -10000px; top: 0; z-index: -1;
      `;
      wrapper.appendChild(node);
      const footer = document.createElement('div');
      footer.style.cssText = 'padding:14px 28px; background:#f8f9fb; color:#888; font-size:11px; text-align:center; border-top:1px solid #eee;';
      footer.innerHTML = `WeLink · 灵魂提问机 · ${new Date().toLocaleDateString('zh-CN')}`;
      wrapper.appendChild(footer);
      document.body.appendChild(wrapper);
      await prepareForCapture(wrapper);
      const canvas = await html2canvas(wrapper, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      });
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `welink-soul-quiz-${data.display_name}-${Date.now()}.png`;
      a.click();
      setExported(true);
      setTimeout(() => setExported(false), 3000);
    } catch (e) {
      toast.error('导出失败：' + ((e as Error).message || '未知错误'));
    } finally {
      if (wrapper && wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
      if (hadDark) root.classList.add('dark');
      setExporting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      {/* 选联系人 */}
      <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <HelpCircle size={16} className="text-[#07c160]" />
          <div className="text-sm font-bold text-[#1d1d1f] dark:text-gray-100">默契测试 · 5 道选择题</div>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          AI 基于你和 ta 的聊天记录出 5 道选择题。自己答完看分数，或者发给 ta 看 ta 还记得多少。
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
        <div className="flex flex-wrap gap-1.5 max-h-44 overflow-y-auto mb-3">
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
                  <img src={avatarSrc(c.big_head_url || c.small_head_url) || ''} alt="" className="w-4 h-4 rounded-full object-cover" />
                )}
                <span>{displayOf(c)}</span>
                <span className={`text-[10px] ${sel ? 'opacity-80' : 'text-gray-400'}`}>{c.total_messages}</span>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="text-xs text-gray-400 py-4 px-2">没找到联系人（消息需 ≥ 50 条）</div>
          )}
        </div>
        <div className="flex items-center justify-between">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {picked ? <>已选：<strong className="text-[#1d1d1f] dark:text-gray-100">{displayOf(picked)}</strong></> : '请先选一位'}
          </div>
          <button
            onClick={generate}
            disabled={!picked || loading}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-[#07c160] hover:bg-[#06a850] disabled:opacity-50"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : data ? <RefreshCw size={14} /> : <Wand2 size={14} />}
            {loading ? '出题中…' : data ? '重新出题' : '生成 5 题'}
          </button>
        </div>
      </div>

      {err && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/30 p-3 mb-4 text-xs text-red-700 dark:text-red-300">{err}</div>
      )}

      {data && (
        <>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              已选 {Object.keys(picks).length} / {data.questions.length}
              {reveal && <span className="ml-2">· <strong className="text-[#07c160]">得分 {score} / {data.questions.length}</strong></span>}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setReveal(r => !r)}
                disabled={Object.keys(picks).length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#07c160] hover:bg-[#06a850] text-white disabled:opacity-50"
              >
                <Eye size={12} />
                {reveal ? '收起答案' : '查看答案'}
              </button>
              <button
                onClick={exportPng}
                disabled={exporting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 disabled:opacity-50"
              >
                {exporting ? <Loader2 size={12} className="animate-spin" /> : exported ? <Check size={12} className="text-[#07c160]" /> : <Share2 size={12} />}
                {exporting ? '生成图片…' : exported ? '已下载' : '导出'}
              </button>
            </div>
          </div>

          <div ref={cardRef} className="rounded-2xl bg-white dark:bg-[#1c1c1e] overflow-hidden border border-gray-100 dark:border-white/10">
            <div className="px-7 py-5 bg-[#07c160]/8 dark:bg-[#07c160]/10 border-b border-[#07c160]/15">
              <div className="text-xs uppercase tracking-widest text-[#07c160] font-bold mb-1">
                Soul Quiz · 默契测试
              </div>
              <div className="text-2xl font-black text-[#1d1d1f] dark:text-gray-100">
                只有我和 {data.display_name} 才知道
              </div>
              {reveal && (
                <div className="mt-2 inline-flex items-center gap-1.5 bg-white dark:bg-white/10 px-3 py-1 rounded-full text-xs font-bold text-[#07c160]">
                  <Trophy size={12} />
                  得分 {score} / {data.questions.length}
                </div>
              )}
            </div>

            <div className="px-7 py-5 space-y-5">
              {data.questions.map((q, qi) => {
                const my = picks[qi];
                return (
                  <div key={qi}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-black text-[#07c160]">Q{qi + 1}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${CAT_COLOR}`}>{q.category}</span>
                    </div>
                    <div className="text-sm font-bold text-[#1d1d1f] dark:text-gray-100 mb-2.5">{q.question}</div>
                    <div className="grid grid-cols-1 gap-1.5">
                      {q.options.map((opt, oi) => {
                        const isMy = my === oi;
                        const isCorrect = q.answer_index === oi;
                        // 答题中：被选选项用主题绿勾出
                        // 揭晓后：正确=绿，错选=红（语义性 traffic-light，无可替代）
                        let cls = 'border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-700 dark:text-gray-200';
                        if (reveal) {
                          if (isCorrect) cls = 'border-[#07c160] bg-[#07c160]/8 dark:bg-[#07c160]/15 text-[#07c160]';
                          else if (isMy) cls = 'border-red-400 bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-200';
                          else cls = 'border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-400';
                        } else if (isMy) {
                          cls = 'border-[#07c160] bg-[#07c160]/8 dark:bg-[#07c160]/15 text-[#07c160] font-semibold';
                        }
                        return (
                          <button
                            key={oi}
                            onClick={() => !reveal && setPicks(p => ({ ...p, [qi]: oi }))}
                            className={`text-left px-3 py-2 rounded-xl text-xs border transition-colors ${cls}`}
                          >
                            <span className="inline-block w-5 font-black">{LETTER[oi]}.</span>
                            <span>{opt}</span>
                            {reveal && isCorrect && <span className="float-right text-[10px] font-bold">✓ 正确</span>}
                            {reveal && isMy && !isCorrect && <span className="float-right text-[10px] font-bold">你选的</span>}
                          </button>
                        );
                      })}
                    </div>
                    {reveal && q.why && (
                      <div className="mt-2 text-[11px] text-gray-500 dark:text-gray-400 italic px-2">依据：{q.why}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default SoulQuiz;
