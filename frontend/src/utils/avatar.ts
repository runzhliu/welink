/**
 * Returns a safe avatar src:
 * - data: URIs (demo SVGs) → used directly
 * - External http/https URLs (WeChat CDN) → routed through the backend proxy,
 *   which caches on disk so the app works offline after first load
 * - Everything else (empty, relative paths) → returned as-is
 */
export function avatarSrc(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('data:')) return url;
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return `/api/avatar?url=${encodeURIComponent(url)}`;
  }
  return url;
}
