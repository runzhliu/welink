/**
 * 运行时配置：集中管理 API 地址和配对 token
 *
 * 场景：
 *   - Web / PC 端：baseURL='' 走同源，token 可空（后端未启用配对时直接放行）
 *   - 移动端 / 远程访问：baseURL=http://pc-lan-ip:3418，每次请求带 token
 *
 * 配置来源优先级：
 *   1. URL 查询参数 ?server=...&token=... （首次扫码时写入）
 *   2. localStorage（之前保存的）
 *   3. 空（用同源）
 *
 * 注：不用 Capacitor Preferences，为了 Phase 1 纯 Web 也能用；
 * Phase 2 切 Capacitor 时可以再做 native 存储迁移。
 */

const LS_SERVER = 'welink:runtime:server';
const LS_TOKEN = 'welink:runtime:token';

interface RuntimeConfig {
  serverURL: string; // 空 = 同源；否则形如 http://192.168.1.5:3418
  token: string;
}

let current: RuntimeConfig = {
  serverURL: localStorage.getItem(LS_SERVER) || '',
  token: localStorage.getItem(LS_TOKEN) || '',
};

// 判断 server URL 是否指向私网 / 回环 / mDNS —— 对抗 QR phishing：
// 只接受 RFC1918 + loopback + *.local，避免扫到恶意二维码把所有聊天数据
// 发给攻击者的公网 host。
function isPrivateServerURL(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local')) return true;
    // IPv4 字面量
    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
      const [, a, b] = ipv4.map(Number);
      if (a === 127) return true;                            // loopback
      if (a === 10) return true;                              // 10/8
      if (a === 192 && b === 168) return true;                // 192.168/16
      if (a === 172 && b >= 16 && b <= 31) return true;       // 172.16/12
      return false;
    }
    // IPv6 回环
    if (host === '::1' || host === '[::1]') return true;
    return false;
  } catch {
    return false;
  }
}

// 页面首开时：若 URL 带 ?server=&token=，吸收到 localStorage 并剥掉 query
// 以免 token 长期留在浏览器地址栏 / 历史里。
(function absorbQueryParams() {
  try {
    const url = new URL(window.location.href);
    const server = url.searchParams.get('server');
    const token = url.searchParams.get('token');
    let changed = false;
    if (server !== null) {
      // 防 QR phishing：只接受私网 / 回环 / mDNS 地址
      if (isPrivateServerURL(server)) {
        current.serverURL = server;
        localStorage.setItem(LS_SERVER, server);
      } else {
        console.warn('[welink] 拒绝非私网的 ?server= 参数，防止 QR phishing：', server);
      }
      url.searchParams.delete('server');
      changed = true;
    }
    if (token !== null) {
      current.token = token;
      localStorage.setItem(LS_TOKEN, token);
      url.searchParams.delete('token');
      changed = true;
    }
    if (changed) {
      // 保留原 hash path（#/...），只重写 query，避免刷新掉当前状态
      const clean = url.pathname + (url.search ? url.search : '') + url.hash;
      window.history.replaceState(null, '', clean);
    }
  } catch { /* ignore */ }
})();

export function getServerURL(): string {
  return current.serverURL;
}

export function getToken(): string {
  return current.token;
}

/** 给裸的 /api/xxx 路径拼上 serverURL 前缀（serverURL 为空时原样返回）。 */
export function apiUrl(path: string): string {
  if (!current.serverURL) return path;
  const trimmed = current.serverURL.replace(/\/+$/, '');
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return trimmed + (path.startsWith('/') ? path : '/' + path);
}

/**
 * 统一接管散落在组件里的 fetch('/api/...')：
 *
 * - 远程客户端自动改写到 PC 的 serverURL；
 * - 自动附加配对 Bearer token；
 * - 保留 Request 与 init 两边已有的 headers。
 *
 * axios 有自己的拦截器，但流式 SSE、Blob 下载等场景必须使用 fetch。把适配放在
 * 这一层可以避免新增功能忘记处理移动端配对，且只影响当前页面同源的 /api 路径。
 */
function installAPIFetchAdapter() {
  const w = window as Window & { __welinkAPIFetchInstalled?: boolean };
  if (w.__welinkAPIFetchInstalled) return;
  w.__welinkAPIFetchInstalled = true;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    let path = '';
    try {
      const resolved = new URL(raw, window.location.href);
      if (resolved.origin === window.location.origin && resolved.pathname.startsWith('/api/')) {
        path = resolved.pathname + resolved.search + resolved.hash;
      }
    } catch {
      // 非法 URL 交还原生 fetch，由它产生标准错误。
    }
    if (!path) return nativeFetch(input, init);

    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    const token = getToken();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const target = apiUrl(path);
    if (input instanceof Request) {
      return nativeFetch(new Request(target, input), { ...init, headers });
    }
    return nativeFetch(target, { ...init, headers });
  };
}

installAPIFetchAdapter();

export function setRuntimeConfig(cfg: Partial<RuntimeConfig>) {
  if (typeof cfg.serverURL === 'string') {
    current.serverURL = cfg.serverURL;
    if (cfg.serverURL) localStorage.setItem(LS_SERVER, cfg.serverURL);
    else localStorage.removeItem(LS_SERVER);
  }
  if (typeof cfg.token === 'string') {
    current.token = cfg.token;
    if (cfg.token) localStorage.setItem(LS_TOKEN, cfg.token);
    else localStorage.removeItem(LS_TOKEN);
  }
}

export function clearRuntimeConfig() {
  setRuntimeConfig({ serverURL: '', token: '' });
}

/** 启发式判断当前运行在手机/远程客户端场景 —— 只要 serverURL 非空就是。 */
export function isRemoteClient(): boolean {
  return !!current.serverURL;
}

/**
 * 给顶级 axios（非 services/api.ts 的实例）也挂拦截器，
 * 让各组件里散落的 axios.get/post(...) 自动带上 server + token。
 * main.tsx 中 import 一次即可。
 */
import axios from 'axios';

axios.interceptors.request.use((cfg) => {
  const server = getServerURL();
  const tok = getToken();
  if (server && typeof cfg.url === 'string' && cfg.url.startsWith('/api/')) {
    cfg.url = server.replace(/\/+$/, '') + cfg.url;
  }
  if (tok && typeof cfg.url === 'string' && (cfg.url.includes('/api/') || cfg.baseURL?.includes('/api'))) {
    cfg.headers = cfg.headers ?? {};
    (cfg.headers as Record<string, string>).Authorization = `Bearer ${tok}`;
  }
  return cfg;
});
