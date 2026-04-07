/**
 * 词云画布组件（支持悬浮/点击显示词频）
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import type { WordCount } from '../../types';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';

declare global {
  interface Window {
    WordCloud: any;
  }
}

interface WordCloudCanvasProps {
  data: WordCount[];
  loading?: boolean;
  className?: string;
  onRendered?: () => void;
}

const COLORS = ['#07c160', '#10aeff', '#ff9500', '#fa5151', '#576b95'];

interface TooltipState {
  word: string;
  count: number;
  x: number;
  y: number;
}

export const WordCloudCanvas: React.FC<WordCloudCanvasProps> = ({
  data,
  loading = false,
  className = 'h-80',
  onRendered,
}) => {
  const { privacyMode } = usePrivacyMode();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const onRenderedRef = useRef(onRendered);
  const wordMapRef = useRef<Map<string, number>>(new Map());
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [pinned, setPinned] = useState<TooltipState | null>(null);
  useEffect(() => { onRenderedRef.current = onRendered; }, [onRendered]);

  const renderCloud = useCallback(() => {
    if (!data.length || !canvasRef.current || !window.WordCloud) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!container) return;

    // 让 canvas 像素尺寸与容器实际尺寸完全一致
    const { width, height } = container.getBoundingClientRect();
    canvas.width = Math.floor(width);
    canvas.height = Math.floor(height);

    const validData = data.filter((i: WordCount) => {
      if (!i.word || typeof i.word !== 'string') return false;
      if (i.word.trim().length === 0 || i.word.length > 20) return false;
      return /[\u4e00-\u9fa5a-zA-Z]/.test(i.word);
    });

    if (!validData.length) { onRenderedRef.current?.(); return; }

    // 建立词 → 次数映射
    const wm = new Map<string, number>();
    validData.forEach(i => wm.set(i.word, i.count));
    wordMapRef.current = wm;

    // 对数字号映射：缩小头部词、放大尾部词，整体分布更均匀
    const scale = canvas.width / 600;
    const maxCount = validData[0].count;
    const minCount = validData[validData.length - 1].count;
    const logMax = Math.log(maxCount + 1);
    const logMin = Math.log(Math.max(minCount, 1));
    const logRange = logMax - logMin || 1;
    const minSize = Math.round(13 * scale);
    const maxSize = Math.round(58 * scale);

    const list = validData.map((i) => {
      const logVal = Math.log(i.count + 1);
      const ratio = (logVal - logMin) / logRange;
      const size = Math.round(minSize + ratio * (maxSize - minSize));
      return [i.word, size];
    });

    // wordcloud2 在渲染完成后触发 wordcloudstop 事件
    const handleStop = () => {
      canvas.removeEventListener('wordcloudstop', handleStop);
      onRenderedRef.current?.();
    };
    canvas.addEventListener('wordcloudstop', handleStop);

    // 清除上次的 tooltip
    setTooltip(null);
    setPinned(null);

    try {
      window.WordCloud(canvas, {
        list,
        gridSize: Math.round(6 * scale),
        weightFactor: 1,
        fontFamily: '"PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
        color: () => COLORS[Math.floor(Math.random() * COLORS.length)],
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
          setTooltip({ word: item[0], count: wm.get(item[0]) ?? 0, x, y });
        },
        click: (item: [string, number] | null) => {
          if (!item) {
            setPinned(null);
            return;
          }
          setPinned(prev =>
            prev && prev.word === item[0] ? null : { word: item[0], count: wm.get(item[0]) ?? 0, x: 0, y: 0 }
          );
        },
      });
    } catch (error) {
      console.error('WordCloud rendering error:', error);
      canvas.removeEventListener('wordcloudstop', handleStop);
      onRenderedRef.current?.();
    }
  }, [data]);

  // 数据变化时重新渲染
  useEffect(() => {
    renderCloud();
  }, [renderCloud]);

  // 容器大小变化时重新渲染
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => renderCloud());
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [renderCloud]);

  const baseClass = `bg-[#f8f9fb] rounded-[40px] border border-gray-50 ${className}`;

  if (loading) {
    return (
      <div className={`${baseClass} p-12 flex items-center justify-center`}>
        <div className="text-[#07c160] font-black animate-pulse uppercase tracking-[0.3em] text-lg">
          Analysing...
        </div>
      </div>
    );
  }

  if (!data.length) {
    return (
      <div className={`${baseClass} p-12 flex items-center justify-center`}>
        <div className="text-gray-200 font-black text-3xl tracking-wider">
          STILLNESS
        </div>
      </div>
    );
  }

  // 当前显示的 tooltip（pinned 优先）
  const activeTooltip = tooltip;
  const maxCount = data[0]?.count ?? 1;

  return (
    <div ref={containerRef} className={`${baseClass} w-full relative${privacyMode ? ' privacy-blur-canvas' : ''}`}>
      <canvas ref={canvasRef} className="w-full h-full" />

      {/* 悬浮 tooltip */}
      {activeTooltip && !pinned && (
        <div
          className="absolute pointer-events-none z-10 bg-white dark:bg-[#2d2d2f] shadow-xl rounded-xl px-3 py-2 border border-gray-100 dark:border-white/10 transition-all duration-100"
          style={{
            left: Math.min(activeTooltip.x + 14, (containerRef.current?.getBoundingClientRect().width ?? 400) - 160),
            top: Math.max(activeTooltip.y - 50, 8),
          }}
        >
          <div className="text-sm font-bold text-[#1d1d1f] dk-text">{activeTooltip.word}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">出现 <span className="text-[#07c160] font-bold">{activeTooltip.count.toLocaleString()}</span> 次</div>
          <div className="mt-1 h-1.5 bg-gray-100 dark:bg-white/10 rounded-full overflow-hidden" style={{ width: 100 }}>
            <div className="h-full bg-[#07c160] rounded-full" style={{ width: `${Math.max(5, (activeTooltip.count / maxCount) * 100)}%` }} />
          </div>
        </div>
      )}

      {/* 点击固定的详情卡 */}
      {pinned && (
        <div
          className="absolute z-20 bottom-4 left-1/2 -translate-x-1/2 bg-white dark:bg-[#2d2d2f] shadow-2xl rounded-2xl px-5 py-3 border border-gray-100 dark:border-white/10 animate-in fade-in duration-150"
        >
          <button
            onClick={() => setPinned(null)}
            className="absolute -top-2 -right-2 w-6 h-6 flex items-center justify-center rounded-full bg-gray-200 dark:bg-gray-600 text-gray-500 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors text-xs font-bold"
          >
            &times;
          </button>
          <div className="flex items-center gap-4">
            <div>
              <div className="text-lg font-black text-[#1d1d1f] dk-text">{pinned.word}</div>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-black text-[#07c160]">{pinned.count.toLocaleString()}</span>
              <span className="text-xs text-gray-400">次</span>
            </div>
            <div className="ml-2 w-16">
              <div className="text-[10px] text-gray-400 text-right mb-0.5">
                Top {(() => {
                  const rank = data.findIndex(d => d.word === pinned.word);
                  return rank >= 0 ? rank + 1 : '?';
                })()}
              </div>
              <div className="h-2 bg-gray-100 dark:bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-[#07c160] rounded-full" style={{ width: `${Math.max(5, (pinned.count / maxCount) * 100)}%` }} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
