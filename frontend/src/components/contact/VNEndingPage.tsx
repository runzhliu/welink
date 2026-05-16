/**
 * VNEndingPage — VN 通关后的 Wrapped 风格分页回顾
 *
 * 4 页：
 *   1. 结局标题页：结局徽章 + 标题 + Epilogue（核心，截图最常用）
 *   2. 关键转折：LLM 给的 turning_points 列表 + 每章的玩家选项
 *   3. 数据对比：VN 亲密度 vs 真实关系热度（来自 RelationshipForecast 数据）
 *   4. 解锁面板：本次解锁 + 还差几个结局未通
 *
 * 长图导出：复用 html2canvas + Highlights / GroupYearReview 的 wrapper 模式
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import {
  BookOpen, Heart, Skull, Star, Trophy, EyeOff, RotateCcw, Loader2,
  Sparkles, Check, ArrowLeft, ArrowRight, Download, Lock,
} from 'lucide-react';
import type { VNChapterDTO, VNStoryDTO, VNEndingDTO } from '../../services/api';
import { vnApi, forecastApi } from '../../services/api';
import { prepareForCapture } from '../../utils/exportPng';
import { useToast } from '../common/Toast';

interface Props {
  ending: VNEndingDTO;
  story: VNStoryDTO;
  chapters: VNChapterDTO[];
  displayName: string;
  onRewind: (toChapter: number) => void;
  onRestart: () => void;
}

const ENDING_TYPES = ['true', 'happy', 'normal', 'bad', 'secret'] as const;

const ENDING_META: Record<string, { label: string; color: string; bgColor: string; icon: React.ReactNode; tag: string }> = {
  true:   { label: 'TRUE',   color: '#d97706', bgColor: 'bg-amber-500/15',   icon: <Trophy size={48} />,  tag: '真结局' },
  happy:  { label: 'HAPPY',  color: '#ec4899', bgColor: 'bg-pink-500/15',    icon: <Heart size={48} />,    tag: '好结局' },
  normal: { label: 'NORMAL', color: '#6b7280', bgColor: 'bg-gray-200',       icon: <BookOpen size={48} />, tag: '普通结局' },
  bad:    { label: 'BAD',    color: '#dc2626', bgColor: 'bg-red-500/15',     icon: <Skull size={48} />,    tag: '坏结局' },
  secret: { label: 'SECRET', color: '#7c3aed', bgColor: 'bg-violet-500/15',  icon: <EyeOff size={48} />,   tag: '隐藏结局' },
};

export const VNEndingPage: React.FC<Props> = ({ ending, story, chapters, displayName, onRewind, onRestart }) => {
  const [page, setPage] = useState(0);
  const [unlocked, setUnlocked] = useState<string[]>([]);
  const [realAffinity, setRealAffinity] = useState<number | null>(null);
  const [realStatus, setRealStatus] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const toast = useToast();
  const cardRef = useRef<HTMLDivElement>(null);

  const meta = ENDING_META[ending.type] ?? ENDING_META.normal;

  // 拉解锁列表 + 真实关系数据
  useEffect(() => {
    void vnApi.listEndings(story.username).then(r => {
      setUnlocked(r.unlocked.map(u => u.ending_type));
    }).catch(() => {});
    void forecastApi.getAll().then(r => {
      const me = (r.all ?? []).find(e => e.username === story.username);
      if (me) {
        // 把 forecast 的 status 映射成 0-100 分（rising=85 / stable=65 / cooling=35 / endangered=15）
        const map: Record<string, number> = { rising: 85, stable: 65, cooling: 35, endangered: 15 };
        setRealAffinity(map[me.status] ?? 50);
        setRealStatus(me.status);
      }
    }).catch(() => {});
  }, [story.username]);

  // 4 页定义
  const pages: { title: string; icon: React.ReactNode; render: () => React.ReactNode }[] = [
    { title: '结局', icon: <Sparkles size={14} />, render: () => <Page1Title ending={ending} story={story} displayName={displayName} cardRef={cardRef} /> },
    { title: '转折', icon: <RotateCcw size={14} />, render: () => <Page2Turning ending={ending} chapters={chapters} onRewind={onRewind} /> },
    { title: '对比', icon: <Heart size={14} />, render: () => <Page3Compare vnAffinity={story.state.affinity} realAffinity={realAffinity} realStatus={realStatus} /> },
    { title: '徽章', icon: <Trophy size={14} />, render: () => <Page4Badges unlocked={unlocked} currentType={ending.type} /> },
  ];

  // 导出长图：只导出当前页（截图常用单页）
  const exportPng = async () => {
    if (!cardRef.current || exporting) return;
    setExporting(true);
    const root = document.documentElement;
    const hadDark = root.classList.contains('dark');
    if (hadDark) root.classList.remove('dark');
    let wrapper: HTMLElement | null = null;
    try {
      const node = cardRef.current.cloneNode(true) as HTMLElement;
      wrapper = document.createElement('div');
      wrapper.style.cssText = `
        width: 720px; background: #ffffff; padding: 0;
        font-family: system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
        position: fixed; left: -10000px; top: 0; z-index: -1;
      `;
      node.style.background = '#ffffff';
      node.style.color = '#1d1d1f';
      wrapper.appendChild(node);

      const footer = document.createElement('div');
      footer.style.cssText =
        'padding:16px 28px; background:#f8f9fb; border-top: 1px solid #eee; display:flex; justify-content:space-between; align-items:center; font-size:11px; color:#888;';
      footer.innerHTML = `
        <div>
          <div><strong style="color:#555">WeLink · 互动小说</strong></div>
          <div style="color:#bbb; margin-top:2px;">${new Date().toLocaleDateString()} · welink.click</div>
        </div>
        <div style="color:${meta.color}; font-weight:700;">${meta.tag}</div>
      `;
      wrapper.appendChild(footer);
      document.body.appendChild(wrapper);
      await prepareForCapture(wrapper);

      const canvas = await html2canvas(wrapper, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      });
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `welink-vn-${displayName}-${ending.type}-${Date.now()}.png`;
      a.click();
      toast.success('已导出');
    } catch (e) {
      toast.error('导出失败：' + ((e as Error).message || '未知错误'));
    } finally {
      if (wrapper && wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
      if (hadDark) root.classList.add('dark');
      setExporting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      {/* 主体 */}
      <div ref={cardRef}>
        {pages[page].render()}
      </div>

      {/* 操作栏 */}
      <div className="flex items-center gap-2 flex-wrap justify-center pt-2">
        <button
          onClick={() => setPage(p => Math.max(0, p - 1))}
          disabled={page === 0}
          className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-300 disabled:opacity-30 hover:bg-gray-200 dark:hover:bg-white/20"
        >
          <ArrowLeft size={12} /> 上一页
        </button>
        <div className="flex items-center gap-1.5">
          {pages.map((p, i) => (
            <button
              key={i}
              onClick={() => setPage(i)}
              className={`flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg font-bold whitespace-nowrap transition-colors ${
                i === page ? 'bg-[#a78bfa] text-white' : 'bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-300 hover:bg-gray-200'
              }`}
            >
              {p.icon}{p.title}
            </button>
          ))}
        </div>
        <button
          onClick={() => setPage(p => Math.min(pages.length - 1, p + 1))}
          disabled={page === pages.length - 1}
          className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-300 disabled:opacity-30 hover:bg-gray-200 dark:hover:bg-white/20"
        >
          下一页 <ArrowRight size={12} />
        </button>
      </div>

      <div className="flex items-center gap-2 justify-center pt-2">
        <button
          onClick={exportPng}
          disabled={exporting}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 hover:border-[#a78bfa] hover:text-[#a78bfa] disabled:opacity-50"
        >
          {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
          导出当前页
        </button>
        <button
          onClick={onRestart}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-[#a78bfa] to-[#fb7185] text-white hover:shadow-md"
        >
          <Sparkles size={12} /> 再开一档
        </button>
      </div>
    </div>
  );
};

// ─── Page 1: 结局标题 ────────────────────────────────────────────────────────

const Page1Title: React.FC<{
  ending: VNEndingDTO;
  story: VNStoryDTO;
  displayName: string;
  cardRef: React.RefObject<HTMLDivElement>;
}> = ({ ending, story, displayName, cardRef: _cardRef }) => {
  const meta = ENDING_META[ending.type] ?? ENDING_META.normal;
  return (
    <div className={`rounded-3xl p-8 text-center space-y-5 ${meta.bgColor} border border-gray-100 dark:border-white/5`}>
      <div className="flex flex-col items-center gap-3">
        <div style={{ color: meta.color }}>{meta.icon}</div>
        <div className="text-[10px] font-bold tracking-[0.3em] uppercase" style={{ color: meta.color }}>
          {meta.label} ENDING · {meta.tag}
        </div>
      </div>
      <h2 className="text-2xl font-black text-[#1d1d1f] dark:text-gray-100 leading-tight">
        {ending.title || `${meta.tag}`}
      </h2>
      <div className="text-xs text-gray-500 dark:text-gray-400">
        · 和 <span className="font-bold">{displayName}</span> 的第 <span className="font-bold">{story.id}</span> 段故事 ·
      </div>
      {ending.epilogue && (
        <div className="text-[15px] leading-[1.9] text-gray-700 dark:text-gray-200 whitespace-pre-wrap text-left bg-white/60 dark:bg-black/20 rounded-2xl p-5 max-w-md mx-auto">
          {ending.epilogue}
        </div>
      )}
      <div className="flex items-center justify-center gap-3 text-xs text-gray-500 dark:text-gray-400 pt-2">
        <span className="inline-flex items-center gap-1">
          <Heart size={12} className="text-pink-400" />
          <span className="font-mono">{story.state.affinity}/100</span>
        </span>
        <span>·</span>
        <span>{story.max_chapters} 章</span>
        <span>·</span>
        <span>{story.mode === 'free' ? '自由探索' : story.mode === 'quest' ? '带目标' : '回忆'}</span>
      </div>
    </div>
  );
};

// ─── Page 2: 关键转折 ────────────────────────────────────────────────────────

const Page2Turning: React.FC<{
  ending: VNEndingDTO;
  chapters: VNChapterDTO[];
  onRewind: (toChapter: number) => void;
}> = ({ ending, chapters, onRewind }) => {
  return (
    <div className="rounded-3xl p-6 bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 space-y-4">
      <div className="text-xs font-bold text-gray-400 uppercase tracking-wide">关键转折</div>

      {ending.turning_points && ending.turning_points.length > 0 && (
        <ol className="space-y-3">
          {ending.turning_points.map((tp, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="flex-shrink-0 w-7 h-7 rounded-full bg-[#a78bfa]/15 text-[#a78bfa] flex items-center justify-center text-xs font-bold">{i + 1}</span>
              <span className="text-sm leading-relaxed text-gray-700 dark:text-gray-200 pt-1">{tp}</span>
            </li>
          ))}
        </ol>
      )}

      <div className="pt-4 border-t border-gray-100 dark:border-white/10">
        <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">你的每一个选择</div>
        <div className="space-y-1.5">
          {chapters.map(ch => (
            <div key={ch.chapter_idx} className="flex items-center gap-3 p-2 rounded-lg bg-gray-50 dark:bg-white/5 text-xs group">
              <span className="font-bold text-gray-400 font-mono w-5 text-center">{ch.chapter_idx + 1}</span>
              <span className="flex-1 text-gray-600 dark:text-gray-300 truncate">
                {ch.choices[ch.chosen_idx]?.text ?? <span className="italic text-gray-300">—</span>}
              </span>
              {ch.choices[ch.chosen_idx]?.tone && (
                <span className="text-[9px] text-gray-300 font-mono uppercase">{ch.choices[ch.chosen_idx].tone}</span>
              )}
              <button
                onClick={() => onRewind(ch.chapter_idx)}
                className="p-1 text-gray-300 hover:text-[#a78bfa] opacity-0 group-hover:opacity-100 transition-opacity"
                title="回滚到此处看别的可能"
              >
                <RotateCcw size={11} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─── Page 3: 数据对比 ────────────────────────────────────────────────────────

const Page3Compare: React.FC<{
  vnAffinity: number;
  realAffinity: number | null;
  realStatus: string | null;
}> = ({ vnAffinity, realAffinity, realStatus }) => {
  const diff = realAffinity !== null ? vnAffinity - realAffinity : null;
  const comment = useMemo(() => {
    if (diff === null) return '真实关系数据加载中…';
    if (Math.abs(diff) <= 10) return '剧情和现实差不多，AI 把 TA 演得挺像。';
    if (diff > 10) return `剧情里你们更亲密一些（高 ${diff} 分）—— 或许是你想象中的「最好版本」。`;
    return `剧情里反而比现实冷淡 ${-diff} 分。AI 可能选了一条没走过的灰色支线。`;
  }, [diff]);

  const realStatusLabel: Record<string, string> = {
    rising: '升温中 🔥',
    stable: '稳定 ✓',
    cooling: '降温中 ❄️',
    endangered: '濒危 🚨',
  };

  return (
    <div className="rounded-3xl p-6 bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 space-y-5">
      <div className="text-xs font-bold text-gray-400 uppercase tracking-wide">剧情亲密度 vs 真实关系</div>

      <div className="grid grid-cols-2 gap-3">
        <CompareCard label="本剧亲密度" value={vnAffinity} color="#a78bfa" sub="VN" />
        {realAffinity !== null ? (
          <CompareCard
            label="真实关系热度"
            value={realAffinity}
            color="#07c160"
            sub={realStatus ? realStatusLabel[realStatus] ?? realStatus : ''}
          />
        ) : (
          <div className="rounded-2xl p-4 border border-dashed border-gray-200 dark:border-white/10 flex items-center justify-center text-xs text-gray-400">
            <Loader2 size={14} className="animate-spin mr-1.5" />
            真实数据加载中
          </div>
        )}
      </div>

      <div className="bg-gradient-to-br from-[#a78bfa]/5 to-[#07c160]/5 rounded-2xl p-4 text-sm text-gray-700 dark:text-gray-200 leading-relaxed">
        {comment}
      </div>

      <div className="text-[10px] text-gray-400 leading-relaxed">
        · 真实关系热度由「关系动态预测」推断（基于最近 6 个月消息节奏），映射成 0-100 分。<br />
        · 本剧亲密度由你的每一个选项累计而成。
      </div>
    </div>
  );
};

const CompareCard: React.FC<{ label: string; value: number; color: string; sub?: string }> = ({ label, value, color, sub }) => (
  <div className="rounded-2xl p-4 border border-gray-100 dark:border-white/10 bg-gray-50 dark:bg-white/5">
    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">{label}</div>
    <div className="flex items-baseline gap-1.5">
      <span className="text-3xl font-black font-mono tabular-nums" style={{ color }}>{value}</span>
      <span className="text-xs text-gray-400">/100</span>
    </div>
    {sub && <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">{sub}</div>}
    {/* 进度条 */}
    <div className="mt-3 h-1.5 rounded-full bg-gray-200 dark:bg-white/10 overflow-hidden">
      <div className="h-full transition-all duration-700" style={{ width: `${value}%`, backgroundColor: color }} />
    </div>
  </div>
);

// ─── Page 4: 解锁徽章 ────────────────────────────────────────────────────────

const Page4Badges: React.FC<{ unlocked: string[]; currentType: string }> = ({ unlocked, currentType }) => {
  const totalCount = ENDING_TYPES.length;
  const unlockedCount = unlocked.length;
  return (
    <div className="rounded-3xl p-6 bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold text-gray-400 uppercase tracking-wide">结局收集</div>
        <div className="text-xs font-mono text-gray-400 tabular-nums">{unlockedCount}/{totalCount}</div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {ENDING_TYPES.map(t => {
          const isUnlocked = unlocked.includes(t);
          const isCurrent = t === currentType;
          const m = ENDING_META[t];
          // secret 未解锁时藏起名字
          const showSecret = t === 'secret' && !isUnlocked;
          return (
            <div
              key={t}
              className={`rounded-2xl p-4 text-center transition-all ${
                isUnlocked ? m.bgColor : 'bg-gray-50 dark:bg-white/5'
              } ${isCurrent ? 'ring-2 ring-offset-2 ring-offset-white dark:ring-offset-[#1d1d1f]' : ''}`}
              style={isCurrent ? { boxShadow: `0 0 0 2px ${m.color}` } : {}}
            >
              <div className="flex justify-center mb-1.5" style={{ color: isUnlocked ? m.color : '#d1d5db' }}>
                {isUnlocked ? React.cloneElement(m.icon as React.ReactElement, { size: 28 }) : <Lock size={28} />}
              </div>
              <div className="text-xs font-bold" style={{ color: isUnlocked ? m.color : '#9ca3af' }}>
                {showSecret ? '???' : m.tag}
              </div>
              {isCurrent && (
                <div className="mt-1.5 inline-flex items-center gap-0.5 text-[9px] font-bold text-white px-1.5 py-0.5 rounded-full" style={{ backgroundColor: m.color }}>
                  <Check size={9} /> 本次
                </div>
              )}
            </div>
          );
        })}
      </div>

      {unlockedCount < totalCount && (
        <div className="text-[11px] text-gray-400 text-center pt-2 leading-relaxed">
          还差 <span className="font-bold text-[#a78bfa]">{totalCount - unlockedCount}</span> 个结局没解锁。<br />
          回滚到不同章节，做出不同选择，看看会通向哪里。
        </div>
      )}
      {unlockedCount === totalCount && (
        <div className="text-xs text-center pt-2 font-bold text-amber-500">
          <Trophy size={14} className="inline-block mr-1" />
          全结局已解锁 · 你已经把这段关系玩通了
        </div>
      )}
    </div>
  );
};

export default VNEndingPage;
