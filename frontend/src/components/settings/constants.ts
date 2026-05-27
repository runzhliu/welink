// 设置页常量 + 跨页面共享的 localStorage key

export const MEMBER_RANK_LIMIT_KEY = 'welink_member_rank_limit';
export const MEMBER_NAME_WIDTH_KEY = 'welink_member_name_width';
export const DEFAULT_RANK_LIMIT = 10;
export const DEFAULT_NAME_WIDTH = 144; // px, roughly w-36

// Makefile 编译时会剥掉 tag 的 v 前缀（patsubst v%,%），展示时补回来
export function formatVersion(v?: string): string {
  if (!v) return 'dev';
  if (v === 'dev' || v.startsWith('dev-') || v.startsWith('v')) return v;
  return 'v' + v;
}

// 打开外链：WebView 走后端 open-url 让系统浏览器接管；普通浏览器直接 window.open
export function openProviderUrl(url: string): void {
  if (!url) return;
  const ua = navigator.userAgent;
  const isWebView = ua.includes('AppleWebKit') && !ua.includes('Safari') && !ua.includes('Chrome') && !ua.includes('Firefox');
  if (isWebView) {
    fetch(`/api/open-url?url=${encodeURIComponent(url)}`).catch(() => {});
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
