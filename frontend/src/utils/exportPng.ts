/**
 * exportPng.ts —— html2canvas 截图前的就绪等待
 *
 * 创意实验室（ChatDNA / Highlights / ParallelChat / RelationGraph / SoulQuiz /
 * VirtualGroupChat）都把目标卡片 cloneNode 后塞到一个离屏 wrapper 里再截图。
 * 直接调 html2canvas 容易拿到空白图，因为 wrapper 刚 appendChild，浏览器还没
 * 完成 layout/paint，并且 wrapper 内的 <img> 还没解码。
 *
 * 这里把"截图前要等的事"集中处理：字体就绪 + 图片解码 + 两次 rAF 确保布局。
 */
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
