/**
 * 类型定义
 */

export interface Contact {
  username: string;
  nickname: string;
  remark: string;
  alias: string;
  flag: number;
  description: string;
  big_head_url: string;
  small_head_url: string;
}

export interface ContactStats extends Contact {
  total_messages: number;
  their_messages?: number;
  my_messages?: number;
  first_message_time: string;
  last_message_time: string;
  first_msg?: string;
  type_pct?: Record<string, number>;
  type_cnt?: Record<string, number>;
  monthly_trend?: Record<string, number>;
  hourly_heatmap?: number[];
  type_mix?: Record<string, number>;
  shared_groups_count?: number;
}

export interface LateNightEntry {
  name: string;
  late_night_count: number;
  total_messages: number;
  ratio: number;
}

export interface GlobalStats {
  total_friends: number;
  zero_msg_friends: number;
  total_messages: number;
  monthly_trend: Record<string, number>;
  hourly_heatmap: number[];
  type_distribution: Record<string, number>;
  late_night_ranking: LateNightEntry[];
}

export interface ContactDetail {
  hourly_dist: number[];      // [24]
  weekly_dist: number[];      // [7]
  daily_heatmap: Record<string, number>;
  late_night_count: number;
  money_count: number;
  initiation_count: number;
  total_sessions: number;
}

export interface WordCount {
  word: string;
  count: number;
}

export interface DBInfo {
  name: string;
  path: string;
  size: number;
  type: 'contact' | 'message';
}

export interface TableInfo {
  name: string;
  row_count: number;
}

export interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  not_null: boolean;
  default_value: string;
  primary_key: boolean;
}

export interface TableData {
  columns: string[];
  rows: (string | number | null)[][];
  total: number;
}

export interface BackendStatus {
  is_indexing: boolean;
  is_initialized: boolean;
  total_cached: number;
}

export type TabType = 'dashboard' | 'db' | 'groups' | 'privacy';

export interface GroupInfo {
  username: string;
  name: string;
  small_head_url: string;
  total_messages: number;
  first_message_time?: string;
  last_message_time: string;
}

export interface MemberStat {
  speaker: string;
  count: number;
}

export interface GroupDetail {
  hourly_dist: number[];
  weekly_dist: number[];
  daily_heatmap: Record<string, number>;
  member_rank: MemberStat[];
  top_words: { word: string; count: number }[];
}

export interface HealthStatus {
  hot: number;   // 最近 7 天有消息
  warm: number;  // 有消息但超过 7 天
  cold: number;  // 零消息
}

export interface FilteredStats {
  contacts: ContactStats[];
  global_stats: GlobalStats;
}

export interface SentimentPoint {
  month: string;   // "2024-03"
  score: number;   // 0~1
  count: number;
}

export interface SentimentResult {
  monthly: SentimentPoint[];
  overall: number;   // 0~1
  positive: number;
  negative: number;
  neutral: number;
}

export interface ChatMessage {
  time: string;     // "14:23"
  content: string;
  is_mine: boolean;
  type: number;
  date?: string;    // "2024-03-15"，搜索结果中使用
}

export interface GroupChatMessage {
  time: string;
  speaker: string;
  content: string;
  is_mine: boolean;
  type: number;
}

// null means "all time"
export interface TimeRange {
  from: number | null;  // Unix seconds
  to: number | null;    // Unix seconds
  label: string;        // e.g. "近1年" or "2024-03"
}
