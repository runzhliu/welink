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
 *      - **onclone 二次套字体** 到每一个非 mono 元素
 *      - **去掉 cloneNode 里的 truncate 类** 避免 ellipsis 切字
 *      - 等 fonts.ready + img.decode + 2× rAF 再 capture
 *      - 自动 download blob，带 .png 后缀
 */

import html2canvas from 'html2canvas';

/** 跨平台 CJK 字体链。Web Fonts 不靠谱（看 OS 装了啥），把已知能渲染中文的系统字体堆前面。 */
const CJK_FONT_STACK =
  "'PingFang SC', 'Hiragino Sans GB', 'Heiti SC', 'Microsoft YaHei', " +
  "'WenQuanYi Micro Hei', 'Noto Sans CJK SC', system-ui, -apple-system, sans-serif";

export async function prepareForCapture(node: HTMLElement): Promise<void> {
  if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch { /* 字体加载失败不阻塞导出 */ }
  }

  const imgs = Array.from(node.querySelectorAll('img'));
  await Promise.all(imgs.map(img => {
    if (img.complete && img.naturalWidth > 0) {
      return img.decode().catch(() => undefined);
    }
    return new Promise<void>(resolve => {
      const done = () => resolve();
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    });
  }));

  await new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/** captureCardToPng 选项 */
export interface CaptureOpts {
  /** 下载文件名（不含 .png）；保存时会自动补 .png 后缀 */
  filename: string;
  /** 卡片背景色，默认 #ffffff */
  backgroundColor?: string;
  /** wrapper 总宽度，默认 720 */
  width?: number;
  /** 截图前往 wrapper 末尾插入的额外 HTML 字符串（如 brand footer） */
  appendHTML?: string;
  /** 截图前往 wrapper 起始插入的额外 HTML 字符串（如 brand header） */
  prependHTML?: string;
  /** 让调用方做额外处理（如改 chatNode 样式），在 capture 之前调用 */
  beforeCapture?: (wrapper: HTMLElement) => void | Promise<void>;
}

/**
 * 把指定卡片 DOM 转成 PNG 并触发下载。
 * 返回成功（blob 大小 > 0）与否，调用方可据此显示 toast。
 */
export async function captureCardToPng(card: HTMLElement, opts: CaptureOpts): Promise<{ ok: boolean; size: number; error?: string }> {
  const node = card.cloneNode(true) as HTMLElement;

  // 去 truncate / ellipsis：截图后没有滚动条，标题被 ellipsis 切掉就再也看不到
  node.querySelectorAll<HTMLElement>('.truncate').forEach(el => {
    el.classList.remove('truncate');
    el.style.whiteSpace = 'normal';
    el.style.textOverflow = 'clip';
    el.style.overflow = 'visible';
  });
  // 兜底：内联了 text-overflow / white-space 的也修一遍
  node.querySelectorAll<HTMLElement>('[style*="text-overflow"], [style*="white-space"]').forEach(el => {
    if (el.style.textOverflow === 'ellipsis') el.style.textOverflow = 'clip';
    if (el.style.whiteSpace === 'nowrap') el.style.whiteSpace = 'normal';
  });

  const width = opts.width ?? 720;
  const bg = opts.backgroundColor ?? '#ffffff';

  const wrapper = document.createElement('div');
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
    if (opts.beforeCapture) {
      await opts.beforeCapture(wrapper);
    }
    await prepareForCapture(wrapper);

    const canvas = await html2canvas(wrapper, {
      backgroundColor: bg,
      scale: 2,
      useCORS: true,
      logging: false,
      // onclone 在 html2canvas 内部 clone 一份 DOM 时调用，这里把字体强行套到每个
      // 非 mono 元素上 —— canvas 渲染时用 computed style，覆盖一次才稳。
      onclone: (clonedDoc) => {
        const all = clonedDoc.querySelectorAll<HTMLElement>('*');
        all.forEach(el => {
          let cur = '';
          try {
            cur = clonedDoc.defaultView?.getComputedStyle(el).fontFamily ?? '';
          } catch { /* ignore */ }
          // 保留 monospace（数字 / 代码块）；其余强制 CJK 链
          if (!/mono|courier|consolas|menlo/i.test(cur)) {
            el.style.fontFamily = CJK_FONT_STACK;
          }
          // 防 ellipsis 切字
          if (el.style.textOverflow === 'ellipsis') el.style.textOverflow = 'clip';
          if (el.classList.contains('truncate')) {
            el.classList.remove('truncate');
            el.style.whiteSpace = 'normal';
            el.style.overflow = 'visible';
          }
        });
      },
    });

    const blob = await new Promise<Blob | null>(res => canvas.toBlob(b => res(b), 'image/png'));
    if (!blob) return { ok: false, size: 0, error: 'canvas.toBlob 返回 null' };

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
