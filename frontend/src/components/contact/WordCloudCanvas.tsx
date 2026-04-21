/**
 * 词云画布（基于 wordcloud2.js） —— 经典版 + 视觉升级：
 *   1. 按 devicePixelRatio 放大画布，字体在 Retina/高 DPI 屏幕上不再糊
 *   2. 颜色按排名分 5 档渐变（深绿 → 绿 → 蓝 → 蓝紫 → 灰），取代 5 色随机
 *   3. 容器用径向渐变底 + 细边框 + 柔和投影，不再是平面白底
 *   4. wordcloud2 渲染完成后 canvas 从 opacity:0 淡入，弱化突兀感
 *   5. 悬停 tooltip / 点击 pin 卡视觉升级（渐变条、排名、百分比、关闭 X）
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { X } from 'lucide-react';
import type { WordCount } from '../../types';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';

declare global {
  interface Window {
    WordCloud: any;
  }
}

interface Props {
  data: WordCount[];
  loading?: boolean;
  className?: string;
  onRendered?: () => void;
}

// 10 色调色板：覆盖冷暖，相邻排名不撞色；每个颜色都手调过饱和度，暗色模式下可读
const WORD_PALETTE = [
  '#07c160', // 微信绿
  '#10aeff', // 天空蓝
  '#f59e0b', // 琥珀
  '#8b5cf6', // 紫
  '#ec4899', // 玫红
  '#14b8a6', // 青
  '#f97066', // 珊瑚
  '#576b95', // 蓝紫
  '#06ad56', // 深绿
  '#3b82f6', // 皇家蓝
];

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// 排名 → 颜色：循环走调色板；尾部词降低 alpha 弱化存在感，保持层次
function colorByRank(rank: number, _dark: boolean): string {
  const base = WORD_PALETTE[rank % WORD_PALETTE.length];
  if (rank < 15) return base;              // Top 15 用满色
  if (rank < 30) return hexToRgba(base, 0.75);
  if (rank < 50) return hexToRgba(base, 0.55);
  return hexToRgba(base, 0.38);            // 长尾保留色相但几乎褪去
}

interface TooltipState { word: string; count: number; x: number; y: number; }

export const WordCloudCanvas: React.FC<Props> = ({ data, loading = false, className = 'h-80', onRendered }) => {
  const { privacyMode } = usePrivacyMode();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const onRenderedRef = useRef(onRendered);
  const wordMapRef = useRef<Map<string, { count: number; rank: number }>>(new Map());
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [pinned, setPinned] = useState<TooltipState | null>(null);
  const [fadedIn, setFadedIn] = useState(false);

  useEffect(() => { onRenderedRef.current = onRendered; }, [onRendered]);

  const renderCloud = useCallback(() => {
    if (!data.length || !canvasRef.current || !window.WordCloud) return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!container) return;

    // 画布先淡出、准备重绘
    setFadedIn(false);

    const { width: cssW, height: cssH } = container.getBoundingClientRect();
    // 按 DPR 放大实际像素，保持 CSS 尺寸不变 —— 让文字在 Retina 屏上清晰
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';

    const validData = data.filter(i => {
      if (!i.word || typeof i.word !== 'string') return false;
      if (i.word.trim().length === 0 || i.word.length > 20) return false;
      return /[\u4e00-\u9fa5a-zA-Z]/.test(i.word);
    });

    if (!validData.length) { onRenderedRef.current?.(); return; }

    // 建 word → {count, rank} 映射，给 color 回调和 tooltip 查询用
    const wm = new Map<string, { count: number; rank: number }>();
    validData.forEach((i, idx) => wm.set(i.word, { count: i.count, rank: idx }));
    wordMapRef.current = wm;

    // 对数字号：头部词不过于压缩，尾部词也保底可读
    const scale = canvas.width / 600;
    const maxCount = validData[0].count;
    const minCount = validData[validData.length - 1].count;
    const logMax = Math.log(maxCount + 1);
    const logMin = Math.log(Math.max(minCount, 1));
    const logRange = logMax - logMin || 1;
    const minSize = Math.round(14 * scale);
    const maxSize = Math.round(62 * scale);

    const list = validData.map(i => {
      const logVal = Math.log(i.count + 1);
      const ratio = (logVal - logMin) / logRange;
      // 用 0.7 幂次轻微拉平，避免头部词吃掉所有字号
      const curved = Math.pow(ratio, 0.7);
      const size = Math.round(minSize + curved * (maxSize - minSize));
      return [i.word, size] as [string, number];
    });

    const isDark = document.documentElement.classList.contains('dark');

    setTooltip(null);
    setPinned(null);

    const handleStop = () => {
      canvas.removeEventListener('wordcloudstop', handleStop);
      setFadedIn(true);
      onRenderedRef.current?.();
    };
    canvas.addEventListener('wordcloudstop', handleStop);

    try {
      window.WordCloud(canvas, {
        list,
        gridSize: Math.round(7 * scale),
        weightFactor: 1,
        // 用项目主字体（手写体），让词云和整体视觉统一；DM Sans 给英文/数字兜底
        fontFamily: '"LXGW WenKai Screen", "DM Sans", "PingFang SC", "Microsoft YaHei", -apple-system, system-ui, sans-serif',
        fontWeight: '700',
        color: (word: string) => {
          const entry = wm.get(word);
          return colorByRank(entry?.rank ?? 99, isDark);
        },
        rotateRatio: 0,
        backgroundColor: 'transparent',
        shuffle: false,
        drawOutOfBound: false,
        shrinkToFit: true,
        minRotation: 0,
        maxRotation: 0,
        hover: (item: [string, number] | null, _dim: unknown, evt: MouseEvent) => {
          if (!item) {
            canvas.style.cursor = 'default';
            setTooltip(null);
            return;
          }
          canvas.style.cursor = 'pointer';
          const rect = canvas.getBoundingClientRect();
          const x = evt.clientX - rect.left;
          const y = evt.clientY - rect.top;
          const entry = wm.get(item[0]);
          setTooltip({ word: item[0], count: entry?.count ?? 0, x, y });
        },
        click: (item: [string, number] | null) => {
          if (!item) { setPinned(null); return; }
          setPinned(prev => {
            if (prev && prev.word === item[0]) return null;
            const entry = wm.get(item[0]);
            return { word: item[0], count: entry?.count ?? 0, x: 0, y: 0 };
          });
        },
      });
    } catch (err) {
      console.error('WordCloud rendering error:', err);
      canvas.removeEventListener('wordcloudstop', handleStop);
      setFadedIn(true);
      onRenderedRef.current?.();
    }
  }, [data]);

  useEffect(() => { renderCloud(); }, [renderCloud]);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => renderCloud());
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [renderCloud]);

  const baseBox = `relative rounded-[40px] overflow-hidden border border-gray-100/80 dark:border-white/5 shadow-sm ${className}`;
  // 径向渐变底色：让视觉焦点自然聚拢到中间
  const bgLight = 'bg-[radial-gradient(ellipse_at_center,_#f0faf4_0%,_#ffffff_55%,_#f4f7fb_100%)]';
  const bgDark = 'dark:bg-[radial-gradient(ellipse_at_center,_rgba(7,193,96,0.12)_0%,_#141415_55%,_#0f0f10_100%)]';

  if (loading) {
    return (
      <div className={`${baseBox} ${bgLight} ${bgDark} p-12 flex flex-col items-center justify-center gap-3`}>
        <div className="w-6 h-6 border-2 border-[#07c160] border-t-transparent rounded-full animate-spin" />
        <div className="text-sm font-bold text-[#1d1d1f] dk-text">正在生成词云</div>
        <p className="text-xs text-gray-400">分析文本消息中的高频词汇…</p>
      </div>
    );
  }

  if (!data.length) {
    return (
      <div className={`${baseBox} ${bgLight} ${bgDark} p-12 flex items-center justify-center`}>
        <div className="text-gray-200 dark:text-gray-700 font-black text-3xl tracking-wider">STILLNESS</div>
      </div>
    );
  }

  const maxCount = data[0]?.count ?? 1;
  const pinnedRank = pinned ? (data.findIndex(d => d.word === pinned.word) + 1 || null) : null;

  return (
    <div ref={containerRef} className={`${baseBox} ${bgLight} ${bgDark} w-full${privacyMode ? ' privacy-blur-canvas' : ''}`}>
      {/* 画布：渲染完成后淡入 */}
      <canvas
        ref={canvasRef}
        className="w-full h-full transition-opacity duration-500 ease-out"
        style={{ opacity: fadedIn ? 1 : 0 }}
      />

      {/* 悬浮 tooltip（pinned 时隐藏避免打架） */}
      {tooltip && !pinned && (
        <div
          className="absolute pointer-events-none z-10 bg-white/95 dark:bg-[#2c2c2e]/95 backdrop-blur-md shadow-xl rounded-2xl px-3.5 py-2 border border-gray-100 dark:border-white/10"
          style={{
            left: Math.min(tooltip.x + 14, (containerRef.current?.getBoundingClientRect().width ?? 400) - 180),
            top: Math.max(tooltip.y - 58, 8),
          }}
        >
          <div className="text-sm font-black text-[#1d1d1f] dk-text">{tooltip.word}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">
            <span className="text-[#07c160] font-bold">{tooltip.count.toLocaleString()}</span> 次 ·
            <span className="ml-0.5">{Math.round((tooltip.count / maxCount) * 100)}%</span>
          </div>
          <div className="mt-1 h-1.5 bg-gray-100 dark:bg-white/10 rounded-full overflow-hidden" style={{ width: 110 }}>
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#07c160] to-[#06ad56]"
              style={{ width: `${Math.max(5, (tooltip.count / maxCount) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* 点击 pin 详情卡 */}
      {pinned && (
        <div className="absolute z-20 bottom-5 left-1/2 -translate-x-1/2 bg-white/95 dark:bg-[#2c2c2e]/95 backdrop-blur-md shadow-2xl rounded-2xl px-5 py-3.5 border border-gray-100 dark:border-white/10 animate-in fade-in slide-in-from-bottom-3 duration-200 min-w-[280px]">
          <button
            type="button"
            onClick={() => setPinned(null)}
            aria-label="关闭"
            className="absolute -top-2.5 -right-2.5 w-7 h-7 flex items-center justify-center rounded-full bg-white dark:bg-[#2c2c2e] shadow-md border border-gray-100 dark:border-white/10 text-gray-400 hover:text-[#1d1d1f] dark:hover:text-white transition-colors"
          >
            <X size={14} />
          </button>
          <div className="flex items-center gap-4">
            <div className="flex flex-col">
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">
                Top {pinnedRank ?? '?'}
              </span>
              <span className="text-xl font-black text-[#1d1d1f] dk-text leading-tight">{pinned.word}</span>
            </div>
            <div className="flex items-baseline gap-1 ml-auto">
              <span className="text-3xl font-black bg-gradient-to-br from-[#07c160] to-[#06ad56] bg-clip-text text-transparent tabular-nums">
                {pinned.count.toLocaleString()}
              </span>
              <span className="text-xs text-gray-400 font-semibold">次</span>
            </div>
          </div>
          <div className="mt-2.5 h-2 bg-gray-100 dark:bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#07c160] to-[#06ad56] transition-all duration-500"
              style={{ width: `${Math.max(5, (pinned.count / maxCount) * 100)}%` }}
            />
          </div>
          <div className="mt-1 text-[10px] text-gray-400 text-right">
            相较最高频 <span className="font-bold text-gray-500 dark:text-gray-300">{Math.round((pinned.count / maxCount) * 100)}%</span>
          </div>
        </div>
      )}
    </div>
  );
};
