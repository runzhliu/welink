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

// ─── GitHub SVG（内联，避免跨域）──────────────────────────────────────────────

const GITHUB_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" style="width:12px;height:12px;vertical-align:middle;margin-right:5px;flex-shrink:0;"><path fill="#888" d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/></svg>`;

// ─── 主函数 ───────────────────────────────────────────────────────────────────

/** 生成并下载分享图片；返回保存路径（App 模式）或文件名（浏览器模式） */
export async function generateShareImage(options: ShareImageOptions): Promise<string> {
  const { question, answer, contactName, avatarUrl } = options;

  const FONT = "system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif";

  // 并行：生成二维码 + 渲染 Markdown
  marked.use({ breaks: true });
  const [qrDataUrl, answerHtml] = await Promise.all([
    QRCode.toDataURL('https://welink.click', {
      width: 128, margin: 1, color: { dark: '#1d1d1f', light: '#f8f9fb' },
    }),
    Promise.resolve(marked.parse(answer) as string),
  ]);

  const avatarSrc = avatarUrl ? `/api/avatar?url=${encodeURIComponent(avatarUrl)}` : null;
  const year = new Date().getFullYear();

  // ── 构建卡片 DOM ────────────────────────────────────────────────────────────
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;top:-9999px;left:-9999px;z-index:-1;';

  const card = document.createElement('div');
  card.style.cssText = `width:640px;background:#fff;font-family:${FONT};`;

  // ── Header ──
  const header = document.createElement('div');
  header.style.cssText = `
    background:linear-gradient(to right,#09d46a,#06a850);
    height:84px;padding:0 36px;
    display:flex;align-items:center;position:relative;overflow:hidden;
  `;
  header.innerHTML = `
    <div style="position:absolute;right:-15px;top:6px;width:110px;height:110px;background:rgba(255,255,255,0.08);border-radius:50%;pointer-events:none;"></div>
    <div style="position:absolute;right:25px;top:42px;width:70px;height:70px;background:rgba(255,255,255,0.06);border-radius:50%;pointer-events:none;"></div>
    <img src="/favicon.svg" style="width:42px;height:42px;border-radius:10px;flex-shrink:0;" crossorigin="anonymous" />
    <div style="margin-left:12px;">
      <div style="color:#fff;font-size:20px;font-weight:900;line-height:1.2;">WeLink</div>
      <div style="color:rgba(255,255,255,0.78);font-size:12px;margin-top:3px;">微信聊天记录 AI 助手</div>
    </div>
  `;

  // ── Body ──
  const body = document.createElement('div');
  body.style.cssText = 'padding:28px 36px;background:#fff;';

  // 联系人徽章
  if (contactName) {
    const badge = document.createElement('div');
    badge.style.cssText = `
      display:inline-flex;align-items:center;gap:8px;
      padding:${avatarSrc ? '5px 14px 5px 5px' : '5px 14px'};
      background:#edfaf3;border:1px solid rgba(7,193,96,0.3);
      border-radius:20px;margin-bottom:14px;
    `;
    badge.innerHTML = `
      ${avatarSrc ? `<img src="${avatarSrc}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.style.display='none'" crossorigin="anonymous" />` : ''}
      <span style="color:#07c160;font-size:13px;font-weight:600;">与「${contactName}」的对话分析</span>
    `;
    body.appendChild(badge);
  }

  // 提问框
  if (question) {
    const qBox = document.createElement('div');
    qBox.style.cssText = `
      background:#f7f8fa;border-radius:10px;
      padding:12px 14px 12px 17px;margin-bottom:14px;
      border-left:3px solid #07c160;
    `;
    const escaped = question.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    qBox.innerHTML = `
      <div style="font-size:11px;font-weight:700;color:#aaa;margin-bottom:7px;">提问</div>
      <div style="font-size:13px;color:#444;line-height:1.6;white-space:pre-wrap;">${escaped}</div>
    `;
    body.appendChild(qBox);
  }

  // AI 回复（Markdown 渲染）
  const styleEl = document.createElement('style');
  styleEl.textContent = MARKDOWN_CSS;
  const answerDiv = document.createElement('div');
  answerDiv.className = 'sa';
  answerDiv.style.cssText = 'font-size:14px;color:#1d1d1f;line-height:1.7;';
  answerDiv.innerHTML = answerHtml;
  body.appendChild(styleEl);
  body.appendChild(answerDiv);

  // ── Footer ──
  const footer = document.createElement('div');
  footer.style.cssText = `
    background:#f8f9fb;border-top:1px solid #ececec;
    height:68px;padding:0 36px;
    display:flex;align-items:center;justify-content:space-between;
  `;
  footer.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:5px;">
      <div style="display:flex;align-items:center;font-size:11px;color:#888;">
        ${GITHUB_SVG}https://github.com/runzhliu/welink
      </div>
      <div style="font-size:10px;color:#bbb;">© ${year} @runzhliu · AGPL-3.0</div>
    </div>
    <div style="display:flex;align-items:center;gap:10px;">
      <div style="text-align:right;">
        <div style="font-size:11px;font-weight:700;color:#555;">你也想分析聊天记录？</div>
        <div style="font-size:10px;color:#07c160;margin-top:3px;">扫码免费体验 →</div>
      </div>
      <img src="${qrDataUrl}" style="width:48px;height:48px;flex-shrink:0;" />
    </div>
  `;

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
