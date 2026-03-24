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

  searchMessages: (username: string, q: string) =>
    api.get<void, GroupChatMessage[]>('/groups/search', { params: { username, q } }),

  exportMessages: (username: string, from?: number, to?: number) =>
    api.get<void, GroupChatMessage[]>('/groups/export', { params: { username, ...(from ? { from } : {}), ...(to ? { to } : {}) } }),
};

export default api;
