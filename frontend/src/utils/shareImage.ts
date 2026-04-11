/**
 * shareImage.ts — HTML→PNG 实现的分享卡片截图
 * 使用 html-to-image 捕获真实 DOM，marked 渲染 Markdown（含表格）
 * 支持所有现代浏览器 + macOS App WebView
 */

import html2canvas from 'html2canvas';
import { marked } from 'marked';
import QRCode from 'qrcode';

// ─── 类型 ──────────────────────────────────────────────────────────────────────

export interface ShareImageOptions {
  question?: string;
  answer: string;
  contactName?: string;
  avatarUrl?: string;
  stats?: {
    provider?: string;
    model?: string;
    elapsedSecs?: number;
    tokensPerSec?: number;
    charCount?: number;
    timestamp?: number;
  };
}

// ─── 头像预加载（fetch → data URL，避免 html2canvas 截图时异步加载失败）────────

async function fetchAvatarDataUrl(avatarUrl?: string): Promise<string | null> {
  if (!avatarUrl) return null;
  try {
    // no-store 防止浏览器缓存旧联系人头像
    const proxied = `/api/avatar?url=${encodeURIComponent(avatarUrl)}&_t=${Date.now()}`;
    const res = await fetch(proxied, { cache: 'no-store' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('FileReader failed'));
      reader.readAsDataURL(blob);
    });
  } catch {
    return null; // 获取失败时静默降级，显示文字首字母
  }
}

// ─── WebView 检测 & 下载 ───────────────────────────────────────────────────────

function isWebView(): boolean {
  const ua = navigator.userAgent;
  return ua.includes('AppleWebKit') && !ua.includes('Safari') && !ua.includes('Chrome') && !ua.includes('Firefox');
}

/** 下载图片；App 模式返回保存路径，浏览器模式返回文件名 */
async function downloadPng(dataUrl: string, filename: string): Promise<string> {
  if (isWebView()) {
    // App 模式：通过后端写入 ~/Downloads（WebView 不支持 <a> download）
    const base64 = dataUrl.split(',')[1] ?? dataUrl;
    const res = await fetch('/api/app/save-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, content: base64, encoding: 'base64' }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(err.error ?? '保存失败');
    }
    const data = await res.json() as { path?: string };
    return data.path ?? filename;
  } else {
    const link = document.createElement('a');
    link.download = filename;
    link.href = dataUrl;
    link.click();
    return filename;
  }
}

// ─── Markdown 内联样式 ─────────────────────────────────────────────────────────

const MARKDOWN_CSS = `
.sa h1,.sa h2,.sa h3,.sa h4 { font-weight:700; margin:10px 0 5px; color:#1d1d1f; line-height:1.4; }
.sa h1 { font-size:17px; } .sa h2 { font-size:16px; } .sa h3,.sa h4 { font-size:14px; }
.sa p  { margin:5px 0; line-height:1.7; }
.sa ul,.sa ol { padding-left:22px; margin:5px 0; }
.sa li { margin:3px 0; line-height:1.6; }
.sa strong { font-weight:700; }
.sa em { font-style:italic; }
.sa hr { border:none; border-top:1px solid #e5e7eb; margin:10px 0; }
.sa code { background:#f3f4f6; padding:1px 5px; border-radius:4px; font-size:12px; font-family:monospace; }
.sa pre  { background:#f3f4f6; padding:10px 12px; border-radius:8px; margin:8px 0; overflow-x:auto; }
.sa pre code { background:none; padding:0; font-size:12px; }
.sa blockquote { border-left:3px solid #07c160; padding-left:12px; color:#666; margin:8px 0; }
.sa table { border-collapse:collapse; width:100%; margin:10px 0; font-size:13px; }
.sa th { background:#f3f4f6; font-weight:600; padding:8px 10px; border:1px solid #e5e7eb; text-align:left; }
.sa td { padding:7px 10px; border:1px solid #e5e7eb; line-height:1.5; }
.sa tr:nth-child(even) td { background:#fafafa; }
.sa a  { color:#07c160; text-decoration:none; }
`;

// ─── SVG 字符串加载为 HTMLImageElement ────────────────────────────────────────

function loadSvgAsImage(svgStr: string, size: number): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    // 注入明确尺寸，保证 Image 有 naturalWidth/naturalHeight
    const sized = svgStr.replace('<svg ', `<svg width="${size * 2}" height="${size * 2}" `);
    const blob = new Blob([sized], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    const timer = setTimeout(() => { URL.revokeObjectURL(url); resolve(null); }, 4000);
    img.onload = () => { clearTimeout(timer); URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { clearTimeout(timer); URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

function loadDataUrlAsImage(dataUrl: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve(null), 4000);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = dataUrl;
  });
}

// ─── GitHub SVG 源码 ───────────────────────────────────────────────────────────

const GITHUB_SVG_SOURCE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#888" d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/></svg>`;

// ─── 社交体检报告分享图 ─────────────────────────────────────────────────────

export interface ReportImageOptions {
  score: number;
  scoreLabel: string;
  stats: { label: string; value: string }[];
  topContactName?: string;
  topContactAvatar?: string;
  topContactMessages?: number;
  highlights: string[];
}

