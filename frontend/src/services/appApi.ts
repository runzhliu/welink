import axios from 'axios';

const api = axios.create({ baseURL: '/api', timeout: 120000 });

export interface SelfInfo {
  wxid: string;
  avatar_url: string;
  nickname: string;
}

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
  self_info?: SelfInfo;    // 当前登录微信账号的 wxid + 头像 + 昵称
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

  // 数据目录 profile（多账号切换）
  listProfiles: () =>
    api.get<{ profiles: { id: string; name: string; path: string; last_indexed_at?: number }[]; active_dir: string }>('/app/data-profiles')
      .then((r) => r.data),

  saveProfiles: (profiles: { id?: string; name: string; path: string }[]) =>
    api.put<{ profiles: { id: string; name: string; path: string }[] }>('/app/data-profiles', { profiles })
      .then((r) => r.data),

  switchProfile: (id: string) =>
    api.post<{ status?: string; warnings?: string[]; active_dir?: string; error?: string }>('/app/switch-profile', { id })
      .then((r) => r.data),

  aiBackup: () =>
    api.post<{ path?: string; size?: number; error?: string }>('/app/ai-backup').then((r) => r.data),

  aiRestore: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post<{ status?: string; error?: string }>('/app/ai-restore', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },

  resetPreferences: (hard: boolean) =>
    api.post<{ status?: string; hard?: boolean; backups?: string[]; error?: string }>('/preferences/reset', { hard })
      .then((r) => r.data),

  importPreferences: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post<{ status?: string; backup?: string; needs_data_dir?: boolean; error?: string }>('/preferences/import', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },
};
