/**
 * Lab 卡片共享组件 —— 截图导出（PNG）时的统一 WeLink 品牌区。
 *
 * 两个导出：
 *   1. <WelinkBrand label="..." date="..." /> —— 用于 JSX 渲染的卡片底部
 *   2. WELINK_LOGO_HTML —— 用于 document.createElement('div').innerHTML
 *      的字符串（DOM-based 截图脚本里 inject 用）
 *
 * 设计：用内联 SVG 而非 <img src=/logo.svg>，避免 html2canvas 加载图
 * 失败 / CORS / 缓存等不确定性。logo 是 16×16，跟 footer 文字基线对齐。
 */

import React from 'react';

// 内联 SVG（与 /logo.svg 视觉一致，绿色圆角方块 + 白色对话气泡）
// 用 viewBox 100×100，渲染时通过 width/height 缩放
const LOGO_VIEWBOX = '0 0 100 100';
const LOGO_PATHS = (
  <>
    <rect width="100" height="100" rx="22" fill="#07c160" />
    <g transform="translate(22, 20)">
      <rect x="2" y="2" width="52" height="42" rx="7" fill="none" stroke="white" strokeWidth="5" strokeLinejoin="round" />
      <line x1="14" y1="17" x2="42" y2="17" stroke="white" strokeWidth="4.5" strokeLinecap="round" />
      <line x1="14" y1="27" x2="34" y2="27" stroke="white" strokeWidth="4.5" strokeLinecap="round" />
      <polyline points="8,44 2,56 16,48" fill="white" stroke="white" strokeWidth="1" strokeLinejoin="round" />
    </g>
  </>
);

interface WelinkBrandProps {
  /** Lab 名字，如 "暧昧探测" */
  label: string;
  /** 左侧自定义文案（如 "已扫描 200 个联系人 · 命中 63 人"），可选 */
  leftText?: React.ReactNode;
  /** 颜色基调，默认浅灰底（适合大多数 lab）；'dark' 适合深色卡片 */
  variant?: 'light' | 'dark';
}

/**
 * JSX 版品牌区。放在 lab 卡片底部，html2canvas 截图时一起被捕获。
 */
export const WelinkBrand: React.FC<WelinkBrandProps> = ({ label, leftText, variant = 'light' }) => {
  const dark = variant === 'dark';
  return (
    <div
      className={`px-7 py-3 flex items-center justify-between text-[11px] border-t ${
        dark
          ? 'bg-white/[0.03] text-white/50 border-white/10'
          : 'bg-gray-50 dark:bg-white/5 text-gray-500 dark:text-gray-400 border-gray-100 dark:border-white/5'
      }`}
    >
      <span className="truncate">{leftText}</span>
      <span className="inline-flex items-center gap-1.5 flex-shrink-0">
        <svg width="14" height="14" viewBox={LOGO_VIEWBOX} aria-hidden>
          {LOGO_PATHS}
        </svg>
        <span className="font-semibold tracking-wide">WeLink</span>
        <span className="opacity-60">·</span>
        <span>{label}</span>
      </span>
    </div>
  );
};

/**
 * DOM 版品牌区 —— 给 exportPng 里 `document.createElement('div')` 用。
 * 直接拿去 `footer.innerHTML = welinkBrandHTML({...})`。
 *
 * 用 inline-svg + flex 居中文字，跟 JSX 版视觉一致。
 */
export function welinkBrandHTML(opts: { label: string; date?: string; variant?: 'light' | 'dark' }): string {
  const dark = opts.variant === 'dark';
  const bg = dark ? '#0b0b14' : '#f7f8fa';
  const fg = dark ? '#888' : '#8a94a6';
  const border = dark ? 'rgba(255,255,255,0.06)' : '#eef1f7';
  const tail = opts.date ? ` · ${opts.date}` : '';

  // SVG markup 直接拼字符串。注意 attribute 用双引号，整体用反引号。
  const svg = `<svg width="14" height="14" viewBox="${LOGO_VIEWBOX}" style="display:inline-block;vertical-align:-3px;margin-right:6px"><rect width="100" height="100" rx="22" fill="#07c160"/><g transform="translate(22, 20)"><rect x="2" y="2" width="52" height="42" rx="7" fill="none" stroke="white" stroke-width="5" stroke-linejoin="round"/><line x1="14" y1="17" x2="42" y2="17" stroke="white" stroke-width="4.5" stroke-linecap="round"/><line x1="14" y1="27" x2="34" y2="27" stroke="white" stroke-width="4.5" stroke-linecap="round"/><polyline points="8,44 2,56 16,48" fill="white" stroke="white" stroke-width="1" stroke-linejoin="round"/></g></svg>`;

  return `<div style="padding:14px 28px;background:${bg};color:${fg};font-size:11px;text-align:center;border-top:1px solid ${border};">${svg}<span style="font-weight:600;letter-spacing:0.02em;">WeLink</span> · ${escapeHTML(opts.label)}${tail}</div>`;
}

// 防御性 escape —— label 通常是常量，但加一道防 XSS 没坏处
function escapeHTML(s: string): string {
  return s.replace(/[&<>"']/g, ch => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return ch;
    }
  });
}