/** 生成社交体检报告分享图；全部 Canvas 2D 绘制，与 AI 分析共享 header/footer */
export async function generateReportImage(options: ReportImageOptions): Promise<string> {
  const FONT = "system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif";
  const S = 2;
  const W = 640;
  const FF = FONT;

  const [qrDataUrl, faviconImg, githubImg, avatarDataUrl] = await Promise.all([
    QRCode.toDataURL('https://welink.click', { width: 96, margin: 1, color: { dark: '#1d1d1f', light: '#f8f9fb' } }),
    fetch('/favicon.svg').then(r => r.text()).then(svg => loadSvgAsImage(svg, 42)).catch(() => null),
    loadSvgAsImage(GITHUB_SVG_SOURCE, 12),
    fetchAvatarDataUrl(options.topContactAvatar),
  ]);
  const qrImageEl = await loadDataUrlAsImage(qrDataUrl);
  const avatarImageEl = avatarDataUrl ? await loadDataUrlAsImage(avatarDataUrl) : null;
  const year = new Date().getFullYear();

  // 计算内容高度
  const HEADER_H = 84;
  const FOOTER_H = 68;
  const PAD = 36;
  let bodyH = 0;
  bodyH += 60;  // score
  bodyH += 30;  // score label
  bodyH += 30;  // gap
  bodyH += 70;  // stat pills
  bodyH += 24;  // gap
  if (options.topContactName) bodyH += 60; // top contact
  bodyH += 16; // gap
  bodyH += options.highlights.length * 28 + 10; // highlights
  bodyH += 20; // bottom pad

  const totalH = HEADER_H + bodyH + FOOTER_H;
  const cvs = document.createElement('canvas');
  cvs.width = W * S;
  cvs.height = totalH * S;
  const ctx = cvs.getContext('2d')!;

  // ── White background ──
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W * S, totalH * S);

  // ── Header (same as AI share) ──
  const hGrad = ctx.createLinearGradient(0, 0, W * S, 0);
  hGrad.addColorStop(0, '#09d46a');
  hGrad.addColorStop(1, '#06a850');
  ctx.fillStyle = hGrad;
  ctx.fillRect(0, 0, W * S, HEADER_H * S);

  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.arc((W - 15 + 55) * S, (6 + 55) * S, 55 * S, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.beginPath();
  ctx.arc((W + 25 + 35) * S, (42 + 35) * S, 35 * S, 0, Math.PI * 2);
  ctx.fill();

  if (faviconImg) {
    ctx.save();
    ctx.beginPath();
    const [lx, ly, lw, lh, lr] = [36*S, 21*S, 42*S, 42*S, 10*S];
    ctx.moveTo(lx+lr, ly);
    ctx.lineTo(lx+lw-lr, ly); ctx.arcTo(lx+lw, ly, lx+lw, ly+lr, lr);
    ctx.lineTo(lx+lw, ly+lh-lr); ctx.arcTo(lx+lw, ly+lh, lx+lw-lr, ly+lh, lr);
    ctx.lineTo(lx+lr, ly+lh); ctx.arcTo(lx, ly+lh, lx, ly+lh-lr, lr);
    ctx.lineTo(lx, ly+lr); ctx.arcTo(lx, ly, lx+lr, ly, lr);
    ctx.closePath(); ctx.clip();
    ctx.drawImage(faviconImg, lx, ly, lw, lh);
    ctx.restore();
  }

  const TX = (faviconImg ? 90 : 36) * S;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.font = `900 ${20*S}px ${FF}`;
  ctx.fillText('WeLink', TX, 32 * S);
  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.font = `${12*S}px ${FF}`;
  ctx.fillText('微信聊天记录 AI 助手', TX, 55 * S);

  // ── Body ──
  let y = HEADER_H + 40; // start y

  // Score
  ctx.textAlign = 'center';
  const scoreColor = options.score >= 70 ? '#22c55e' : options.score >= 40 ? '#eab308' : '#f87171';
  ctx.fillStyle = scoreColor;
  ctx.font = `900 ${52*S}px ${FF}`;
  ctx.fillText(String(options.score), (W / 2) * S, y * S);
  y += 50;

  // Score label
  ctx.fillStyle = '#999999';
  ctx.font = `${13*S}px ${FF}`;
  ctx.fillText(`社交健康指数 · ${options.scoreLabel}`, (W / 2) * S, y * S);
  y += 36;
  ctx.textAlign = 'left';

  // Stat pills (4 columns)
  const pillW = (W - PAD * 2 - 12 * 3) / 4;
  const pillH = 60;
  for (let i = 0; i < options.stats.length && i < 4; i++) {
    const px = PAD + i * (pillW + 12);
    // pill background
    ctx.fillStyle = '#f8f9fb';
    const roundRect = (x: number, yy: number, w: number, h: number, r: number) => {
      ctx.beginPath();
      ctx.moveTo(x+r, yy); ctx.lineTo(x+w-r, yy); ctx.arcTo(x+w, yy, x+w, yy+r, r);
      ctx.lineTo(x+w, yy+h-r); ctx.arcTo(x+w, yy+h, x+w-r, yy+h, r);
      ctx.lineTo(x+r, yy+h); ctx.arcTo(x, yy+h, x, yy+h-r, r);
      ctx.lineTo(x, yy+r); ctx.arcTo(x, yy, x+r, yy, r);
      ctx.closePath();
    };
    roundRect(px*S, y*S, pillW*S, pillH*S, 10*S);
    ctx.fill();

    // value
    ctx.textAlign = 'center';
    ctx.fillStyle = '#1d1d1f';
    ctx.font = `700 ${16*S}px ${FF}`;
    ctx.fillText(options.stats[i].value, (px + pillW/2)*S, (y + 24)*S);

    // label
    ctx.fillStyle = '#999999';
    ctx.font = `${10*S}px ${FF}`;
    ctx.fillText(options.stats[i].label, (px + pillW/2)*S, (y + 46)*S);
    ctx.textAlign = 'left';
  }
  y += pillH + 24;

  // Top contact
  if (options.topContactName) {
    // green bg
    const tcX = PAD, tcW = W - PAD * 2, tcH = 52;
    ctx.fillStyle = '#f0fdf4';
    const roundRect = (x: number, yy: number, w: number, h: number, r: number) => {
      ctx.beginPath();
      ctx.moveTo(x+r, yy); ctx.lineTo(x+w-r, yy); ctx.arcTo(x+w, yy, x+w, yy+r, r);
      ctx.lineTo(x+w, yy+h-r); ctx.arcTo(x+w, yy+h, x+w-r, yy+h, r);
      ctx.lineTo(x+r, yy+h); ctx.arcTo(x, yy+h, x, yy+h-r, r);
      ctx.lineTo(x, yy+r); ctx.arcTo(x, yy, x+r, yy, r);
      ctx.closePath();
    };
    roundRect(tcX*S, y*S, tcW*S, tcH*S, 12*S);
    ctx.fill();

    // avatar circle
    const avSize = 32;
    const avX = tcX + 10;
    const avY = y + (tcH - avSize) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc((avX + avSize/2)*S, (avY + avSize/2)*S, (avSize/2)*S, 0, Math.PI*2);
    ctx.clip();
    if (avatarImageEl) {
      ctx.drawImage(avatarImageEl, avX*S, avY*S, avSize*S, avSize*S);
    } else {
      ctx.fillStyle = '#07c160';
      ctx.fillRect(avX*S, avY*S, avSize*S, avSize*S);
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 ${14*S}px ${FF}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(options.topContactName.charAt(0), (avX+avSize/2)*S, (avY+avSize/2)*S);
      ctx.textAlign = 'left';
    }
    ctx.restore();

    // name
    const nameX = avX + avSize + 10;
    ctx.fillStyle = '#1d1d1f';
    ctx.font = `600 ${14*S}px ${FF}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(options.topContactName, nameX*S, (y + tcH/2 - 9)*S);

    // subtitle
    ctx.fillStyle = '#999999';
    ctx.font = `${11*S}px ${FF}`;
    ctx.fillText(
      `${options.topContactMessages?.toLocaleString() ?? ''} 条消息 · 最佳拍档`,
      nameX*S, (y + tcH/2 + 10)*S
    );

    y += tcH + 20;
  }

  // Highlights
  for (const text of options.highlights) {
    // green dot
    ctx.fillStyle = '#07c160';
    ctx.beginPath();
    ctx.arc((PAD + 4)*S, (y + 2)*S, 3*S, 0, Math.PI*2);
    ctx.fill();

    // text
    ctx.fillStyle = '#1d1d1f';
    ctx.font = `${13*S}px ${FF}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, (PAD + 16)*S, y*S);
    y += 28;
  }

  // ── Footer (same as AI share) ──
  const fY = (totalH - FOOTER_H) * S;
  ctx.fillStyle = '#f8f9fb';
  ctx.fillRect(0, fY, W*S, FOOTER_H*S);
  ctx.fillStyle = '#ececec';
  ctx.fillRect(0, fY, W*S, 1*S);

  ctx.textBaseline = 'middle';

  if (githubImg) {
    ctx.drawImage(githubImg, 36*S, fY + (25-6)*S, 12*S, 12*S);
  }
  ctx.fillStyle = '#888888';
  ctx.font = `${11*S}px ${FF}`;
  ctx.fillText('https://github.com/runzhliu/welink', (githubImg ? 52 : 36)*S, fY + 25*S);

  ctx.fillStyle = '#bbbbbb';
  ctx.font = `${10*S}px ${FF}`;
  ctx.fillText(`© ${year} @runzhliu · AGPL-3.0`, 36*S, fY + 43*S);

  const QR_SIZE = 48, QR_R = 36, QR_TOP = (FOOTER_H-QR_SIZE)/2;
  const QR_X = W - QR_R - QR_SIZE;
  if (qrImageEl) {
    ctx.drawImage(qrImageEl, QR_X*S, fY + QR_TOP*S, QR_SIZE*S, QR_SIZE*S);
  }

  ctx.textAlign = 'right';
  const CX = (QR_X - 10) * S;
  ctx.fillStyle = '#555555';
  ctx.font = `700 ${11*S}px ${FF}`;
  ctx.fillText('你也想分析微信聊天记录？', CX, fY + 26*S);
  ctx.fillStyle = '#07c160';
  ctx.font = `${10*S}px ${FF}`;
  ctx.fillText('扫码免费体验 →', CX, fY + 43*S);
  ctx.textAlign = 'left';

  // ── Export ──
  const dataUrl = cvs.toDataURL('image/png');
  const filename = `welink-social-report-${Date.now()}.png`;
  return downloadPng(dataUrl, filename);
}

