import axios from 'axios';

const api = axios.create({ baseURL: '/api', timeout: 120000 });

export interface AppInfo {
  app_mode: boolean;
  needs_setup: boolean;
  ready: boolean;
  version?: string;
  platform?: string;       // "darwin" | "windows" | "linux" | ...
  data_dir?: string;       // 当前配置的数据目录
  reason?: string;         // 最近一次初始化失败的原因
  probed_paths?: string[]; // 后端探测过的候选 decrypted 路径
  can_demo?: boolean;      // 是否支持一键切到 Demo（目前仅桌面版）
}

export interface AppConfig {
  data_dir: string;
  log_dir: string;
  demo_mode?: boolean;
}

export const appApi = {
  getInfo: () => api.get<AppInfo>('/app/info').then((r) => r.data),

  getConfig: () => api.get<AppConfig>('/app/config').then((r) => r.data),

  browse: (prompt: string) =>
    api.get<{ path: string }>('/app/browse', { params: { prompt } }).then((r) => r.data.path),

  setup: (dataDir: string, logDir: string) =>
    api.post<{ status: string; error?: string; warnings?: string[] }>('/app/setup', { data_dir: dataDir, log_dir: logDir })
      .then((r) => r.data),

  restart: (dataDir: string, logDir: string) =>
    api.post<{ status: string; error?: string }>('/app/restart', { data_dir: dataDir, log_dir: logDir })
      .then((r) => r.data),

  bundleLogs: () =>
    api.post<{ path: string; error?: string }>('/app/bundle-logs').then((r) => r.data),

  reveal: (path: string) =>
    api.post<{ status: string; error?: string }>('/app/reveal', { path }).then((r) => r.data),
};
