/**
 * 词云画布组件
 */

import React, { useRef, useEffect, useCallback } from 'react';
import type { WordCount } from '../../types';

declare global {
  interface Window {
    WordCloud: any;
  }
}

interface WordCloudCanvasProps {
  data: WordCount[];
  loading?: boolean;
}

const COLORS = ['#07c160', '#10aeff', '#ff9500', '#fa5151', '#576b95'];

export const WordCloudCanvas: React.FC<WordCloudCanvasProps> = ({
  data,
  loading = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

    if (!validData.length) return;

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

    try {
      window.WordCloud(canvas, {
        list,
        gridSize: Math.round(6 * scale),
        weightFactor: 1,
        fontFamily: '"PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
        color: () => COLORS[Math.floor(Math.random() * COLORS.length)],
        rotateRatio: 0,          // 中文词云不旋转，可读性更好
        backgroundColor: 'transparent',
        shuffle: false,           // 按词频顺序摆放，高频词占据中心
        drawOutOfBound: false,
        shrinkToFit: true,
        minRotation: 0,
        maxRotation: 0,
      });
    } catch (error) {
      console.error('WordCloud rendering error:', error);
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

  if (loading) {
    return (
      <div className="bg-[#f8f9fb] p-12 rounded-[40px] border border-gray-50 flex items-center justify-center h-80">
        <div className="text-[#07c160] font-black animate-pulse uppercase tracking-[0.3em] text-lg">
          Analysing...
        </div>
      </div>
    );
  }

  if (!data.length) {
    return (
      <div className="bg-[#f8f9fb] p-12 rounded-[40px] border border-gray-50 flex items-center justify-center h-80">
        <div className="text-gray-200 font-black text-3xl tracking-wider">
          STILLNESS
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="bg-[#f8f9fb] rounded-[40px] border border-gray-50 w-full h-80">
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  );
};