// ─── 主函数 ───────────────────────────────────────────────────────────────────

/** 生成并下载分享图片；返回保存路径（App 模式）或文件名（浏览器模式） */
export async function generateShareImage(options: ShareImageOptions): Promise<string> {
  const { question, answer, contactName, avatarUrl, stats } = options;

  const FONT = "system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif";

  // 并行：生成二维码 + 渲染 Markdown + 预加载头像 + 加载图标
  marked.use({ breaks: true });
  const [qrDataUrl, answerHtml, avatarDataUrl, faviconImg, githubImg] = await Promise.all([
    QRCode.toDataURL('https://welink.click', { width: 96, margin: 1, color: { dark: '#1d1d1f', light: '#f8f9fb' } }),
    Promise.resolve(marked.parse(answer) as string),
    fetchAvatarDataUrl(avatarUrl),
    fetch('/favicon.svg').then(r => r.text()).then(svg => loadSvgAsImage(svg, 42)).catch(() => null),
    loadSvgAsImage(GITHUB_SVG_SOURCE, 12),
  ]);
  // QR / 头像 data URL → Image 对象（Canvas drawImage 需要）
  const qrImageEl = await loadDataUrlAsImage(qrDataUrl);
  const avatarImageEl = avatarDataUrl ? await loadDataUrlAsImage(avatarDataUrl) : null;
  const year = new Date().getFullYear();

  // ── 构建卡片 DOM ────────────────────────────────────────────────────────────
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';

  const card = document.createElement('div');
  card.style.cssText = `width:640px;background:#fff;font-family:${FONT};`;

  const S = 2;   // @2x
  const W = 640;
  const FF = FONT; // font-family 字符串

  // ── Header（Canvas 2D 直接绘制，彻底绕开 html2canvas CSS 对齐问题）──
  const headerCvs = document.createElement('canvas');
  headerCvs.width = W * S;
  headerCvs.height = 84 * S;
  headerCvs.style.cssText = `width:${W}px;height:84px;display:block;`;
  const hCtx = headerCvs.getContext('2d')!;

  // 渐变背景
  const hGrad = hCtx.createLinearGradient(0, 0, W * S, 0);
  hGrad.addColorStop(0, '#09d46a');
  hGrad.addColorStop(1, '#06a850');
  hCtx.fillStyle = hGrad;
  hCtx.fillRect(0, 0, W * S, 84 * S);

  // 装饰圆圈
  hCtx.fillStyle = 'rgba(255,255,255,0.08)';
  hCtx.beginPath();
  hCtx.arc((W - 15 + 55) * S, (6 + 55) * S, 55 * S, 0, Math.PI * 2);
  hCtx.fill();
  hCtx.fillStyle = 'rgba(255,255,255,0.06)';
  hCtx.beginPath();
  hCtx.arc((W + 25 + 35) * S, (42 + 35) * S, 35 * S, 0, Math.PI * 2);
  hCtx.fill();

  // Logo（42×42, x=36, y=21, 圆角 r=10）
  if (faviconImg) {
    hCtx.save();
    hCtx.beginPath();
    const [lx, ly, lw, lh, lr] = [36*S, 21*S, 42*S, 42*S, 10*S];
    hCtx.moveTo(lx+lr, ly);
    hCtx.lineTo(lx+lw-lr, ly); hCtx.arcTo(lx+lw, ly, lx+lw, ly+lr, lr);
    hCtx.lineTo(lx+lw, ly+lh-lr); hCtx.arcTo(lx+lw, ly+lh, lx+lw-lr, ly+lh, lr);
    hCtx.lineTo(lx+lr, ly+lh); hCtx.arcTo(lx, ly+lh, lx, ly+lh-lr, lr);
    hCtx.lineTo(lx, ly+lr); hCtx.arcTo(lx, ly, lx+lr, ly, lr);
    hCtx.closePath(); hCtx.clip();
    hCtx.drawImage(faviconImg, lx, ly, lw, lh);
    hCtx.restore();
  }

  // 文字组（textBaseline=middle，y 为每行中心）
  // 文字组高 44px → top=(84-44)/2=20px；WeLink 中心 y=32px；副标题中心 y=55px
  const TX = (faviconImg ? 90 : 36) * S;
  hCtx.textBaseline = 'middle';
  hCtx.fillStyle = '#ffffff';
  hCtx.font = `900 ${20*S}px ${FF}`;
  hCtx.fillText('WeLink', TX, 32 * S);
  hCtx.fillStyle = 'rgba(255,255,255,0.78)';
  hCtx.font = `${12*S}px ${FF}`;
  hCtx.fillText('微信聊天记录 AI 助手', TX, 55 * S);

  const header = document.createElement('div');
  header.style.cssText = 'line-height:0;font-size:0;overflow:hidden;';
  header.appendChild(headerCvs);

  // ── Body ──
  const body = document.createElement('div');
  body.style.cssText = 'padding:28px 36px;background:#fff;';

  // 联系人徽章（Canvas 2D，绕开 html2canvas flexbox 垂直居中失效问题）
  if (contactName) {
    const BH = 38; // 总高度：5px padding + 28px avatar + 5px padding
    const initial = contactName.slice(0, 1);
    const badgeText = `与「${contactName}」的对话分析`;

    // 预测文本宽度
    const tmpCvs = document.createElement('canvas');
    const tmpCtx = tmpCvs.getContext('2d')!;
    tmpCtx.font = `600 ${13 * S}px ${FF}`;
    const textW = tmpCtx.measureText(badgeText).width / S;

    const BW = 5 + 28 + 8 + textW + 14;
    const BR = BH / 2; // border-radius: 圆角 = 半高，呈现为胶囊形

    const badgeCvs = document.createElement('canvas');
    badgeCvs.width  = Math.ceil(BW * S);
    badgeCvs.height = BH * S;
    badgeCvs.style.cssText = `width:${BW}px;height:${BH}px;display:block;margin-bottom:14px;`;
    const bCtx = badgeCvs.getContext('2d')!;

    // 圆角矩形辅助函数
    const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y,     x + w, y + r,     r);
      ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
      ctx.lineTo(x + r, y + h); ctx.arcTo(x,     y + h, x,     y + h - r, r);
      ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
      ctx.closePath();
    };

    // 背景填充
    bCtx.fillStyle = '#edfaf3';
    roundRect(bCtx, 0, 0, BW * S, BH * S, BR * S);
    bCtx.fill();

    // 边框
    bCtx.strokeStyle = '#b7ecd4';
    bCtx.lineWidth = 1 * S;
    roundRect(bCtx, 0, 0, BW * S, BH * S, BR * S);
    bCtx.stroke();

    // 头像圆形（x=5, y=5, 28×28）
    const AX = 5 * S, AY = 5 * S, AW = 28 * S;
    bCtx.save();
    bCtx.beginPath();
    bCtx.arc(AX + AW / 2, AY + AW / 2, AW / 2, 0, Math.PI * 2);
    bCtx.clip();
    if (avatarImageEl) {
      bCtx.drawImage(avatarImageEl, AX, AY, AW, AW);
    } else {
      bCtx.fillStyle = '#07c160';
      bCtx.fillRect(AX, AY, AW, AW);
      bCtx.fillStyle = '#ffffff';
      bCtx.font = `700 ${13 * S}px ${FF}`;
      bCtx.textBaseline = 'middle';
      bCtx.textAlign = 'center';
      bCtx.fillText(initial, AX + AW / 2, AY + AW / 2);
    }
    bCtx.restore();

    // 文字（垂直居中）
    bCtx.textBaseline = 'middle';
    bCtx.textAlign = 'left';
    bCtx.fillStyle = '#07c160';
    bCtx.font = `600 ${13 * S}px ${FF}`;
    bCtx.fillText(badgeText, (5 + 28 + 8) * S, (BH / 2) * S);

    body.appendChild(badgeCvs);
  }

  // 提问框
  if (question) {
    const qBox = document.createElement('div');
    qBox.style.cssText = `
      background:#f7f8fa;border-radius:10px;
      padding:12px 14px 12px 17px;margin-bottom:14px;
      border-left:3px solid #07c160;
    `;
    const qLabel = document.createElement('div');
    qLabel.style.cssText = 'font-size:11px;font-weight:700;color:#aaa;margin-bottom:7px;';
    qLabel.textContent = '提问';
    const qText = document.createElement('div');
    qText.style.cssText = 'font-size:13px;color:#444;line-height:1.6;white-space:pre-wrap;';
    qText.textContent = question;
    qBox.appendChild(qLabel);
    qBox.appendChild(qText);
    body.appendChild(qBox);
  }

  // AI 回复（Markdown 渲染，消毒后设置）
  const styleEl = document.createElement('style');
  styleEl.textContent = MARKDOWN_CSS;
  const answerDiv = document.createElement('div');
  answerDiv.className = 'sa';
  answerDiv.style.cssText = 'font-size:14px;color:#1d1d1f;line-height:1.7;';
  // 基础消毒：移除 script 标签和事件处理器属性
  const sanitized = answerHtml
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
  answerDiv.innerHTML = sanitized;
  body.appendChild(styleEl);
  body.appendChild(answerDiv);

  // AI 元信息（两行：时间 / 模型+性能）
  if (stats && stats.elapsedSecs !== undefined) {
    const perfParts: string[] = [];
    if (stats.provider) perfParts.push(`${stats.provider}${stats.model ? ` · ${stats.model}` : ''}`);
    perfParts.push(`${stats.elapsedSecs.toFixed(1)}s`);
    if (stats.tokensPerSec) perfParts.push(`~${stats.tokensPerSec} tok/s`);
    if (stats.charCount) perfParts.push(`${stats.charCount} 字符`);

    let timeStr = '';
    if (stats.timestamp) {
      const d = new Date(stats.timestamp);
      timeStr = `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日${d.getHours()}点${String(d.getMinutes()).padStart(2,'0')}分`;
    }

    const metaDiv = document.createElement('div');
    metaDiv.style.cssText = 'text-align:right;font-size:10px;color:#bbb;margin-top:10px;padding-top:8px;border-top:1px solid #f0f0f0;font-family:' + FONT;
    if (timeStr) {
      const line1 = document.createElement('div');
      line1.style.marginBottom = '3px';
      line1.textContent = perfParts.join('  ·  ');
      const line2 = document.createElement('div');
      line2.textContent = timeStr;
      metaDiv.appendChild(line1);
      metaDiv.appendChild(line2);
    } else {
      metaDiv.textContent = perfParts.join('  ·  ');
    }
    body.appendChild(metaDiv);
  }

  // ── Footer（Canvas 2D 直接绘制）──
  const footerCvs = document.createElement('canvas');
  footerCvs.width = W * S;
  footerCvs.height = 68 * S;
  footerCvs.style.cssText = `width:${W}px;height:68px;display:block;`;
  const fCtx = footerCvs.getContext('2d')!;

  // 背景 + 顶部边框
  fCtx.fillStyle = '#f8f9fb';
  fCtx.fillRect(0, 0, W * S, 68 * S);
  fCtx.fillStyle = '#ececec';
  fCtx.fillRect(0, 0, W * S, 1 * S);

  fCtx.textBaseline = 'middle';

  // 左侧：GitHub 行（中心 y=25px）
  if (githubImg) {
    fCtx.drawImage(githubImg, 36*S, (25-6)*S, 12*S, 12*S);
  }
  fCtx.fillStyle = '#888888';
  fCtx.font = `${11*S}px ${FF}`;
  fCtx.fillText('https://github.com/runzhliu/welink', (githubImg ? 52 : 36)*S, 25*S);

  // 左侧：版权（中心 y=43px = 18+14+4+7）
  fCtx.fillStyle = '#bbbbbb';
  fCtx.font = `${10*S}px ${FF}`;
  fCtx.fillText(`© ${year} @runzhliu · AGPL-3.0`, 36*S, 43*S);

  // 右侧：QR 码（48×48, top=(68-48)/2=10px）
  const QR_SIZE = 48, QR_R = 36, QR_TOP = (68-QR_SIZE)/2;
  const QR_X = W - QR_R - QR_SIZE;
  if (qrImageEl) {
    fCtx.drawImage(qrImageEl, QR_X*S, QR_TOP*S, QR_SIZE*S, QR_SIZE*S);
  }

  // 右侧：扫码提示文字（右对齐，与 QR 左边留 10px 间距）
  fCtx.textAlign = 'right';
  const CX = (QR_X - 10) * S;
  fCtx.fillStyle = '#555555';
  fCtx.font = `700 ${11*S}px ${FF}`;
  fCtx.fillText('你也想分析微信聊天记录？', CX, 26*S);
  fCtx.fillStyle = '#07c160';
  fCtx.font = `${10*S}px ${FF}`;
  fCtx.fillText('扫码免费体验 →', CX, 43*S);
  fCtx.textAlign = 'left';

  const footer = document.createElement('div');
  footer.style.cssText = 'line-height:0;font-size:0;overflow:hidden;';
  footer.appendChild(footerCvs);

  card.appendChild(header);
  card.appendChild(body);
  card.appendChild(footer);
  wrap.appendChild(card);
  document.body.appendChild(wrap);

  try {
    const cvs = await html2canvas(card, {
      scale: 2,
      useCORS: true,       // 允许加载同源代理图片
      allowTaint: false,
      backgroundColor: '#ffffff',
      logging: false,
    });
    const dataUrl = cvs.toDataURL('image/png');
    const safeName = contactName
      ? contactName.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '_').slice(0, 20)
      : 'analysis';
    const filename = `welink-${safeName}-${Date.now()}.png`;
    const savedPath = await downloadPng(dataUrl, filename);
    return savedPath;
  } finally {
    document.body.removeChild(wrap);
  }
}

