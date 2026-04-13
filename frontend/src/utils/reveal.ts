/**
 * 在系统文件管理器中定位文件（Mac 的 Finder / Windows 的资源管理器）。
 * 仅 App 模式下可用；浏览器模式下静默失败（按钮依然不应显示）。
 */
import { appApi } from '../services/appApi';

export function canReveal(): boolean {
  const ua = navigator.userAgent;
  return ua.includes('AppleWebKit') && !ua.includes('Safari') && !ua.includes('Chrome') && !ua.includes('Firefox');
}

export async function revealPath(path: string): Promise<void> {
  try {
    await appApi.reveal(path);
  } catch {
    /* 忽略 */
  }
}
