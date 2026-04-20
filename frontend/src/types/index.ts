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
  their_chars?: number;
  my_chars?: number;
  first_message_time: string;
  last_message_time: string;
  first_message_ts?: number;  // Unix 秒，RelativeTime 显示用
  last_message_ts?: number;
  first_msg?: string;
  type_pct?: Record<string, number>;
  type_cnt?: Record<string, number>;
  monthly_trend?: Record<string, number>;
  hourly_heatmap?: number[];
  type_mix?: Record<string, number>;
  shared_groups_count?: number;
  peak_monthly?: number;
  peak_period?: string;
  recent_monthly?: number;
  recall_count?: number;
  avg_msg_len?: number;
  money_count?: number;
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
  group_monthly_trend?: Record<string, number>;
  hourly_heatmap: number[];
  group_hourly_heatmap?: number[];
  type_distribution: Record<string, number>;
  late_night_ranking: LateNightEntry[];
}

export interface MoneyEvent {
  time: string;    // "2024-03-15 14:23"
  is_mine: boolean;
  kind: string;    // "红包" | "转账"
}

export interface ReplyRhythm {
  my_avg_seconds: number;
  their_avg_seconds: number;
  my_median_seconds: number;
  their_median_seconds: number;
  my_quick_replies: number;
  their_quick_replies: number;
  my_slow_replies: number;
  their_slow_replies: number;
  my_total_replies: number;
  their_total_replies: number;
  my_hourly_avg: number[];
  their_hourly_avg: number[];
}

export interface ContactDetail {
  hourly_dist: number[];      // [24]
  weekly_dist: number[];      // [7]
  daily_heatmap: Record<string, number>;
  their_monthly_trend: Record<string, number>;
  my_monthly_trend: Record<string, number>;
  late_night_count: number;
  money_count: number;
  red_packet_count: number;
  transfer_count: number;
  money_timeline?: MoneyEvent[];
  initiation_count: number;
  total_sessions: number;
  reply_rhythm?: ReplyRhythm;
  density_curve?: Record<string, number>; // "2024-01" → 月均消息间隔（秒）
  interval_buckets?: Record<string, number>; // 10s/1min/10min/1h/6h/1d → 次数
}

export interface URLEntry {
  url: string;
  domain: string;
  time: string;
  contact: string;
  username: string;
  is_mine: boolean;
  context: string;
}

export interface URLCollectionResult {
  total: number;
  domains: Record<string, number>;
  urls: URLEntry[];
}

export interface SocialBreadthPoint {
  date: string;
  unique_contacts: number;
  total_messages: number;
}

export interface CommonCircleGroup {
  username: string;
  name: string;
  small_head_url: string;
  member_count: number;
  other_members: string[];
}

export interface CommonFriend {
  name: string;
  username: string;
  avatar?: string;
  is_my_contact: boolean;
  group_count: number;
}

export interface CommonCircleResult {
  user1_name: string;
  user2_name: string;
  shared_groups: CommonCircleGroup[];
  common_friends: CommonFriend[];
}

export interface SelfPortrait {
  total_sent: number;
  total_chars: number;
  avg_msg_len: number;
  hourly_dist: number[];
  weekly_dist: number[];
  initiation_count: number;
  total_contacts: number;
  top_active_hour: number;
  top_active_weekday: number;
  most_contacted_name: string;
  most_contacted_count: number;
}

export interface WordCount {
  word: string;
  count: number;
}

