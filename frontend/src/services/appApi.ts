import axios from 'axios';

const api = axios.create({ baseURL: '/api', timeout: 120000 });

export interface AppInfo {
  app_mode: boolean;
  needs_setup: boolean;
  ready: boolean;
  version?: string;
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
    api.post<{ status: string; error?: string }>('/app/setup', { data_dir: dataDir, log_dir: logDir })
      .then((r) => r.data),

  restart: (dataDir: string, logDir: string) =>
    api.post<{ status: string; error?: string }>('/app/restart', { data_dir: dataDir, log_dir: logDir })
      .then((r) => r.data),

  bundleLogs: () =>
    api.post<{ path: string; error?: string }>('/app/bundle-logs').then((r) => r.data),
};
