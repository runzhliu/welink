/**
 * 首次启动多步 Spotlight 引导：
 * - 暗色遮罩 + 镂空高亮当前目标（box-shadow 0 0 0 9999px 技巧，避免 SVG mask 成本）
 * - 绿色脉冲环随目标移动
 * - 气泡提示带步进、上一步/下一步/跳过并不再提示
 * - 目标用 data-tour="xxx" 选择器；找不到目标就居中展示文案
 * - 桌面端默认右侧气泡（sidebar 在左），手机端 sidebar 在底，自动切换到上方
 *
 * 用 localStorage welink_onboarding_tour_v1=1 记标；版本化以便将来改步骤时重推。
 */
import { useEffect, useLayoutEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useEscape } from '../../hooks/useEscape';

export interface TourStep {
  selector?: string;                      // data-tour 属性值，不填则居中卡片
  title: string;
  body: string;
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  mobilePlacement?: 'top' | 'bottom' | 'left' | 'right' | 'center';
}

interface Props {
  steps: TourStep[];
  onFinish: () => void;                   // 完成/跳过都走这里（调用方负责 localStorage）
}

const PAD = 8;                             // 高亮框外扩
const GAP = 14;                            // 气泡离目标的距离
const TOOLTIP_W = 320;
const MARGIN = 12;                         // 气泡距屏幕边的最小距离

export const SpotlightTour: React.FC<Props> = ({ steps, onFinish }) => {
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight });

  const step = steps[idx];
  const isMobile = viewport.w < 640;
  const placement = step?.selector
    ? ((isMobile && step.mobilePlacement) || step.placement || 'right')
    : 'center';

  useEscape(true, onFinish);

  // 追踪目标位置：step 切换 / 窗口变化 / sidebar 折叠动画时都要更新
  useLayoutEffect(() => {
    if (!step) return;
    const measure = () => {
      if (!step.selector) { setRect(null); return; }
      // 桌面 sidebar 和手机底部 nav 共用同一个 data-tour — 挑第一个真正可见的
      const els = document.querySelectorAll<HTMLElement>(`[data-tour="${step.selector}"]`);
      let picked: DOMRect | null = null;
      els.forEach(el => {
        if (picked) return;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) picked = r;
      });
      setRect(picked);
    };
    measure();
    // 轻量轮询 —— 覆盖 sidebar 折叠、图片加载等异步布局变化
    const t = setInterval(measure, 250);
    const onResize = () => {
      setViewport({ w: window.innerWidth, h: window.innerHeight });
      measure();
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', measure, true);
    return () => {
      clearInterval(t);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', measure, true);
    };
  }, [idx, step]);

  if (!step) return null;

  const tooltipW = Math.min(TOOLTIP_W, viewport.w - MARGIN * 2);

  // 计算气泡定位（clamp 在屏幕内）
  const tooltipPos: { left: number; top: number } = (() => {
    if (!rect || placement === 'center') {
      return { left: (viewport.w - tooltipW) / 2, top: viewport.h / 2 - 120 };
    }
    let left = 0, top = 0;
    switch (placement) {
      case 'right':
        left = rect.right + GAP;
        top = rect.top + rect.height / 2 - 80;
        break;
      case 'left':
        left = rect.left - GAP - tooltipW;
        top = rect.top + rect.height / 2 - 80;
        break;
      case 'bottom':
        left = rect.left + rect.width / 2 - tooltipW / 2;
        top = rect.bottom + GAP;
        break;
      case 'top':
        left = rect.left + rect.width / 2 - tooltipW / 2;
        top = rect.top - GAP - 180;
        break;
    }
    left = Math.max(MARGIN, Math.min(left, viewport.w - tooltipW - MARGIN));
    top = Math.max(MARGIN, Math.min(top, viewport.h - 220));
    return { left, top };
  })();

  const next = () => (idx < steps.length - 1 ? setIdx(idx + 1) : onFinish());
  const prev = () => idx > 0 && setIdx(idx - 1);

  const showCutout = rect && placement !== 'center';

  return (
    <div className="fixed inset-0 z-[260] animate-in fade-in duration-200">
      {/* 镂空 + 暗遮罩：没有目标时整屏盖一层暗色 */}
      {showCutout ? (
        <div
          className="absolute rounded-xl transition-all duration-300 ease-out pointer-events-none"
          style={{
            left: rect!.left - PAD,
            top: rect!.top - PAD,
            width: rect!.width + PAD * 2,
            height: rect!.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
            outline: '2px solid #07c160',
            outlineOffset: 0,
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/55 pointer-events-auto" />
      )}

      {/* 脉冲圈 */}
      {showCutout && (
        <div
          className="absolute rounded-xl pointer-events-none"
          style={{
            left: rect!.left - PAD,
            top: rect!.top - PAD,
            width: rect!.width + PAD * 2,
            height: rect!.height + PAD * 2,
            animation: 'welink-tour-pulse 2s ease-in-out infinite',
          }}
        />
      )}
      <style>{`
        @keyframes welink-tour-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(7,193,96,0.45); }
          50%      { box-shadow: 0 0 0 10px rgba(7,193,96,0); }
        }
      `}</style>

      {/* 气泡 */}
      <div
        className="absolute bg-white dark:bg-[#1d1d1f] dk-border border rounded-2xl shadow-2xl p-5 animate-in fade-in zoom-in-95 duration-200"
        style={{ left: tooltipPos.left, top: tooltipPos.top, width: tooltipW }}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-[#07c160]">{idx + 1} / {steps.length}</span>
          <button
            onClick={onFinish}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
            title="不再提示"
          >
            <X size={12} />
            跳过并不再提示
          </button>
        </div>
        <h3 className="text-base font-black text-[#1d1d1f] dk-text mb-1.5">{step.title}</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed mb-4 whitespace-pre-line">{step.body}</p>
        <div className="flex items-center justify-between">
          <div className="flex gap-1">
            {steps.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === idx ? 'w-5 bg-[#07c160]' : 'w-1.5 bg-gray-200 dark:bg-white/15'
                }`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {idx > 0 && (
              <button
                onClick={prev}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10 transition-all"
              >
                上一步
              </button>
            )}
            <button
              onClick={next}
              className="px-4 py-1.5 text-xs font-bold rounded-lg bg-[#07c160] text-white hover:bg-[#06ad56] transition-all"
            >
              {idx === steps.length - 1 ? '开始使用' : '下一步'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
