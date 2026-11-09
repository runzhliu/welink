/**
 * exportPng.ts —— html2canvas 截图的统一入口
 *
 * 历史教训：每个 lab 各自拼 wrapper + cloneNode + html2canvas 的代码，
 * 导致 CJK 字体回退、宽度不一致、download 链路重复等一堆毛病。
 *
 * 这个文件提供两个工具：
 *   1. prepareForCapture(node) —— 旧 API，等字体/图片/布局就绪
 *      已有调用方继续用；新代码请优先用 captureCardToPng
 *   2. captureCardToPng(card, opts) —— 一站式 capture + download
 *      - clone 卡片到离屏 wrapper
 *      - **强制 CJK 字体放在 font-family 链最前面**
 *        canvas 渲染 system-ui 时 fallback 链跟 DOM 不同，
 *        系统字体里的"考"会被画成"老"、"郭"画成"邦"等 —— 必须
 *        显式指定 PingFang SC / Hiragino Sans GB / Microsoft YaHei
 *      - 在测量前统一非等宽字体，避免截图时换字体导致重新排版
 *      - **去掉 cloneNode 里的 truncate 类** 避免 ellipsis 切字
 *      - 等 fonts.ready + img.decode + 2× rAF 再 capture
 *      - 自动 download blob，带 .png 后缀
 */

import html2canvas from 'html2canvas';

/** 跨平台 CJK 字体链。Web Fonts 不靠谱（看 OS 装了啥），把已知能渲染中文的系统字体堆前面。 */
const CJK_FONT_STACK =
  "'PingFang SC', 'Hiragino Sans GB', 'Heiti SC', 'Microsoft YaHei', " +
  "'WenQuanYi Micro Hei', 'Noto Sans CJK SC', system-ui, -apple-system, sans-serif";

/** 所有 DOM 截图共用同一渲染入口；调用方可提供自己的尺寸和克隆处理。 */
export async function renderCaptureCanvas(node: HTMLElement, options: Parameters<typeof html2canvas>[1] = {}): Promise<HTMLCanvasElement> {
  await prepareForCapture(node);
  return html2canvas(node, { useCORS: true, logging: false, ...options });
}

export async function prepareForCapture(node: HTMLElement): Promise<void> {
  if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
    try { await withCaptureTimeout(document.fonts.ready); } catch { /* 字体加载失败不阻塞导出 */ }
  }

  const imgs = Array.from(node.querySelectorAll('img'));
  await Promise.all(imgs.map(img => {
    if (img.complete) return img.naturalWidth > 0 ? withCaptureTimeout(img.decode().catch(() => undefined)) : Promise.resolve();
    return new Promise<void>(resolve => {
      const done = () => {
        clearTimeout(timeout);
        img.removeEventListener('load', done);
        img.removeEventListener('error', done);
        resolve();
      };
      const timeout = setTimeout(done, 8000);
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    });
  }));

  await new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

