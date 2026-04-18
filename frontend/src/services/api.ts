/**
 * API 服务层
 * 统一管理所有后端接口调用
 */

import axios from 'axios';
import type { ContactStats, GlobalStats, WordCount, DBInfo, BackendStatus, TableInfo, ColumnInfo, TableData, ContactDetail, GroupInfo, GroupDetail, FilteredStats, SentimentResult, GroupChatMessage, CoolingEntry, GlobalSearchGroup, QueryResult } from '../types';

// 配置 axios 实例
const api = axios.create({
  baseURL: '/api',
  timeout: 120000, // 2 分钟（大群聊分析需要较长时间）
  headers: {
    'Content-Type': 'application/json',
  }
});

// 请求拦截器
api.interceptors.request.use(
  (config) => {
    // 可以在这里添加 token 等
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 响应拦截器
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    console.error('API Error:', error);
    return Promise.reject(error);
  }
);

/**
 * API 接口定义
 */
export const contactsApi = {
  /**
   * 获取联系人统计列表（带缓存）
   */
  getStats: () =>
    api.get<void, ContactStats[]>('/contacts/stats'),

  /**
   * 获取指定联系人的词云数据
   */
  getWordCloud: (username: string, includeMine = false) =>
    api.get<void, WordCount[]>('/contacts/wordcloud', {
      params: { username, ...(includeMine ? { include_mine: 'true' } : {}) }
    }),

  /**
   * 获取联系人深度分析数据
   */
  getDetail: (username: string) =>
    api.get<void, ContactDetail>('/contacts/detail', {
      params: { username }
    }),

  /**
   * 获取某天的聊天记录
   */
  getDayMessages: (username: string, date: string) =>
    api.get<void, import('../types').ChatMessage[]>('/contacts/messages', {
      params: { username, date }
    }),

  /**
   * 搜索联系人聊天记录
   */
  searchMessages: (username: string, q: string, includeMine = false) =>
    api.get<void, import('../types').ChatMessage[]>('/contacts/search', {
      params: { username, q, ...(includeMine ? { include_mine: 'true' } : {}) }
    }),

  exportMessages: (username: string, from?: number, to?: number) =>
    api.get<void, import('../types').ChatMessage[]>('/contacts/export', { params: { username, ...(from ? { from } : {}), ...(to ? { to } : {}) } }),

  /**
   * 获取某月的文本消息（情感分析详情）
   */
  getMonthMessages: (username: string, month: string, includeMine = false) =>
    api.get<void, import('../types').ChatMessage[]>('/contacts/messages/month', {
      params: { username, month, ...(includeMine ? { include_mine: 'true' } : {}) }
    }),

  /**
   * 获取情感分析数据
   */
  getSentiment: (username: string, includeMine = false) =>
    api.get<void, SentimentResult>('/contacts/sentiment', {
      params: { username, ...(includeMine ? { include_mine: 'true' } : {}) }
    }),

  /**
   * 获取与联系人的共同群聊
   */
  getCommonGroups: (username: string) =>
    api.get<void, GroupInfo[]>('/contacts/common-groups', { params: { username } }),

  getCooling: () =>
    api.get<void, CoolingEntry[]>('/contacts/cooling'),

  getSimilarity: (top = 20) =>
    api.get<void, import('../types').SimilarityResult>('/contacts/similarity', { params: { top } }),

  getMoneyOverview: () =>
    api.get<void, import('../types').MoneyOverview>('/contacts/money-overview'),

  getURLs: () =>
    api.get<void, import('../types').URLCollectionResult>('/contacts/urls'),

  getSocialBreadth: () =>
    api.get<void, import('../types').SocialBreadthPoint[]>('/contacts/social-breadth'),

  getSelfPortrait: () =>
    api.get<void, import('../types').SelfPortrait>('/contacts/self-portrait'),

  getCommonCircle: (user1: string, user2: string) =>
    api.get<void, import('../types').CommonCircleResult>('/contacts/common-circle', { params: { user1, user2 } }),
};

// Skill 炼化（blob 下载）
export type SkillStatus = 'pending' | 'running' | 'success' | 'failed';

export interface SkillRecord {
  id: string;
  skill_type: 'contact' | 'self' | 'group' | 'group-member';
  format: string;
  target_username?: string;
  target_name: string;
  member_speaker?: string;
  model_provider: string;
  model_name: string;
  msg_limit: number;
  filename: string;
  file_path: string;
  file_size: number;
  created_at: number;
  status: SkillStatus;
  error_msg?: string;
  updated_at: number;
}

export interface ForgeSkillResult {
  id: string;
  status: SkillStatus;
  record: SkillRecord;
}