export interface DBInfo {
  name: string;
  path: string;
  size: number;
  type: 'contact' | 'message' | 'ai';
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

export interface IndexProgress {
  done: number;
  total: number;
  current_contact: string;
  elapsed_ms: number;
}

export interface BackendStatus {
  is_indexing: boolean;
  is_initialized: boolean;
  total_cached: number;
  progress?: IndexProgress;
  last_error?: string;
}

export type TabType = 'dashboard' | 'stats' | 'contacts' | 'db' | 'groups' | 'search' | 'timeline' | 'calendar' | 'anniversary' | 'urls' | 'skills' | 'export' | 'memory' | 'settings';

export interface DetectedEvent {
  type: string;
  username: string;
  display_name: string;
  avatar_url: string;
  date: string;        // MM-DD
  years: number[];
  evidence: string;
}

export interface FriendMilestone {
  username: string;
  display_name: string;
  avatar_url: string;
  first_msg_date: string;
  days_known: number;
  next_milestone: number;
  next_milestone_date: string;
  days_until: number;
}

export interface CustomAnniversary {
  id: string;
  title: string;
  date: string;        // YYYY-MM-DD
  recurring: boolean;
  username?: string;
}

export interface AnniversaryResponse {
  detected: DetectedEvent[];
  milestones: FriendMilestone[];
  custom: CustomAnniversary[];
}

export type ForecastStatus = 'rising' | 'stable' | 'cooling' | 'endangered';

export interface ForecastEntry {
  username: string;
  display_name: string;
  avatar_url: string;
  status: ForecastStatus;
  score: number;
  trend_pct: number;
  recent_3m: number;
  prior_3m: number;
  days_since_last: number;
  reason: string;
  suggestion: string;
  monthly_12?: number[];  // 旧→新，仅 include_all=1 时返回
  initiator_recent: number; // 最近 3 月我的主动占比 0-100，-1 = 样本不足
  initiator_prior: number;  // 前 3 月我的主动占比
  initiator_trend: number;  // 差值（百分点）
  their_latency_recent_sec: number; // TA 回复我的中位时延（秒），-1 = 样本不足
  their_latency_prior_sec: number;
  mine_latency_recent_sec: number;  // 我回复 TA 的中位时延
  mine_latency_prior_sec: number;
}

export interface ForecastResponse {
  suggest_contact: ForecastEntry[];
  all?: ForecastEntry[];  // 仅 include_all=1 时返回
  generated_at: number;
  total_scored: number;
}

export interface IcebreakerDraft {
  tone: string;
  text: string;
}

export interface IcebreakerResponse {
  drafts: IcebreakerDraft[];
  display_name: string;
  days_since_last: number;
}

export interface RelationshipNode {
  id: string;
  name: string;
  messages: number;
  community: number;
}

export interface RelationshipEdge {
  source: string;
  target: string;
  weight: number;
  replies: number;
  mentions: number;
}

export interface CommunityInfo {
  id: number;
  members: string[];
  size: number;
}

export interface RelationshipGraph {
  nodes: RelationshipNode[];
  edges: RelationshipEdge[];
  communities?: CommunityInfo[];
  // Louvain 模块度。<0.3 表示无明显小圈子，前端据此改用"群内互动较散"的提示
  modularity?: number;
}

export interface SimilarityPair {
  user1: string;
  name1: string;
  avatar1: string;
  user2: string;
  name2: string;
  avatar2: string;
  score: number;
  top_shared: string[];
}

export interface SimilarityResult {
  pairs: SimilarityPair[];
  total: number;
}

export interface CalendarDayEntry {
  username: string;
  display_name: string;
  small_head_url: string;
  count: number;
  is_group: boolean;
}

export interface CalendarTrendPoint {
  date: string;
  count: number;
}

export interface CoolingEntry {
  username: string;
  display_name: string;
  small_head_url: string;
  peak_monthly: number;
  recent_monthly: number;
  drop_ratio: number;
  peak_period: string;
  total_messages: number;
}

export interface GlobalSearchGroup {
  username: string;
  display_name: string;
  small_head_url: string;
  messages: ChatMessage[];
  count: number;
  is_group: boolean;
}

export interface GroupInfo {
  username: string;
  name: string;
  small_head_url: string;
  total_messages: number;
  member_count: number;
  first_message_time?: string;
  last_message_time: string;
  first_message_ts?: number;
  last_message_ts?: number;
  my_messages?: number;           // 我在此群的发言数
  my_rank?: number;               // 我的排名（1-based，0=未发言）
  my_last_message_ts?: number;    // 我上次发言 Unix 秒
  recent_30d_messages?: number;   // 近 30 天消息数
  recent_trend_pct?: number;      // 最近 3 月 vs 前 3 月 %
}

export interface MemberStat {
  speaker: string;
  username?: string;
  count: number;          // 全类型消息数（图片/红包/小程序/表情都算）
  text_count?: number;    // 纯文本消息数（Skill 炼化实际能吃进去的量；后端 v2+ 才有）
  last_message_time?: string;
  first_message_time?: string;
  last_message_ts?: number;
  first_message_ts?: number;
}

export interface GroupDetail {
  hourly_dist: number[];
  weekly_dist: number[];
  daily_heatmap: Record<string, number>;
  member_rank: MemberStat[];
  top_words: { word: string; count: number }[];
  type_dist?: Record<string, number>;
  my_cps?: MyCPEntry[]; // 群内跟我引用互动最多的成员 Top 3
  weekly_hourly_dist?: number[][]; // 7×24 二维，weekday 0=周日
  my_influence_score?: number;     // 0-100，-1=样本不足
  my_reply_rate?: number;          // 0-1
  group_base_reply_rate?: number;  // 0-1
}

export interface GroupYearReview {
  group_name: string;
  year: number;
  total_messages: number;
  total_members: number;
  busiest_day: string;
  busiest_day_count: number;
  top_members: { username: string; display_name: string; avatar_url: string; messages: number }[];
  top_topics: string[];
  golden_quotes: string[];
  monthly_trend: number[];
  highlight?: string;
}

export interface MyCPEntry {
  username: string;
  display_name: string;
  avatar_url: string;
  replies: number; // TA 引用回复我 + 我引用回复 TA 合计
}

export interface HealthStatus {
  hot: number;     // 最近 7 天有消息
  warm: number;    // 7–30 天
  cooling: number; // 30–180 天
  silent: number;  // 180 天以上有消息
  cold: number;    // 零消息
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
  date?: string;       // "2024-03-15"，搜索结果中使用
  avatar_url?: string; // 发言者头像（有联系人记录时返回）
}

export interface QueryResult {
  columns: string[];
  rows: (string | number | null)[][];
  error?: string;
}

export interface MoneyContactStat {
  username: string;
  name: string;
  avatar: string;
  sent_red_packet: number;
  recv_red_packet: number;
  sent_transfer: number;
  recv_transfer: number;
  total: number;
}

export interface MoneyOverview {
  total_red_packet: number;
  total_transfer: number;
  total_sent: number;
  total_recv: number;
  monthly_trend: Record<string, [number, number]>; // [sent, recv]
  contacts: MoneyContactStat[];
}

// null means "all time"
export interface TimeRange {
  from: number | null;  // Unix seconds
  to: number | null;    // Unix seconds
  label: string;        // e.g. "近1年" or "2024-03"
}