// ─── AI 分身聊天截图 ──────────────────────────────────────────────────────────

export interface CloneChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CloneChatImageOptions {
  contactName: string;
  avatarUrl?: string;
  messages: CloneChatMessage[];
  provider?: string;
  model?: string;
}

/** 生成仿微信聊天界面截图，header/footer 与 AI 分析分享图一致 */
export async function generateCloneChatImage(options: CloneChatImageOptions): Promise<string> {
  const FONT = "system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif";
  const S = 2;
  const W = 640;
  const FF = FONT;

  const [qrDataUrl, faviconImg, githubImg, avatarDataUrl] = await Promise.all([
    QRCode.toDataURL('https://welink.click', { width: 96, margin: 1, color: { dark: '#1d1d1f', light: '#f8f9fb' } }),
    fetch('/favicon.svg').then(r => r.text()).then(svg => loadSvgAsImage(svg, 42)).catch(() => null),
    loadSvgAsImage(GITHUB_SVG_SOURCE, 12),
    fetchAvatarDataUrl(options.avatarUrl),
  ]);
  const qrImageEl = await loadDataUrlAsImage(qrDataUrl);
  const avatarImageEl = avatarDataUrl ? await loadDataUrlAsImage(avatarDataUrl) : null;
  const year = new Date().getFullYear();

  const HEADER_H = 84;
  const FOOTER_H = 68;
  const PAD = 28;
  const CHAT_TOP_H = 52; // 聊天顶栏（联系人名 + 模型信息）
  const MSG_GAP = 16;
  const AVATAR_SIZE = 36;
  const BUBBLE_PAD = 12;
  const MAX_BUBBLE_W = W - PAD * 2 - AVATAR_SIZE - 20;

  // 预计算每条消息高度
  const tmpCvs = document.createElement('canvas');
  const tmpCtx = tmpCvs.getContext('2d')!;
  tmpCtx.font = `${14 * S}px ${FF}`;

  function measureText(text: string, maxW: number): { lines: string[]; height: number } {
    const words = text.split('');
    const lines: string[] = [];
    let cur = '';
    for (const ch of words) {
      if (ch === '\n') { lines.push(cur); cur = ''; continue; }
      const test = cur + ch;
      if (tmpCtx.measureText(test).width / S > maxW - BUBBLE_PAD * 2) {
        lines.push(cur); cur = ch;
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);
    if (lines.length === 0) lines.push('');
    const lineH = 20;
    return { lines, height: lines.length * lineH + BUBBLE_PAD * 2 };
  }

  const msgLayouts = options.messages.map(m => {
    const { lines, height } = measureText(m.content, MAX_BUBBLE_W);
    return { ...m, lines, height: Math.max(height, AVATAR_SIZE + 4) };
  });

  const chatH = CHAT_TOP_H + msgLayouts.reduce((s, m) => s + m.height + MSG_GAP, 0) + 20;
  const totalH = HEADER_H + chatH + FOOTER_H;

  const cvs = document.createElement('canvas');
  cvs.width = W * S;
  cvs.height = totalH * S;
  const ctx = cvs.getContext('2d')!;

  // 白色背景
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W * S, totalH * S);

  // ── Header（与 AI 分析一致）──
  const hGrad = ctx.createLinearGradient(0, 0, W * S, 0);
  hGrad.addColorStop(0, '#09d46a'); hGrad.addColorStop(1, '#06a850');
  ctx.fillStyle = hGrad;
  ctx.fillRect(0, 0, W * S, HEADER_H * S);

  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath(); ctx.arc((W - 15 + 55) * S, (6 + 55) * S, 55 * S, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.beginPath(); ctx.arc((W + 25 + 35) * S, (42 + 35) * S, 35 * S, 0, Math.PI * 2); ctx.fill();

  if (faviconImg) {
    ctx.save(); ctx.beginPath();
    const [lx, ly, lw, lh, lr] = [36*S, 21*S, 42*S, 42*S, 10*S];
    ctx.moveTo(lx+lr, ly); ctx.lineTo(lx+lw-lr, ly); ctx.arcTo(lx+lw, ly, lx+lw, ly+lr, lr);
    ctx.lineTo(lx+lw, ly+lh-lr); ctx.arcTo(lx+lw, ly+lh, lx+lw-lr, ly+lh, lr);
    ctx.lineTo(lx+lr, ly+lh); ctx.arcTo(lx, ly+lh, lx, ly+lh-lr, lr);
    ctx.lineTo(lx, ly+lr); ctx.arcTo(lx, ly, lx+lr, ly, lr);
    ctx.closePath(); ctx.clip();
    ctx.drawImage(faviconImg, lx, ly, lw, lh); ctx.restore();
  }

  const TX = (faviconImg ? 90 : 36) * S;
  ctx.textBaseline = 'middle'; ctx.fillStyle = '#ffffff';
  ctx.font = `900 ${20*S}px ${FF}`; ctx.fillText('WeLink', TX, 32 * S);
  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.font = `${12*S}px ${FF}`; ctx.fillText('微信聊天记录 AI 助手', TX, 55 * S);

  // ── 聊天顶栏 ──
  let y = HEADER_H;
  ctx.fillStyle = '#f8f9fb';
  ctx.fillRect(0, y * S, W * S, CHAT_TOP_H * S);
  ctx.fillStyle = '#e5e7eb';
  ctx.fillRect(0, (y + CHAT_TOP_H - 1) * S, W * S, 1 * S);

  ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  ctx.fillStyle = '#1d1d1f'; ctx.font = `700 ${15*S}px ${FF}`;
  ctx.fillText(`${options.contactName} 的 AI 分身`, (W / 2) * S, (y + CHAT_TOP_H / 2 - 6) * S);
  if (options.provider) {
    ctx.fillStyle = '#999999'; ctx.font = `${10*S}px ${FF}`;
    ctx.fillText(`${options.provider}${options.model ? ' · ' + options.model : ''}`, (W / 2) * S, (y + CHAT_TOP_H / 2 + 12) * S);
  }
  ctx.textAlign = 'left';

  // ── 聊天气泡 ──
  y += CHAT_TOP_H + 12;

  const roundRect = (cx: CanvasRenderingContext2D, x: number, yy: number, w: number, h: number, r: number) => {
    cx.beginPath();
    cx.moveTo(x+r, yy); cx.lineTo(x+w-r, yy); cx.arcTo(x+w, yy, x+w, yy+r, r);
    cx.lineTo(x+w, yy+h-r); cx.arcTo(x+w, yy+h, x+w-r, yy+h, r);
    cx.lineTo(x+r, yy+h); cx.arcTo(x, yy+h, x, yy+h-r, r);
    cx.lineTo(x, yy+r); cx.arcTo(x, yy, x+r, yy, r);
    cx.closePath();
  };

  for (const msg of msgLayouts) {
    const isUser = msg.role === 'user';
    const bubbleW = Math.min(MAX_BUBBLE_W, Math.max(...msg.lines.map(l => tmpCtx.measureText(l).width / S)) + BUBBLE_PAD * 2 + 4);

    if (isUser) {
      // 右侧：绿色气泡
      const bx = W - PAD - bubbleW;
      ctx.fillStyle = '#07c160';
      roundRect(ctx, bx * S, y * S, bubbleW * S, msg.height * S, 12 * S);
      ctx.fill();

      ctx.fillStyle = '#ffffff'; ctx.font = `${14*S}px ${FF}`; ctx.textBaseline = 'top';
      msg.lines.forEach((line, i) => {
        ctx.fillText(line, (bx + BUBBLE_PAD) * S, (y + BUBBLE_PAD + i * 20) * S);
      });
    } else {
      // 左侧：头像 + 灰色气泡
      const avX = PAD;
      const avY = y;

      // 头像
      ctx.save(); ctx.beginPath();
      ctx.arc((avX + AVATAR_SIZE / 2) * S, (avY + AVATAR_SIZE / 2) * S, (AVATAR_SIZE / 2) * S, 0, Math.PI * 2);
      ctx.clip();
      if (avatarImageEl) {
        ctx.drawImage(avatarImageEl, avX * S, avY * S, AVATAR_SIZE * S, AVATAR_SIZE * S);
      } else {
        ctx.fillStyle = '#07c160'; ctx.fillRect(avX * S, avY * S, AVATAR_SIZE * S, AVATAR_SIZE * S);
        ctx.fillStyle = '#fff'; ctx.font = `700 ${16*S}px ${FF}`;
        ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
        ctx.fillText(options.contactName.charAt(0), (avX + AVATAR_SIZE / 2) * S, (avY + AVATAR_SIZE / 2) * S);
        ctx.textAlign = 'left';
      }
      ctx.restore();

      const bx = PAD + AVATAR_SIZE + 8;
      ctx.fillStyle = '#f0f0f0';
      roundRect(ctx, bx * S, y * S, bubbleW * S, msg.height * S, 12 * S);
      ctx.fill();

      ctx.fillStyle = '#1d1d1f'; ctx.font = `${14*S}px ${FF}`; ctx.textBaseline = 'top';
      msg.lines.forEach((line, i) => {
        ctx.fillText(line, (bx + BUBBLE_PAD) * S, (y + BUBBLE_PAD + i * 20) * S);
      });
    }
    y += msg.height + MSG_GAP;
  }

  // ── Footer（与 AI 分析一致）──
  const fY = (totalH - FOOTER_H) * S;
  ctx.fillStyle = '#f8f9fb'; ctx.fillRect(0, fY, W * S, FOOTER_H * S);
  ctx.fillStyle = '#ececec'; ctx.fillRect(0, fY, W * S, 1 * S);

  ctx.textBaseline = 'middle';
  if (githubImg) ctx.drawImage(githubImg, 36*S, fY + (25-6)*S, 12*S, 12*S);
  ctx.fillStyle = '#888888'; ctx.font = `${11*S}px ${FF}`;
  ctx.fillText('https://github.com/runzhliu/welink', (githubImg ? 52 : 36)*S, fY + 25*S);
  ctx.fillStyle = '#bbbbbb'; ctx.font = `${10*S}px ${FF}`;
  ctx.fillText(`© ${year} @runzhliu · AGPL-3.0`, 36*S, fY + 43*S);

  const QR_SIZE = 48, QR_R = 36, QR_TOP = (FOOTER_H-QR_SIZE)/2, QR_X = W - QR_R - QR_SIZE;
  if (qrImageEl) ctx.drawImage(qrImageEl, QR_X*S, fY + QR_TOP*S, QR_SIZE*S, QR_SIZE*S);
  ctx.textAlign = 'right';
  const CX = (QR_X - 10) * S;
  ctx.fillStyle = '#555555'; ctx.font = `700 ${11*S}px ${FF}`;
  ctx.fillText('你也想分析微信聊天记录？', CX, fY + 26*S);
  ctx.fillStyle = '#07c160'; ctx.font = `${10*S}px ${FF}`;
  ctx.fillText('扫码免费体验 →', CX, fY + 43*S);
  ctx.textAlign = 'left';

  // ── Export ──
  const dataUrl = cvs.toDataURL('image/png');
  const safeName = options.contactName.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '_').slice(0, 20);
  const filename = `welink-clone-${safeName}-${Date.now()}.png`;
  return downloadPng(dataUrl, filename);
}