export async function forgeSkill(opts: {
  skill_type: 'contact' | 'self' | 'group' | 'group-member';
  username?: string;
  member_speaker?: string;
  format: 'claude-skill' | 'claude-agent' | 'codex' | 'opencode' | 'cursor' | 'generic';
  profile_id?: string;
  msg_limit?: number;
}): Promise<ForgeSkillResult> {
  const resp = await fetch('/api/ai/forge-skill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
  const data = await resp.json().catch(() => ({} as { error?: string }));
  if (!resp.ok) {
    throw new Error((data as { error?: string }).error || `炼化失败: HTTP ${resp.status}`);
  }
  return data as ForgeSkillResult;
}

export const skillsApi = {
  list: () => api.get<void, { skills: SkillRecord[] }>('/skills').then(d => d.skills ?? []),
  get: (id: string) => api.get<void, SkillRecord>(`/skills/${id}`),
  delete: (id: string) => api.delete<void, { ok: boolean }>(`/skills/${id}`),
  downloadUrl: (id: string) => `/api/skills/${id}/download`,
};

export const searchApi = {
  global: (q: string, type: 'contact' | 'group' | 'all') =>
    api.get<void, GlobalSearchGroup[]>('/search', { params: { q, type } }),
};

export const globalApi = {
  /**
   * 初始化/重新索引（传入时间范围）
   */
  init: (from: number | null, to: number | null) =>
    api.post<void, { status: string }>('/init', { from: from ?? 0, to: to ?? 0 }),

  /**
   * 取消正在进行的索引
   */
  cancelIndex: () =>
    api.post<void, { cancelled: boolean }>('/cancel-index'),

  /**
   * 获取全局统计数据
   */
  getStats: () =>
    api.get<void, GlobalStats>('/global'),

  /**
   * 获取后端状态
   */
  getStatus: () =>
    api.get<void, BackendStatus>('/status'),

  /**
   * 健康检查
   */
  health: () =>
    api.get<void, { status: string }>('/health'),
};

export const databaseApi = {
  /**
   * 获取数据库信息
   */
  getInfo: () =>
    api.get<void, DBInfo[]>('/databases'),

  /**
   * 获取指定数据库的表列表
   */
  getTables: (dbName: string) =>
    api.get<void, TableInfo[]>(`/databases/${encodeURIComponent(dbName)}/tables`),

  /**
   * 获取表结构
   */
  getTableSchema: (dbName: string, tableName: string) =>
    api.get<void, ColumnInfo[]>(`/databases/${encodeURIComponent(dbName)}/tables/${encodeURIComponent(tableName)}/schema`),

  /**
   * 获取表数据（分页）
   */
  getTableData: (dbName: string, tableName: string, offset = 0, limit = 50) =>
    api.get<void, TableData>(`/databases/${encodeURIComponent(dbName)}/tables/${encodeURIComponent(tableName)}/data`, {
      params: { offset, limit }
    }),

  query: (dbName: string, sql: string) =>
    api.post<void, QueryResult>(`/databases/${encodeURIComponent(dbName)}/query`, { sql }),
};

export const statsApi = {
  /**
   * 时间范围过滤统计（from/to 为 Unix 秒）
   */
  filter: (from: number | null, to: number | null) =>
    api.get<void, FilteredStats>('/stats/filter', {
      params: {
        ...(from != null ? { from } : {}),
        ...(to != null ? { to } : {}),
      }
    }),
};

export const groupsApi = {
  getList: () =>
    api.get<void, GroupInfo[]>('/groups'),

  getDetail: (username: string) =>
    api.get<void, GroupDetail>('/groups/detail', { params: { username } }),

  getDayMessages: (username: string, date: string) =>
    api.get<void, GroupChatMessage[]>('/groups/messages', { params: { username, date } }),

  searchMessages: (username: string, q: string, speaker?: string) =>
    api.get<void, GroupChatMessage[]>('/groups/search', { params: { username, q, ...(speaker ? { speaker } : {}) } }),

  exportMessages: (username: string, from?: number, to?: number) =>
    api.get<void, GroupChatMessage[]>('/groups/export', { params: { username, ...(from ? { from } : {}), ...(to ? { to } : {}) } }),

  getRelationships: (username: string) =>
    api.get<void, import('../types').RelationshipGraph | null>('/groups/relationships', { params: { username } }),
};

export const calendarApi = {
  getHeatmap: () =>
    api.get<void, { heatmap: Record<string, number> }>('/calendar/heatmap'),

  getTrend: (days = 90) =>
    api.get<void, import('../types').CalendarTrendPoint[]>('/calendar/trend', { params: { days } }),

  getDay: (date: string) =>
    api.get<void, { contacts: import('../types').CalendarDayEntry[]; groups: import('../types').CalendarDayEntry[] }>(
      '/calendar/day', { params: { date } }
    ),

  getContactMessages: (date: string, username: string) =>
    api.get<void, import('../types').ChatMessage[]>('/calendar/messages', {
      params: { date, username, is_group: '0' }
    }),

  getGroupMessages: (date: string, username: string) =>
    api.get<void, import('../types').GroupChatMessage[]>('/calendar/messages', {
      params: { date, username, is_group: '1' }
    }),
};

export const anniversaryApi = {
  getAll: () =>
    api.get<void, import('../types').AnniversaryResponse>('/anniversaries'),

  saveCustom: (anniversaries: import('../types').CustomAnniversary[]) =>
    api.put<void, import('../types').CustomAnniversary[]>('/preferences/anniversaries', { custom_anniversaries: anniversaries }),
};

export const groupExtraApi = {
  yearReview: (username: string, year: number, profileId?: string) =>
    api.get<void, import('../types').GroupYearReview>(
      `/groups/year-review?username=${encodeURIComponent(username)}&year=${year}${profileId ? `&profile_id=${profileId}` : ''}`,
    ),
};

export const forecastApi = {
  get: (top = 5) =>
    api.get<void, import('../types').ForecastResponse>(`/contacts/relationship-forecast?top=${top}`),

  getAll: () =>
    api.get<void, import('../types').ForecastResponse>('/contacts/relationship-forecast?include_all=1'),

  icebreaker: (username: string, profileId?: string) =>
    api.post<void, import('../types').IcebreakerResponse>('/contacts/icebreaker', {
      username,
      profile_id: profileId || '',
    }),

  saveIgnored: (usernames: string[]) =>
    api.put<void, { forecast_ignored: string[] }>('/preferences/forecast-ignored', {
      forecast_ignored: usernames,
    }),
};

// ─── 导出中心 ──────────────────────────────────────────────────────────────

export type ExportContentType = 'year_review' | 'conversation' | 'ai_history' | 'memory_graph';
export type ExportTarget = 'markdown' | 'notion' | 'feishu' | 'webdav' | 's3' | 'dropbox' | 'gdrive' | 'onedrive';

export interface ExportItem {
  type: ExportContentType;
  username?: string;
  is_group?: boolean;
  year?: number;
  from?: number;
  to?: number;
  ai_key?: string;
  title?: string;
}

export interface ExportRequest {
  items: ExportItem[];
  target: ExportTarget;
  notion_parent_page?: string;
  feishu_folder_token?: string;
}

export interface ExportPreviewDoc {
  title: string;
  filename: string;
  markdown: string;
}

export interface ExportResultItem {
  title: string;
  ok: boolean;
  url?: string;
  error?: string;
  bytes?: number;
}

export interface ExportConfigDTO {
  notion_token: string;
  notion_parent_page: string;
  feishu_app_id: string;
  feishu_app_secret: string;
  feishu_folder_token: string;

  // WebDAV
  webdav_url: string;
  webdav_username: string;
  webdav_password: string;
  webdav_path: string;

  // S3 兼容
  s3_endpoint: string;
  s3_region: string;
  s3_bucket: string;
  s3_access_key: string;
  s3_secret_key: string;
  s3_path_prefix: string;
  s3_use_path_style: boolean;

  // Dropbox
  dropbox_token: string;
  dropbox_path: string;

  // Google Drive
  gdrive_client_id: string;
  gdrive_client_secret: string;
  gdrive_folder_id: string;
  gdrive_connected: boolean;

  // OneDrive
  onedrive_client_id: string;
  onedrive_client_secret: string;
  onedrive_tenant: string;
  onedrive_folder_path: string;
  onedrive_connected: boolean;
}

export const exportApi = {
  preview: (req: ExportRequest) =>
    api.post<void, { docs: ExportPreviewDoc[] }>('/export/preview', req),

  /**
   * Markdown 下载：单文件 → .md，多文件 → .zip。
   * 用 fetch 而非 axios，便于直接拿到 Blob 触发浏览器下载。
   */
  downloadMarkdown: async (req: ExportRequest) => {
    const resp = await fetch('/api/export/markdown', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(text || `下载失败 (${resp.status})`);
    }
    const blob = await resp.blob();
    const cd = resp.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename="([^"]+)"/);
    const filename = m ? decodeURIComponent(m[1]) : 'welink-export.md';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return filename;
  },

  pushNotion: (req: ExportRequest) =>
    api.post<void, { results: ExportResultItem[] }>('/export/notion', req),

  pushFeishu: (req: ExportRequest) =>
    api.post<void, { results: ExportResultItem[] }>('/export/feishu', req),

  pushWebDAV: (req: ExportRequest) =>
    api.post<void, { results: ExportResultItem[] }>('/export/webdav', req),

  pushS3: (req: ExportRequest) =>
    api.post<void, { results: ExportResultItem[] }>('/export/s3', req),

  pushDropbox: (req: ExportRequest) =>
    api.post<void, { results: ExportResultItem[] }>('/export/dropbox', req),

  pushGDrive: (req: ExportRequest) =>
    api.post<void, { results: ExportResultItem[] }>('/export/gdrive', req),

  pushOneDrive: (req: ExportRequest) =>
    api.post<void, { results: ExportResultItem[] }>('/export/onedrive', req),

  getConfig: () => api.get<void, ExportConfigDTO>('/export/config'),
  saveConfig: (cfg: ExportConfigDTO) => api.put<void, { ok: boolean }>('/export/config', cfg),
};

export default api;