async function withCaptureTimeout<T>(promise: Promise<T>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([promise, new Promise<void>(resolve => { timer = setTimeout(resolve, 8000); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** captureCardToPng 选项 */
export interface CaptureOpts {
  /** 下载文件名（不含 .png）；保存时会自动补 .png 后缀 */
  filename: string;
  /** 卡片背景色，默认 #ffffff */
  backgroundColor?: string;
  /** wrapper 总宽度，默认 720 */
  width?: number;
  /** 截图逻辑高度和像素倍率；默认按内容高度、2 倍像素。 */
  height?: number;
  scale?: number;
  /** 截图前往 wrapper 末尾插入的额外 HTML 字符串（如 brand footer） */
  appendHTML?: string;
  /** 截图前往 wrapper 起始插入的额外 HTML 字符串（如 brand header） */
  prependHTML?: string;
  /** 让调用方做额外处理（如改 chatNode 样式），在 capture 之前调用 */
  beforeCapture?: (wrapper: HTMLElement) => void | Promise<void>;
  /** html2canvas 的文档副本中恢复滚动等状态。 */
  onClone?: (wrapper: HTMLElement) => void;
  /** 只影响截图文档，不切换页面当前主题。 */
  theme?: 'light' | 'current';
}

/**
 * 把指定卡片 DOM 转成 PNG 并触发下载。
 * 返回成功（blob 大小 > 0）与否，调用方可据此显示 toast。
 */
export async function captureCardToPng(card: HTMLElement, opts: CaptureOpts): Promise<{ ok: boolean; size: number; error?: string }> {
  const node = card.cloneNode(true) as HTMLElement;

  node.querySelectorAll('[data-capture-ignore]').forEach(el => el.remove());

  // 去 truncate / ellipsis：截图后没有滚动条，标题被 ellipsis 切掉就再也看不到
  node.querySelectorAll<HTMLElement>('.truncate').forEach(el => {
    el.classList.remove('truncate');
    el.style.whiteSpace = 'normal';
    el.style.textOverflow = 'clip';
    el.style.overflow = 'visible';
    el.style.overflowWrap = 'anywhere';
  });
  // 兜底：内联了 text-overflow / white-space 的也修一遍
  node.querySelectorAll<HTMLElement>('[style*="text-overflow"], [style*="white-space"]').forEach(el => {
    if (el.style.textOverflow === 'ellipsis') el.style.textOverflow = 'clip';
    if (el.style.whiteSpace === 'nowrap') el.style.whiteSpace = 'normal';
  });

  const width = opts.width ?? 720;
  const bg = opts.backgroundColor ?? '#ffffff';

  const wrapper = document.createElement('div');
  const captureId = `capture-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  wrapper.dataset.captureId = captureId;
  wrapper.style.cssText = `
    width: ${width}px;
    background: ${bg};
    padding: 0;
    font-family: ${CJK_FONT_STACK};
    letter-spacing: 0;
    position: fixed;
    left: -10000px;
    top: 0;
    z-index: -1;
  `;
  if (opts.prependHTML) {
    wrapper.insertAdjacentHTML('beforeend', opts.prependHTML);
  }
  wrapper.appendChild(node);
  if (opts.appendHTML) {
    wrapper.insertAdjacentHTML('beforeend', opts.appendHTML);
  }
  document.body.appendChild(wrapper);

  try {
    // cloneNode 不复制 canvas 像素，图表及手绘内容需要显式复制。
    const sourceCanvases = Array.from(card.querySelectorAll('canvas'))
      .filter(canvas => !canvas.closest('[data-capture-ignore]'));
    node.querySelectorAll('canvas').forEach((canvas, index) => {
      const source = sourceCanvases[index];
      if (source) canvas.getContext('2d')?.drawImage(source, 0, 0);
    });
    // html2canvas 在部分系统上会把紧凑标签中的中文画得偏低；只移动文字，保留背景和布局。
    node.querySelectorAll<HTMLElement>('[data-capture-lift-text]').forEach(el => {
      el.style.position = 'relative';
      const requested = Number(el.dataset.captureLiftText) || 3;
      el.style.top = `-${Math.min(8, Math.max(0, requested))}px`;
    });
    if (opts.beforeCapture) {
      await opts.beforeCapture(wrapper);
    }
    // 字体变更必须发生在测量之前，避免克隆文档中的换行与截图尺寸不一致。
    [wrapper, ...Array.from(wrapper.querySelectorAll<HTMLElement>('*'))].forEach(el => {
      const current = getComputedStyle(el).fontFamily;
      if (!/mono|courier|consolas|menlo/i.test(current)) el.style.fontFamily = CJK_FONT_STACK;
    });
    await prepareForCapture(wrapper);

    const scale = opts.scale ?? 2;
    const height = opts.height ?? wrapper.scrollHeight;
    if (height * scale > 16384 || width * height * scale * scale > 100_000_000) {
      throw new Error('内容过长，无法安全生成单张图片；请缩短内容或分段导出');
    }

    const canvas = await renderCaptureCanvas(wrapper, {
      backgroundColor: bg,
      scale,
      ...(opts.height ? { height: opts.height } : {}),
      useCORS: true,
      logging: false,
      onclone: (clonedDoc) => {
        if (opts.theme === 'light') clonedDoc.documentElement.classList.remove('dark');
        const clonedWrapper = clonedDoc.querySelector<HTMLElement>(`[data-capture-id="${captureId}"]`);
        if (clonedWrapper) opts.onClone?.(clonedWrapper);
      },
    });

    const blob = await new Promise<Blob | null>(res => canvas.toBlob(b => res(b), 'image/png'));
    if (!blob || blob.size === 0) return { ok: false, size: 0, error: '生成的图片为空，请重试' };

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = opts.filename.endsWith('.png') ? opts.filename : `${opts.filename}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    return { ok: true, size: blob.size };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, size: 0, error: msg };
  } finally {
    if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
  }
}
