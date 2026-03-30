/**
 * AI 分析 Tab — 支持私聊和群聊，可选时间范围，附 token 估算与提示
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Bot, Send, RotateCcw, Loader2, AlertTriangle, Info, Copy, Check, CalendarDays, SlidersHorizontal, Square, Database, Search, Share2, ChevronDown, ChevronRight, BrainCircuit, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { generateShareImage } from '../../utils/shareImage';
import { contactsApi, groupsApi } from '../../services/api';
import { CalendarRangePicker } from './CalendarRangePicker';
import {
  useAnalysisState,
  updateAnalysisState,
  clearAnalysisState,
  getAnalysisState,
  loadFromDB,
  scheduleSaveToDB,
  deleteFromDB,
} from '../../stores/llmAnalysisStore';
import type { AnalysisMessage } from '../../stores/llmAnalysisStore';

// ─── 类型 ──────────────────────────────────────────────────────────────────────

type Message = AnalysisMessage;

export interface LLMAnalysisProps {
  username: string;
  displayName: string;
  isGroup: boolean;
  totalMessages?: number; // 总消息数（用于估算）
  avatarUrl?: string;     // 联系人头像 URL（用于分享卡片）
  initialQuery?: string;  // 从首页传入的预填问题
  quickMode?: boolean;    // 首页快速提问：全量模式 + 最近 200 条 + 自动脱敏 + 自动发送
  onOpenSettings?: () => void; // 跳转到设置页（配置失败时引导用户）
}

// ─── 时间范围 ──────────────────────────────────────────────────────────────────

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function shiftDays(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return isoDate(d); }
function shiftMonths(n: number) { const d = new Date(); d.setMonth(d.getMonth() - n); return isoDate(d); }

const today = isoDate(new Date());

const RANGE_PRESETS = [
  { label: '最近一周',  from: shiftDays(6),    to: today },
  { label: '最近一月',  from: shiftMonths(1),  to: today },
  { label: '最近三月',  from: shiftMonths(3),  to: today },
  { label: '最近半年',  from: shiftMonths(6),  to: today },
  { label: '最近一年',  from: shiftMonths(12), to: today },
  { label: '全部记录',  from: '',              to: '' },
] as const;

// ─── Token 估算 ────────────────────────────────────────────────────────────────

// 粗略估算：中文消息平均 30 字/条 ≈ 15 token/条，加系统提示约 500 token
function estimateTokens(msgCount: number): number {
  return Math.round(msgCount * 15 + 500);
}

// 各模型上下文窗口（token），保守估计留 20% 给回答
const MODEL_CONTEXTS: Record<string, number> = {
  deepseek:  Math.round(64000  * 0.8),
  kimi:      Math.round(128000 * 0.8),
  gemini:    Math.round(1000000* 0.8),
  glm:       Math.round(128000 * 0.8),
  grok:      Math.round(131000 * 0.8),
  openai:    Math.round(128000 * 0.8),
  claude:    Math.round(200000 * 0.8),
  ollama:    Math.round(8000   * 0.8),
  custom:    Math.round(8000   * 0.8),
};

function getProviderLimit(provider: string): number {
  return MODEL_CONTEXTS[provider] ?? 6400;
}

const PROVIDER_LABELS: Record<string, string> = {
  deepseek: 'DeepSeek', kimi: 'Kimi', gemini: 'Gemini', glm: 'GLM',
  grok: 'Grok', openai: 'OpenAI', claude: 'Claude', ollama: 'Ollama', custom: '自定义',
};
const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  deepseek: 'deepseek-chat', kimi: 'moonshot-v1-8k', gemini: 'gemini-2.0-flash',
  glm: 'glm-4-flash', grok: 'grok-3-mini', openai: 'gpt-4o-mini',
  claude: 'claude-haiku-4-5-20251001', ollama: 'llama3',
};

type TokenLevel = 'ok' | 'warn' | 'danger' | 'over';

function tokenLevel(tokens: number, limit: number): TokenLevel {
  const ratio = tokens / limit;
  if (ratio < 0.5)  return 'ok';
  if (ratio < 0.8)  return 'warn';
  if (ratio < 1.0)  return 'danger';
  return 'over';
}

const LEVEL_STYLE: Record<TokenLevel, string> = {
  ok:     'bg-green-50  border-green-100  text-green-700',
  warn:   'bg-yellow-50 border-yellow-100 text-yellow-700',
  danger: 'bg-orange-50 border-orange-100 text-orange-600',
  over:   'bg-red-50    border-red-100    text-red-600',
};

const LEVEL_ICON: Record<TokenLevel, React.ReactNode> = {
  ok:     <Info size={13} className="flex-shrink-0 text-green-500" />,
  warn:   <Info size={13} className="flex-shrink-0 text-yellow-500" />,
  danger: <AlertTriangle size={13} className="flex-shrink-0 text-orange-500" />,
  over:   <AlertTriangle size={13} className="flex-shrink-0 text-red-500" />,
};

const LEVEL_MSG: Record<TokenLevel, string> = {
  ok:     '在模型上下文范围内，可以正常分析。',
  warn:   '接近模型上下文上限，建议缩短时间范围。',
  danger: '超过推荐上下文量，模型可能截断早期消息，结果可能不完整。',
  over:   '已超过模型上下文限制，将自动分段摘要后再分析（耗时较长，请耐心等候）。',
};

// ─── 隐私脱敏 ─────────────────────────────────────────────────────────────────

/**
 * 对聊天文本做隐私脱敏：
 * - 大陆手机号 → [手机号]
 * - 18/15 位身份证 → [身份证]
 * - 电子邮箱 → [邮箱]
 * - 16-19 位连续数字（银行卡/账号）→ [卡号]
 * - 联系人显示名（≥2字）→ [联系人]（群聊不替换，成员名太多）
 */
function maskPrivacy(text: string, displayName?: string, isGroup?: boolean): string {
  let r = text;
  // 手机号（1开头11位，排除纯数字时间戳）
  r = r.replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, '[手机号]');
  // 18位身份证
  r = r.replace(/[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[012])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]/gi, '[身份证]');
  // 15位旧身份证
  r = r.replace(/[1-9]\d{14}/g, '[身份证]');
  // 电子邮箱
  r = r.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '[邮箱]');
  // 16-19位连续数字（银行卡/账号），排除已替换的占位符
  r = r.replace(/(?<!\[)\b\d{16,19}\b/g, '[卡号]');
  // 联系人姓名（仅私聊，群聊成员太多无法枚举）
  if (!isGroup && displayName && displayName.length >= 2) {
    const escaped = displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    r = r.replace(new RegExp(escaped, 'g'), '[联系人]');
  }
  return r;
}

// ─── 预设 Prompt ───────────────────────────────────────────────────────────────

const CONTACT_PRESETS = [
  { label: '关系分析', prompt: '请分析我和这个人的聊天关系，包括互动频率、话题偏好、情感倾向，以及这段关系的特点。' },
  { label: '高频话题', prompt: '请总结我们聊天中最常讨论的话题和关键词，并分析各话题的比重与变化趋势。' },
  { label: '沟通风格', prompt: '请分析我和这个人各自的沟通风格：用词习惯、句子长短、表达方式，以及两人风格的异同。' },
  { label: '情感变化', prompt: '请分析我们聊天记录中情感基调的变化，找出情绪高峰和低谷的时期，以及可能的原因。' },
  { label: '趣味总结', prompt: '请用轻松有趣的方式总结我们的聊天记录，找出印象最深的对话片段或有趣的互动模式。' },
];

const GROUP_PRESETS = [
  { label: '群氛围', prompt: '请分析这个群聊的整体氛围：活跃程度、常见话题、群成员的互动模式。' },
  { label: '核心成员', prompt: '请识别群聊中最活跃的成员，分析他们各自的发言风格和在群内的角色定位。' },
  { label: '话题热点', prompt: '请总结群聊中出现最多的话题和关键词，哪些事件或话题引发了最热烈的讨论？' },
  { label: '活跃规律', prompt: '请分析群聊的活跃时间规律：什么时间段最活跃？有哪些明显的高峰期？' },
  { label: '趣味总结', prompt: '请用轻松有趣的方式总结这个群聊的聊天记录，找出最有趣或最令人印象深刻的内容。' },
];

// ─── 加载聊天记录 ─────────────────────────────────────────────────────────────

async function loadMessages(
  username: string,
  displayName: string,
  isGroup: boolean,
  from: string,
  to: string,
  limit?: number,
): Promise<{ text: string; count: number; lines: string[] }> {
  const fromTs = from ? Math.floor(new Date(from).getTime() / 1000) : 0;
  const toTs   = to   ? Math.floor(new Date(to   + 'T23:59:59').getTime() / 1000) : 0;

  if (isGroup) {
    const msgs = await groupsApi.exportMessages(username, fromTs || undefined, toTs || undefined) ?? [];
    if (msgs.length === 0) return { text: '（该时间范围内暂无聊天记录）', count: 0, lines: [] };
    const recent = limit && msgs.length > limit ? msgs.slice(-limit) : msgs;
    const lines = recent.map(m => `[${m.date ?? ''} ${m.time}] ${m.speaker}：${m.content}`);
    return { text: lines.join('\n'), count: lines.length, lines };
  } else {
    const msgs = await contactsApi.exportMessages(username, fromTs || undefined, toTs || undefined) ?? [];
    if (msgs.length === 0) return { text: '（该时间范围内暂无聊天记录）', count: 0, lines: [] };
    const recent = limit && msgs.length > limit ? msgs.slice(-limit) : msgs;
    const lines = recent.map(m => `[${m.date ?? ''} ${m.time}] ${m.is_mine ? '我' : displayName}：${m.content}`);
    return { text: lines.join('\n'), count: lines.length, lines };
  }
}

// ─── 消息气泡（含复制按钮）────────────────────────────────────────────────────

const AssistantMessage: React.FC<{
  msg: Message;
  displayName?: string;
  avatarUrl?: string;
  prevQuestion?: string;
  currentProvider?: string;
  currentModel?: string;
  onDelete?: () => void;
}> = ({ msg, displayName, avatarUrl, prevQuestion, currentProvider, currentModel, onDelete }) => {
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareMsg, setShareMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [thinkingOpen, setThinkingOpen] = useState(false);

  const handleCopy = () => {
    if (!msg.content) return;
    navigator.clipboard.writeText(msg.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  const handleShare = async () => {
    if (!msg.content || sharing) return;
    setSharing(true);
    setShareMsg(null);
    try {
      const savedPath = await generateShareImage({
        question: prevQuestion,
        answer: msg.content,
        contactName: displayName,
        avatarUrl,
        stats: msg.elapsedSecs !== undefined ? {
          provider: msg.provider,
          model: msg.model,
          elapsedSecs: msg.elapsedSecs,
          tokensPerSec: msg.tokensPerSec,
          charCount: msg.charCount,
          timestamp: msg.timestamp,
        } : undefined,
      });
      const isAppMode = savedPath.startsWith('/');
      setShareMsg({ ok: true, text: isAppMode ? `已保存至 ${savedPath}` : '图片已下载' });
    } catch (err) {
      setShareMsg({ ok: false, text: `生成失败：${(err as Error).message}` });
    } finally {
      setSharing(false);
      setTimeout(() => setShareMsg(null), 4000);
    }
  };

  if (msg.role === 'user') {
    return (
      <div className="flex gap-2 flex-row-reverse group">
        <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center bg-[#07c160] text-white text-[10px] font-black">
          我
        </div>
        <div className="flex flex-col items-end gap-1 max-w-[80%]">
          <div className="px-4 py-2.5 rounded-2xl rounded-br-sm text-sm leading-relaxed whitespace-pre-wrap break-words bg-[#07c160] text-white">
            {msg.content}
          </div>
          {onDelete && (
            <button
              onClick={onDelete}
              className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold text-gray-400 hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all"
              title="删除此问答"
            >
              <Trash2 size={11} />
              删除
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2 flex-row group">
        <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center bg-[#576b95] text-white text-[10px] font-black mt-0.5">
          <Bot size={13} />
        </div>
        <div className="flex flex-col gap-1 max-w-[80%]">
          <div className="px-4 py-2.5 rounded-2xl rounded-bl-sm text-sm leading-relaxed bg-[#f0f0f0] dark:bg-white/10 text-[#1d1d1f] dark:text-gray-100 prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-hr:my-2">
            {msg.thinking && (
              <div className="not-prose mb-2">
                <button
                  onClick={() => setThinkingOpen(v => !v)}
                  className="flex items-center gap-1.5 text-[11px] text-[#576b95] hover:text-[#576b95]/80 transition-colors"
                >
                  <BrainCircuit size={12} />
                  <span>{msg.streaming && !msg.content ? '正在思考…' : '思考过程'}</span>
                  {thinkingOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                </button>
                {thinkingOpen && (
                  <div className={`mt-1.5 px-3 py-2 rounded-lg bg-[#576b95]/8 dark:bg-[#576b95]/15 border border-[#576b95]/15 text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed whitespace-pre-wrap font-mono ${msg.streaming ? '' : 'max-h-48 overflow-y-auto'}`}>
                    {msg.thinking}
                  </div>
                )}
              </div>
            )}
            {msg.content
              ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
              : msg.streaming
                ? (
                  <span className="flex items-center gap-2 text-gray-400 text-xs">
                    <Loader2 size={13} className="animate-spin text-[#576b95] flex-shrink-0" />
                    <span>
                      {msg.thinking ? '正在生成回答…' : '正在分析，请稍候…'}
                      <span className="ml-1.5 text-[#576b95]/70">
                        {currentProvider}{currentModel ? ` · ${currentModel}` : ''}
                      </span>
                    </span>
                  </span>
                )
                : ''}
            {msg.elapsedSecs !== undefined && !msg.streaming && (
              <div className="flex flex-col items-end gap-0.5 mt-2 text-[10px] text-gray-400 not-prose">
                {msg.provider && (
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium">{msg.provider}{msg.model ? ` · ${msg.model}` : ''}</span>
                    <span className="text-gray-300">·</span>
                    <span>{msg.elapsedSecs.toFixed(1)}s</span>
                    <span className="text-gray-300">·</span>
                    <span>~{msg.tokensPerSec} tok/s</span>
                    <span className="text-gray-300">·</span>
                    <span>{msg.charCount} 字符</span>
                  </div>
                )}
                {msg.timestamp && (() => {
                  const d = new Date(msg.timestamp);
                  return <span>{d.getFullYear()}年{d.getMonth()+1}月{d.getDate()}日{d.getHours()}点{String(d.getMinutes()).padStart(2,'0')}分</span>;
                })()}
              </div>
            )}
          </div>
          {msg.content && !msg.streaming && (
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold text-gray-400 hover:text-[#07c160] hover:bg-[#f0faf4] dark:hover:bg-[#07c160]/10 transition-colors"
                title="复制内容"
              >
                {copied ? <Check size={11} className="text-[#07c160]" /> : <Copy size={11} />}
                {copied ? '已复制' : '复制'}
              </button>
              <button
                onClick={handleShare}
                disabled={sharing}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold text-gray-400 hover:text-[#576b95] hover:bg-[#f0f4ff] dark:hover:bg-[#576b95]/15 transition-colors disabled:opacity-50"
                title="保存为图片分享"
              >
                {sharing ? <Loader2 size={11} className="animate-spin" /> : <Share2 size={11} />}
                {sharing ? '生成中…' : '分享'}
              </button>
              {onDelete && (
                <button
                  onClick={onDelete}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold text-gray-400 hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                  title="删除此问答"
                >
                  <Trash2 size={11} />
                  删除
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      {/* 保存路径提示：移出 max-w-[80%] 容器，避免长路径被截断 */}
      {shareMsg && (
        <p className={`text-[10px] font-medium ml-9 break-all leading-relaxed ${shareMsg.ok ? 'text-[#07c160]' : 'text-red-500'}`}>
          {shareMsg.text}
        </p>
      )}
    </div>
  );
};

// ─── 主组件 ───────────────────────────────────────────────────────────────────

export const LLMAnalysisTab: React.FC<LLMAnalysisProps> = ({
  username, displayName, isGroup, avatarUrl, initialQuery, quickMode, onOpenSettings,
}) => {
  const key = `${isGroup ? 'group' : 'contact'}:${username}`;
  const { messages, loading, chunkProgress } = useAnalysisState(key);

  // 挂载时从数据库恢复历史消息（每个 key 只加载一次）
  useEffect(() => { loadFromDB(key); }, [key]);

  const presets = isGroup ? GROUP_PRESETS : CONTACT_PRESETS;

  // 时间范围
  const [rangeFrom, setRangeFrom] = useState(shiftMonths(3));
  const [rangeTo,   setRangeTo]   = useState(today);

  // Provider profiles（从 preferences 加载，支持多配置切换）
  interface ProfileItem { id: string; name: string; provider: string; model?: string; }
  const [profiles, setProfilesState] = useState<ProfileItem[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  useEffect(() => {
    fetch('/api/preferences')
      .then(r => r.json())
      .then((d: { llm_profiles?: ProfileItem[]; llm_provider?: string; llm_model?: string }) => {
        if (d.llm_profiles && d.llm_profiles.length > 0) {
          setProfilesState(d.llm_profiles);
          setSelectedProfileId(d.llm_profiles[0].id);
        } else if (d.llm_provider) {
          const p = { id: '__default__', name: d.llm_provider, provider: d.llm_provider, model: d.llm_model ?? '' };
          setProfilesState([p]);
          setSelectedProfileId('__default__');
        }
      })
      .catch(() => {});
  }, []);
  const selectedProfile = profiles.find(p => p.id === selectedProfileId) ?? profiles[0];
  const provider = selectedProfile?.provider ?? 'deepseek';
  const llmModel = selectedProfile?.model ?? '';

  // 日历热力图数据
  const [heatmap, setHeatmap] = useState<Record<string, number>>({});
  const [calendarMode, setCalendarMode] = useState(false);
  const [msgLimit, setMsgLimit] = useState<number | null>(null); // null = 不限条数
  useEffect(() => {
    const api = isGroup ? groupsApi : contactsApi;
    api.getDetail(username)
      .then((d: { daily_heatmap?: Record<string, number> }) => setHeatmap(d?.daily_heatmap ?? {}))
      .catch(() => {});
  }, [username, isGroup]);

  // 真实消息数（范围切换后立即拉取）
  const [realMsgCount, setRealMsgCount] = useState<number | null>(null);
  const [ctxStatus, setCtxStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const contextRef  = useRef<string | null>(null);
  const linesRef    = useRef<string[] | null>(null);
  const loadAbortRef = useRef<AbortController | null>(null);

  const limit = getProviderLimit(provider);
  const estTokens = realMsgCount !== null ? estimateTokens(realMsgCount) : null;
  const level: TokenLevel = estTokens !== null ? tokenLevel(estTokens, limit) : 'ok';
  // 每段使用约 40% 的模型上下文（留余量给摘要输出），每条消息约 15 token
  const CHUNK_SIZE = Math.max(150, Math.floor(limit * 0.4 / 15));
  const estimatedChunks = realMsgCount !== null && level === 'over'
    ? Math.ceil(realMsgCount / CHUNK_SIZE)
    : null;

  // 隐私脱敏开关
  const [privacyMask, setPrivacyMask] = useState(true);

  // 混合检索模式（quickMode 强制全量）
  const [ragMode, setRagMode] = useState<'full' | 'hybrid'>(quickMode ? 'full' : 'hybrid');
  const [ragIndexStatus, setRagIndexStatus] = useState<{
    built: boolean; msg_count: number; built_at: number;
  } | null>(null);
  const [ragBuilding, setRagBuilding] = useState(false);
  const [ragBuildProgress, setRagBuildProgress] = useState<{ current: number; total: number } | null>(null);
  const [ragBuildError, setRagBuildError] = useState<string | null>(null);
  const [vecIndexStatus, setVecIndexStatus] = useState<{
    built: boolean; msg_count: number; built_at: number; model: string; dims: number;
  } | null>(null);
  const [vecBuilding, setVecBuilding] = useState(false);
  const [vecBuildStep, setVecBuildStep] = useState<string | null>(null);
  const [vecBuildProgress, setVecBuildProgress] = useState<{ current: number; total: number } | null>(null);
  const [vecBuildError, setVecBuildError] = useState<string | null>(null);
  const [memExtracting, setMemExtracting] = useState(false);
  const [memPaused, setMemPaused] = useState(false);
  const [memExtractProgress, setMemExtractProgress] = useState<{ current: number; total: number } | null>(null);
  const [memFactsCount, setMemFactsCount] = useState<number | null>(null);
  const [memFactsOpen, setMemFactsOpen] = useState(false);
  const [memFactsList, setMemFactsList] = useState<{ id: number; fact: string }[] | null>(null);
  const [memFactsLoading, setMemFactsLoading] = useState(false);
  const [memExtractError, setMemExtractError] = useState<string | null>(null);
  // 最近一次检索统计及命中消息
  const [ragInfo, setRagInfo] = useState<{
    hits: number;
    retrieved: number;
    messages?: Array<{ datetime: string; sender: string; content: string; is_hit: boolean }>;
  } | null>(null);
  const [ragContextOpen, setRagContextOpen] = useState(false);

  // 切换到混合模式时加载三类索引状态
  useEffect(() => {
    if (ragMode !== 'hybrid') return;
    fetch(`/api/ai/rag/index-status?key=${encodeURIComponent(key)}`)
      .then(r => r.json())
      .then((d: { built: boolean; msg_count: number; built_at: number }) => setRagIndexStatus(d))
      .catch(() => {});
    fetch(`/api/ai/vec/index-status?key=${encodeURIComponent(key)}`)
      .then(r => r.json())
      .then((d: { built: boolean; msg_count: number; built_at: number; model: string; dims: number }) => setVecIndexStatus(d))
      .catch(() => {});
    fetch(`/api/ai/mem/status?key=${encodeURIComponent(key)}`)
      .then(r => r.json())
      .then((d: { fact_count: number }) => setMemFactsCount(d.fact_count))
      .catch(() => {});
  }, [ragMode, key]);

  // 输入框状态（本地即可，不需要跨页面保留）
  const [input, setInput] = useState(initialQuery ?? '');
  const bottomRef  = useRef<HTMLDivElement>(null);

  // 范围变化 → 立即真实拉取（缓存结果，发送时直接复用）
  useEffect(() => {
    contextRef.current = null;
    linesRef.current = null;
    setRealMsgCount(null);
    setCtxStatus('loading');
    loadAbortRef.current?.abort();

    let cancelled = false;
    // msgLimit 模式：不限时间范围，直接取全量最后 N 条
    const effectiveFrom = (!quickMode && msgLimit != null) ? '' : rangeFrom;
    const effectiveTo   = (!quickMode && msgLimit != null) ? '' : rangeTo;
    loadMessages(username, displayName, isGroup, effectiveFrom, effectiveTo, quickMode ? 200 : (msgLimit ?? undefined))
      .then(({ text, count, lines }) => {
        if (cancelled) return;
        contextRef.current = text;
        linesRef.current = lines;
        setRealMsgCount(count);
        setCtxStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setCtxStatus('error');
      });

    return () => { cancelled = true; };
  }, [username, displayName, isGroup, rangeFrom, rangeTo, msgLimit]);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, []);

  // context 已由 useEffect 预加载，这里直接返回缓存
  const ensureContext = useCallback(async (): Promise<string | null> => {
    if (contextRef.current !== null) return contextRef.current;
    // 万一还在加载中，等一下再重试
    if (ctxStatus === 'loading') {
      await new Promise(r => setTimeout(r, 500));
      return contextRef.current;
    }
    return null;
  }, [ctxStatus]);

  // 范围切换
  const handleRangeChange = (from: string, to: string) => {
    setRangeFrom(from);
    setRangeTo(to);
  };


  const chunkedSummarize = useCallback(async (
    lines: string[],
    onProgress: (current: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<string> => {
    const chunks: string[][] = [];
    for (let i = 0; i < lines.length; i += CHUNK_SIZE) {
      chunks.push(lines.slice(i, i + CHUNK_SIZE));
    }
    const roleDesc = isGroup ? `群聊「${displayName}」` : `我与「${displayName}」`;
    const summaries: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      onProgress(i + 1, chunks.length);
      const resp = await fetch('/api/ai/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          messages: [
            {
              role: 'system',
              content: `你是一个聊天记录摘要助手，请简洁总结以下聊天片段的核心内容，控制在 300 字以内，用中文输出。`,
            },
            {
              role: 'user',
              content: `以下是${roleDesc}的第 ${i + 1}/${chunks.length} 段聊天记录：\n\n${chunks[i].join('\n')}`,
            },
          ],
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `第 ${i + 1} 段摘要失败`);
      }
      const data = await resp.json() as { content?: string; error?: string };
      if (data.error) throw new Error(data.error);
      summaries.push(`[片段 ${i + 1}/${chunks.length}]\n${data.content ?? ''}`);
    }
    return summaries.join('\n\n');
  }, [isGroup, displayName]);

  const buildRagIndex = useCallback(async () => {
    setRagBuilding(true);
    setRagBuildError(null);
    setRagBuildProgress({ current: 0, total: 0 });
    try {
      const resp = await fetch('/api/ai/rag/build-index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, username, is_group: isGroup }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? resp.statusText);
      }
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const p = JSON.parse(line.slice(6)) as {
              step: string; current?: number; total?: number; done?: boolean; error?: string;
            };
            if (p.error) throw new Error(p.error);
            if (p.step === 'indexing' && p.total) {
              setRagBuildProgress({ current: p.current ?? 0, total: p.total });
            }
            if (p.done) {
              // Refresh status
              const s = await fetch(`/api/ai/rag/index-status?key=${encodeURIComponent(key)}`).then(r => r.json());
              setRagIndexStatus(s);
              setRagBuildProgress(null);
            }
          } catch (e) {
            if (!(e instanceof SyntaxError)) throw e;
          }
        }
      }
    } catch (e: unknown) {
      setRagBuildError(e instanceof Error ? e.message : '构建失败');
      setRagBuildProgress(null);
    } finally {
      setRagBuilding(false);
    }
  }, [key, username, isGroup]);

  const vecPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const memPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startVecPolling = useCallback((k: string) => {
    if (vecPollRef.current) clearInterval(vecPollRef.current);
    vecPollRef.current = setInterval(async () => {
      try {
        const p = await fetch(`/api/ai/vec/build-progress?key=${encodeURIComponent(k)}`).then(r => r.json()) as {
          running: boolean; step?: string; current?: number; total?: number; done?: boolean; error?: string;
        };
        if (p.error) {
          setVecBuildError(p.error);
          setVecBuildProgress(null);
          setVecBuildStep(null);
          setVecBuilding(false);
          clearInterval(vecPollRef.current!);
          return;
        }
        setVecBuildStep(p.step ?? null);
        if (p.step === 'embedding' && p.total) {
          setVecBuildProgress({ current: p.current ?? 0, total: p.total });
        }
        if (p.done) {
          const s = await fetch(`/api/ai/vec/index-status?key=${encodeURIComponent(k)}`).then(r => r.json());
          setVecIndexStatus(s);
          setVecBuildProgress(null);
          setVecBuildStep(null);
          setVecBuilding(false);
          clearInterval(vecPollRef.current!);
        }
      } catch { /* network hiccup, retry next tick */ }
    }, 2000);
  }, []);

  // 独立记忆提炼轮询（与 vec 构建完全分离）
  const startMemPolling = useCallback((k: string) => {
    if (memPollRef.current) clearInterval(memPollRef.current);
    memPollRef.current = setInterval(async () => {
      try {
        const p = await fetch(`/api/ai/vec/build-progress?key=${encodeURIComponent(k)}`).then(r => r.json()) as {
          done?: boolean; paused?: boolean; error?: string; fact_count?: number; current?: number; total?: number;
        };
        if (p.error) {
          setMemExtractError(p.error);
          setMemExtracting(false);
          setMemPaused(false);
          setMemExtractProgress(null);
          clearInterval(memPollRef.current!);
          return;
        }
        if (p.current != null && p.total) {
          setMemExtractProgress({ current: p.current, total: p.total });
        }
        // 实时更新已入库事实数量
        fetch(`/api/ai/mem/status?key=${encodeURIComponent(k)}`)
          .then(r => r.json())
          .then((d: { fact_count: number }) => setMemFactsCount(d.fact_count ?? 0))
          .catch(() => {});
        if (p.paused) {
          setMemExtracting(false);
          setMemPaused(true);
          setMemExtractProgress(prev => prev); // 保留进度显示
          clearInterval(memPollRef.current!);
          return;
        }
        if (p.done) {
          setMemFactsCount(p.fact_count ?? 0);
          setMemFactsList(null);
          setMemExtracting(false);
          setMemPaused(false);
          setMemExtractProgress(null);
          clearInterval(memPollRef.current!);
        }
      } catch { /* retry */ }
    }, 2000);
  }, []);

  // 切换到 hybrid 模式时，检查是否有正在进行的后台构建
  useEffect(() => {
    if (ragMode !== 'hybrid') return;
    fetch(`/api/ai/vec/build-progress?key=${encodeURIComponent(key)}`)
      .then(r => r.json())
      .then((p: { running?: boolean; paused?: boolean; step?: string; current?: number; total?: number }) => {
        if (p.running) {
          setVecBuilding(true);
          setVecBuildStep(p.step ?? null);
          if (p.step === 'embedding' && p.total) setVecBuildProgress({ current: p.current ?? 0, total: p.total });
          startVecPolling(key);
        }
        if (p.step === 'extracting' && p.running) {
          setMemExtracting(true);
          if (p.current != null && p.total) setMemExtractProgress({ current: p.current, total: p.total });
          startMemPolling(key);
        }
        if (p.paused) {
          setMemPaused(true);
          if (p.current != null && p.total) setMemExtractProgress({ current: p.current, total: p.total });
        }
      })
      .catch(() => {});
  }, [ragMode, key, startVecPolling, startMemPolling]);

  // 展开列表时拉取；提炼中每 4s 自动刷新
  const memFactsListRefRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const memFactsListElRef = useRef<HTMLUListElement | null>(null);

  // 组件卸载时清理轮询
  useEffect(() => () => {
    if (vecPollRef.current) clearInterval(vecPollRef.current);
    if (memPollRef.current) clearInterval(memPollRef.current);
    if (memFactsListRefRef.current) clearInterval(memFactsListRefRef.current);
  }, []);
  useEffect(() => {
    if (!memFactsOpen) {
      if (memFactsListRefRef.current) { clearInterval(memFactsListRefRef.current); memFactsListRefRef.current = null; }
      return;
    }
    let cancelled = false;
    let isFirst = true;
    const fetchFacts = () => {
      if (isFirst) setMemFactsLoading(true);
      // 保存当前滚动位置，刷新后恢复，避免自动滚到顶
      const savedScrollTop = memFactsListElRef.current?.scrollTop ?? 0;
      fetch(`/api/ai/mem/facts?key=${encodeURIComponent(key)}`)
        .then(r => r.json())
        .then((d: { facts: { id: number; fact: string }[] }) => {
          if (!cancelled) {
            setMemFactsList(d.facts ?? []);
            if (!isFirst) {
              // 下一帧恢复滚动位置
              requestAnimationFrame(() => {
                if (memFactsListElRef.current) memFactsListElRef.current.scrollTop = savedScrollTop;
              });
            }
            isFirst = false;
          }
        })
        .catch(() => { if (!cancelled) { setMemFactsList([]); isFirst = false; } })
        .finally(() => { if (!cancelled) setMemFactsLoading(false); });
    };
    fetchFacts();
    // 提炼中定时刷新
    if (memExtracting) {
      memFactsListRefRef.current = setInterval(fetchFacts, 4000);
    }
    return () => {
      cancelled = true;
      if (memFactsListRefRef.current) { clearInterval(memFactsListRefRef.current); memFactsListRefRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memFactsOpen, memExtracting, key]);

  const buildMemFacts = useCallback(async () => {
    setMemExtracting(true);
    setMemPaused(false);
    setMemExtractError(null);
    setMemExtractProgress(null);
    setMemFactsList(null);
    try {
      const resp = await fetch(`/api/ai/mem/build?key=${encodeURIComponent(key)}`, { method: 'POST' });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? resp.statusText);
      }
      startMemPolling(key);
    } catch (e: unknown) {
      setMemExtractError(e instanceof Error ? e.message : '提炼失败');
      setMemExtracting(false);
    }
  }, [key, startMemPolling]);

  const pauseMemFacts = useCallback(async () => {
    try {
      await fetch(`/api/ai/mem/pause?key=${encodeURIComponent(key)}`, { method: 'POST' });
    } catch { /* ignore */ }
  }, [key]);

  const buildVecIndex = useCallback(async () => {
    setVecBuilding(true);
    setVecBuildError(null);
    setVecBuildProgress({ current: 0, total: 0 });
    try {
      const resp = await fetch('/api/ai/vec/build-index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, username, is_group: isGroup }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? resp.statusText);
      }
      // 后台已启动，开始轮询进度
      startVecPolling(key);
    } catch (e: unknown) {
      setVecBuildError(e instanceof Error ? e.message : '构建失败');
      setVecBuildProgress(null);
      setVecBuilding(false);
    }
  }, [key, username, isGroup, startVecPolling]);

  const sendMessage = useCallback(async (userText: string) => {
    if (!userText.trim() || loading) return;

    // 帮助函数：更新指定 assistantIdx 处的消息
    const updateMsg = (idx: number, patch: Partial<Message>) =>
      updateAnalysisState(key, prev => {
        const next = [...prev.messages];
        if (next[idx]) next[idx] = { ...next[idx], ...patch };
        return { ...prev, messages: next };
      });

    const userMsg: Message = { role: 'user', content: userText.trim() };
    const newMessages = [...messages, userMsg];
    updateAnalysisState(key, prev => ({ ...prev, messages: newMessages, loading: true }));
    setInput('');
    scrollToBottom();

    // 混合检索模式不需要预加载全量记录
    let ctx: string | null = null;
    if (ragMode === 'full') {
      // 懒加载 context
      ctx = await ensureContext();
      if (ctx === null) {
        updateAnalysisState(key, prev => ({
          ...prev,
          messages: [...newMessages, { role: 'assistant', content: '❌ 加载聊天记录失败，请重试', streaming: false }],
          loading: false,
        }));
        return;
      }
      // 该时间范围内没有消息，不发送请求
      if (realMsgCount === 0) {
        updateAnalysisState(key, prev => ({
          ...prev,
          messages: prev.messages.slice(0, -1),
          loading: false,
        }));
        return;
      }
    }

    const roleDesc = isGroup
      ? `群聊「${displayName}」的聊天记录`
      : `用户「我」与联系人「${displayName}」的微信聊天记录`;

    const assistantIdx = newMessages.length;
    const abort = new AbortController();

    // 推入占位气泡，保存 abort controller
    updateAnalysisState(key, prev => ({
      ...prev,
      messages: [...prev.messages, { role: 'assistant', content: '', streaming: true }],
      abort,
    }));

    // ── 混合检索模式：直接检索，不加载全量记录 ────────────────────────────
    if (ragMode === 'hybrid') {
      const streamStart = Date.now();
      try {
        const resp = await fetch('/api/ai/rag', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key,
            messages: newMessages.map(m => ({ role: m.role, content: m.content })),
            profile_id: selectedProfileId !== '__default__' ? selectedProfileId : '',
          }),
          signal: abort.signal,
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({})) as { error?: string };
          throw new Error(err.error ?? resp.statusText);
        }
        const reader = resp.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const chunk = JSON.parse(line.slice(6)) as {
                delta?: string; done?: boolean; error?: string;
                rag_meta?: {
                  hits: number; retrieved: number;
                  messages?: Array<{ datetime: string; sender: string; content: string; is_hit: boolean }>;
                };
              };
              if (chunk.error) throw new Error(chunk.error);
              if (chunk.rag_meta) { setRagInfo(chunk.rag_meta); setRagContextOpen(false); }
              if (chunk.done) break;
              if (chunk.delta) {
                updateAnalysisState(key, prev => {
                  const next = [...prev.messages];
                  const msg = next[assistantIdx];
                  if (msg) next[assistantIdx] = { ...msg, content: msg.content + (chunk.delta ?? '') };
                  return { ...prev, messages: next };
                });
                scrollToBottom();
              }
            } catch (e) {
              if (!(e instanceof SyntaxError)) throw e;
            }
          }
        }
      } catch (e: unknown) {
        if ((e as { name?: string }).name === 'AbortError') return;
        updateMsg(assistantIdx, { content: `❌ ${e instanceof Error ? e.message : '请求失败'}`, streaming: false });
      } finally {
        const elapsedSecs = (Date.now() - streamStart) / 1000;
        updateAnalysisState(key, prev => {
          const next = [...prev.messages];
          const msg = next[assistantIdx];
          if (msg) {
            const charCount = msg.content.length;
            const tokensPerSec = elapsedSecs > 0.1 ? Math.round(charCount / elapsedSecs / 1.5) : 0;
            next[assistantIdx] = { ...msg, streaming: false, provider, model: llmModel, elapsedSecs, tokensPerSec, charCount, timestamp: Date.now() };
          }
          return { ...prev, messages: next, loading: false, abort: null };
        });
        scheduleSaveToDB(key);
        scrollToBottom();
      }
      return;
    }

    // ── 全量模式 ─────────────────────────────────────────────────────────
    // ctx is non-null here (full mode with successful load)
    let effectiveCtx = privacyMask ? maskPrivacy(ctx ?? '', displayName, isGroup) : (ctx ?? '');
    const effectiveLines = privacyMask && linesRef.current
      ? linesRef.current.map(l => maskPrivacy(l, displayName, isGroup))
      : linesRef.current;

    if (realMsgCount !== null && estimateTokens(realMsgCount) > limit && linesRef.current && linesRef.current.length > 0) {
      const chunkLines = effectiveLines ?? linesRef.current;
      try {
        const total = Math.ceil(chunkLines.length / CHUNK_SIZE);
        updateAnalysisState(key, prev => ({ ...prev, chunkProgress: { current: 0, total } }));
        effectiveCtx = await chunkedSummarize(
          chunkLines,
          (current, total) => {
            updateAnalysisState(key, prev => ({ ...prev, chunkProgress: { current, total } }));
            updateMsg(assistantIdx, { content: `📊 正在分段分析（${current}/${total}）…` });
          },
          abort.signal,
        );
        updateAnalysisState(key, prev => ({ ...prev, chunkProgress: null }));
        updateMsg(assistantIdx, { content: '' });
      } catch (e: unknown) {
        if ((e as { name?: string }).name === 'AbortError') return;
        updateMsg(assistantIdx, { content: `❌ ${e instanceof Error ? e.message : '分段摘要失败'}`, streaming: false });
        updateAnalysisState(key, prev => ({ ...prev, loading: false, chunkProgress: null, abort: null }));
        return;
      }
    }

    const systemPrompt = `你是一个聊天记录分析助手。以下是${roleDesc}（时间范围：${rangeFrom || '全部'} ~ ${rangeTo || '全部'}）：

${effectiveCtx}

请根据以上聊天记录回答用户的问题。分析时请客观、有洞察力，用中文回答，语言自然流畅。`;

    const llmMessages = [
      { role: 'system', content: systemPrompt },
      ...newMessages.map(m => ({ role: m.role, content: m.content })),
    ];

    const streamStart = Date.now();
    try {
      const resp = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: llmMessages,
          profile_id: selectedProfileId !== '__default__' ? selectedProfileId : '',
        }),
        signal: abort.signal,
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? resp.statusText);
      }

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const chunk = JSON.parse(line.slice(6)) as { delta?: string; thinking?: string; done?: boolean; error?: string };
            if (chunk.error) throw new Error(chunk.error);
            if (chunk.done) break;
            if (chunk.delta || chunk.thinking) {
              updateAnalysisState(key, prev => {
                const next = [...prev.messages];
                const msg = next[assistantIdx];
                if (msg) next[assistantIdx] = {
                  ...msg,
                  content: chunk.delta ? msg.content + chunk.delta : msg.content,
                  thinking: chunk.thinking ? (msg.thinking ?? '') + chunk.thinking : msg.thinking,
                };
                return { ...prev, messages: next };
              });
              scrollToBottom();
            }
          } catch (e) {
            if (!(e instanceof SyntaxError)) throw e;
          }
        }
      }
    } catch (e: unknown) {
      if ((e as { name?: string }).name === 'AbortError') return;
      updateMsg(assistantIdx, { content: `❌ ${e instanceof Error ? e.message : '请求失败'}`, streaming: false });
    } finally {
      const elapsedSecs = (Date.now() - streamStart) / 1000;
      updateAnalysisState(key, prev => {
        const next = [...prev.messages];
        const msg = next[assistantIdx];
        if (msg) {
          const charCount = msg.content.length;
          const tokensPerSec = elapsedSecs > 0.1 ? Math.round(charCount / elapsedSecs / 1.5) : 0;
          next[assistantIdx] = { ...msg, streaming: false, provider, model: llmModel, elapsedSecs, tokensPerSec, charCount, timestamp: Date.now() };
        }
        return { ...prev, messages: next, loading: false, abort: null };
      });
      scheduleSaveToDB(key);
      scrollToBottom();
    }
  }, [messages, loading, ensureContext, isGroup, displayName, rangeFrom, rangeTo, scrollToBottom, realMsgCount, limit, chunkedSummarize, key, privacyMask, ragMode, setRagInfo]); // eslint-disable-line react-hooks/exhaustive-deps

  // quickMode 自动发送：context 就绪后立即发送 initialQuery，只触发一次
  const autoSentRef = useRef(false);
  useEffect(() => {
    if (quickMode && initialQuery && ctxStatus === 'ready' && !autoSentRef.current && !loading) {
      autoSentRef.current = true;
      sendMessage(initialQuery);
    }
  }, [quickMode, initialQuery, ctxStatus, loading, sendMessage]);

  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const handleReset = () => {
    setResetConfirmOpen(true);
  };

  const confirmReset = () => {
    getAnalysisState(key).abort?.abort();
    clearAnalysisState(key);
    deleteFromDB(key);
    setInput('');
    setResetConfirmOpen(false);
  };

  const handleStop = () => {
    getAnalysisState(key).abort?.abort();
    updateAnalysisState(key, prev => {
      const next = [...prev.messages];
      const last = next[next.length - 1];
      if (last?.role === 'assistant' && last.streaming) {
        next[next.length - 1] = { ...last, content: last.content || '（已停止）', streaming: false };
      }
      return { ...prev, messages: next, loading: false, chunkProgress: null, abort: null };
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const activePreset = (from: string, to: string) =>
    rangeFrom === from && rangeTo === to;

  return (
    <div className="flex flex-col gap-4" style={{ minHeight: 420 }}>

      {/* ── 分析模式切换 + 当前模型 ── */}
      <div className="flex items-center gap-3 flex-wrap">
        {!quickMode && (
          <div className="flex flex-col gap-1">
            <div className="flex rounded-xl overflow-hidden border border-gray-200 dark:border-white/15 text-xs font-bold">
              <button
                onClick={() => setRagMode('hybrid')}
                className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors ${ragMode === 'hybrid' ? 'bg-[#576b95] text-white' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 bg-white dark:bg-white/5'}`}
                title="适合消息量大（数年）、查询具体问题：他喜欢什么、某件事什么时候发生"
              >
                <Search size={11} />
                混合检索
              </button>
              <button
                onClick={() => { setRagMode('full'); setRagInfo(null); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors ${ragMode === 'full' ? 'bg-[#07c160] text-white' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 bg-white dark:bg-white/5'}`}
                title="适合消息量适中、需要整体总结：分析关系、聊天风格、情感走势"
              >
                <SlidersHorizontal size={11} />
                全量分析
              </button>
            </div>
            <p className="text-[10px] text-gray-400 leading-relaxed">
              {ragMode === 'hybrid'
                ? '适合查询具体事件 / 细节，消息量无上限'
                : '适合整体总结分析，受消息量限制'}
            </p>
          </div>
        )}
        {quickMode && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#f0faf4] border border-[#07c160]/20 text-[10px] text-[#07c160] font-semibold">
            <SlidersHorizontal size={10} className="flex-shrink-0" />
            最近 200 条 · 已脱敏
          </div>
        )}
      </div>

      {/* ── 混合检索模式：索引管理 ── */}
      {ragMode === 'hybrid' && (
        <div className="bg-[#f0f4ff] dark:bg-[#576b95]/10 rounded-2xl border border-[#d0d8f0] dark:border-[#576b95]/30 p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[10px] font-black text-[#576b95] uppercase tracking-wider flex items-center gap-1.5">
              <Database size={11} />
              混合检索索引
            </p>
          </div>
          <p className="text-[10px] text-[#576b95]/70 leading-relaxed -mt-1">
            每次提问时自动从全量聊天记录中检索最相关的片段，适合问「他喜欢什么」「我们什么时候去过 XX」等具体问题。需要总结整体关系或分析情感走势，请切换到<button className="underline font-semibold hover:text-[#576b95] transition-colors" onClick={() => { setRagMode('full'); setRagInfo(null); }}>全量分析</button>。
          </p>

          {/* FTS 关键词索引 */}
          <div className="dk-card bg-white rounded-xl border border-[#dce3f5] dark:border-[#576b95]/30 p-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold text-[#576b95]">关键词索引（FTS）</span>
              {ragIndexStatus?.built && (
                <span className="text-[10px] text-gray-400">
                  {ragIndexStatus.msg_count.toLocaleString()} 条 · {new Date(ragIndexStatus.built_at * 1000).toLocaleDateString()}
                </span>
              )}
            </div>
            {ragBuilding ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-xs text-[#576b95]">
                  <Loader2 size={12} className="animate-spin flex-shrink-0" />
                  {ragBuildProgress?.total
                    ? `正在索引 ${ragBuildProgress.current.toLocaleString()} / ${ragBuildProgress.total.toLocaleString()} 条…`
                    : '加载消息中…'}
                </div>
                {ragBuildProgress?.total ? (
                  <div className="w-full h-1 bg-[#d0d8f0] dark:bg-[#576b95]/20 rounded-full overflow-hidden">
                    <div className="h-full bg-[#576b95] rounded-full transition-all duration-300"
                      style={{ width: `${Math.round(ragBuildProgress.current / ragBuildProgress.total * 100)}%` }} />
                  </div>
                ) : null}
              </div>
            ) : ragIndexStatus?.built ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#576b95]">✓ 已建立</span>
                <button onClick={buildRagIndex} className="ml-auto text-[10px] font-semibold text-gray-400 hover:text-[#576b95] underline">重建</button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-gray-400 flex-1">未建立</span>
                <button onClick={buildRagIndex} className="px-2.5 py-1 rounded-lg bg-[#576b95] text-white text-[10px] font-semibold hover:bg-[#4a5c82] transition-colors">构建</button>
              </div>
            )}
            {ragBuildError && <p className="mt-1 text-xs text-red-500">❌ {ragBuildError}</p>}
          </div>

          {/* 向量索引 */}
          <div className="dk-card bg-white rounded-xl border border-[#dce3f5] dark:border-[#576b95]/30 p-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold text-[#576b95]">语义向量索引</span>
              {vecIndexStatus?.built && (
                <span className="text-[10px] text-gray-400">
                  {vecIndexStatus.msg_count.toLocaleString()} 条 · {vecIndexStatus.model}
                </span>
              )}
            </div>
            {vecBuilding ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-xs text-[#576b95]">
                  <Loader2 size={12} className="animate-spin flex-shrink-0" />
                  {vecBuildProgress?.total
                    ? `正在 embedding ${vecBuildProgress.current.toLocaleString()} / ${vecBuildProgress.total.toLocaleString()} 条…`
                    : '加载消息中…'}
                </div>
                {vecBuildProgress?.total ? (
                  <div className="w-full h-1 bg-[#d0d8f0] dark:bg-[#576b95]/20 rounded-full overflow-hidden">
                    <div className="h-full bg-[#576b95] rounded-full transition-all duration-300"
                      style={{ width: `${Math.round(vecBuildProgress.current / vecBuildProgress.total * 100)}%` }} />
                  </div>
                ) : null}
              </div>
            ) : vecIndexStatus?.built ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#576b95]">✓ 已建立</span>
                <button onClick={buildVecIndex} className="ml-auto text-[10px] font-semibold text-gray-400 hover:text-[#576b95] underline">重建</button>
              </div>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-500 dark:text-gray-400 flex-1">未建立（需先配置 Embedding）
                  {onOpenSettings && (
                    <button onClick={onOpenSettings} className="ml-1.5 text-[#576b95] underline hover:text-[#4a5c82] transition-colors font-semibold">去设置</button>
                  )}
                </span>
                <button onClick={buildVecIndex} className="px-2.5 py-1 rounded-lg bg-[#576b95] text-white text-[10px] font-semibold hover:bg-[#4a5c82] transition-colors">构建</button>
              </div>
            )}
            {vecBuildError && (
              <p className="mt-1 text-xs text-red-500 flex items-start gap-1 flex-wrap">
                <span>❌ Embedding 失败：{vecBuildError}</span>
                {onOpenSettings && (
                  <button onClick={onOpenSettings} className="text-[#576b95] underline hover:text-[#4a5c82] transition-colors font-semibold flex-shrink-0">去设置</button>
                )}
              </p>
            )}
          </div>

          {/* 记忆事实（LLM 提炼） */}
          <div className="dk-card bg-white rounded-xl border border-[#dce3f5] dark:border-[#576b95]/30 p-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold text-[#576b95]">记忆事实（LLM 提炼）</span>
              {memFactsCount != null && memFactsCount > 0 && (
                <button
                  onClick={() => setMemFactsOpen(prev => !prev)}
                  className="text-[10px] text-[#576b95] hover:text-[#4a5c82] font-semibold flex items-center gap-1 transition-colors"
                >
                  {memFactsCount} 条{memExtracting ? '（提炼中…）' : ''}
                  <span className="opacity-60">{memFactsOpen ? '▲' : '▼'}</span>
                </button>
              )}
            </div>
            {memExtracting ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-xs text-[#576b95]">
                  <Loader2 size={11} className="animate-spin flex-shrink-0" />
                  <span className="flex-1">
                    {memExtractProgress?.total
                      ? `正在提炼第 ${memExtractProgress.current} / ${memExtractProgress.total} 批…`
                      : '正在提炼记忆事实…'}
                  </span>
                  <button
                    onClick={pauseMemFacts}
                    className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-[10px] font-semibold hover:bg-amber-200 transition-colors flex-shrink-0"
                  >
                    暂停
                  </button>
                </div>
                {memExtractProgress?.total ? (
                  <div className="w-full h-1 bg-[#d0d8f0] dark:bg-[#576b95]/20 rounded-full overflow-hidden">
                    <div className="h-full bg-[#576b95] rounded-full transition-all duration-300"
                      style={{ width: `${Math.round(memExtractProgress.current / memExtractProgress.total * 100)}%` }} />
                  </div>
                ) : null}
              </div>
            ) : memPaused ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-amber-600 flex-1">
                    ⏸ 已暂停
                    {memExtractProgress?.total
                      ? `（${memExtractProgress.current} / ${memExtractProgress.total} 批）`
                      : ''}
                  </span>
                  <button
                    onClick={buildMemFacts}
                    className="px-2.5 py-1 rounded-lg bg-[#576b95] text-white text-[10px] font-semibold hover:bg-[#4a5c82] transition-colors"
                  >
                    继续
                  </button>
                </div>
                {memExtractProgress?.total ? (
                  <div className="w-full h-1 bg-[#d0d8f0] dark:bg-[#576b95]/20 rounded-full overflow-hidden">
                    <div className="h-full bg-[#576b95] rounded-full transition-all duration-300"
                      style={{ width: `${Math.round(memExtractProgress.current / memExtractProgress.total * 100)}%` }} />
                  </div>
                ) : null}
              </div>
            ) : memFactsCount == null ? (
              <span className="text-xs text-gray-400">加载中…</span>
            ) : memFactsCount > 0 ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#576b95]">✓ 已提炼，对话时自动补充背景知识</span>
                {vecIndexStatus?.built && (
                  <button onClick={buildMemFacts} className="ml-auto text-[10px] font-semibold text-gray-400 hover:text-[#576b95] underline">重新提炼</button>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 dark:text-gray-400 flex-1">
                    {vecIndexStatus?.built ? '尚未提炼' : '请先构建语义向量索引'}
                  </span>
                  {vecIndexStatus?.built && (
                    <button onClick={buildMemFacts} className="px-2.5 py-1 rounded-lg bg-[#576b95] text-white text-[10px] font-semibold hover:bg-[#4a5c82] transition-colors">提炼</button>
                  )}
                </div>
                {vecIndexStatus?.built && (
                  <p className="text-[10px] text-amber-600 leading-relaxed">
                    ⚠️ 提炼时会读取全量聊天记录，推荐在设置中配置本地 Ollama 模型，确保数据不出本机。
                  </p>
                )}
                {memExtractError && (
                  <p className="text-[10px] text-red-500">❌ {memExtractError}</p>
                )}
              </div>
            )}
            {memFactsOpen && (
              <div className="mt-2 border-t border-[#eef1f7] dark:border-white/10 pt-2">
                {memFactsLoading ? (
                  <div className="flex items-center gap-1.5 text-xs text-gray-400">
                    <Loader2 size={11} className="animate-spin" />加载中…
                  </div>
                ) : memFactsList && memFactsList.length > 0 ? (
                  <ul ref={memFactsListElRef} className="max-h-48 overflow-y-auto space-y-1 pr-1">
                    {memFactsList.map(f => (
                      <li key={f.id} className="flex items-start gap-1.5 text-xs text-gray-700 dark:text-gray-300">
                        <span className="mt-0.5 w-1 h-1 rounded-full bg-[#576b95] flex-shrink-0" />
                        {f.fact}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-xs text-gray-400">暂无数据</span>
                )}
              </div>
            )}
          </div>
          {ragInfo && (
            <div className="mt-2">
              {ragInfo.hits === 0 ? (
                <p className="text-[10px] text-amber-600 leading-relaxed">
                  ⚠️ 本次未检索到相关内容，回答可能不准确。建议：换一种表达方式，或切换到<button className="underline font-semibold hover:text-amber-700 transition-colors" onClick={() => { setRagMode('full'); setRagInfo(null); }}>全量分析</button>。
                </p>
              ) : (
              <button
                onClick={() => setRagContextOpen(o => !o)}
                className="flex items-center gap-1.5 text-[10px] text-[#576b95] hover:text-[#4a5c82] transition-colors"
              >
                <Search size={10} />
                本次检索：命中 {ragInfo.hits} 条，含上下文共 {ragInfo.retrieved} 条
                <span className="ml-0.5 opacity-60">{ragContextOpen ? '▲' : '▼'}</span>
              </button>
              )}
              {ragContextOpen && ragInfo.messages && ragInfo.messages.length > 0 && (
                <div className="mt-2 max-h-60 overflow-y-auto rounded-xl border border-[#c8d0e8] dark:border-[#576b95]/30 dk-card bg-white dark:divide-white/10 divide-y divide-[#eaedfa]">
                  {ragInfo.messages.map((m, i) => (
                    <div
                      key={i}
                      className={`px-3 py-2 text-[11px] leading-relaxed ${m.is_hit ? 'bg-[#eef1fb] dark:bg-[#576b95]/15' : ''}`}
                    >
                      <span className="text-[#576b95] font-semibold mr-1.5">
                        {m.sender}
                      </span>
                      <span className="text-gray-400 mr-2">{m.datetime}</span>
                      {m.is_hit && (
                        <span className="inline-block px-1 py-0.5 rounded text-[9px] font-bold bg-[#576b95] text-white mr-1.5 leading-none">命中</span>
                      )}
                      <span className="text-gray-700 dark:text-gray-300 break-all">{m.content}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── 时间范围选择器（全量模式） ── */}
      {ragMode === 'full' && (
      <div className="dk-subtle dk-border bg-[#f8f9fb] rounded-2xl border border-gray-100 p-4">
        {/* 标题 + 模式切换 */}
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">分析时间范围</p>
          <div className="flex rounded-xl overflow-hidden border border-gray-200 dark:border-white/15 text-[10px] font-bold">
            <button
              onClick={() => setCalendarMode(false)}
              className={`flex items-center gap-1 px-2.5 py-1.5 transition-colors ${!calendarMode ? 'bg-[#07c160] text-white' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 bg-white dark:bg-white/5'}`}
            >
              <SlidersHorizontal size={10} />
              预设
            </button>
            <button
              onClick={() => setCalendarMode(true)}
              className={`flex items-center gap-1 px-2.5 py-1.5 transition-colors ${calendarMode ? 'bg-[#07c160] text-white' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 bg-white dark:bg-white/5'}`}
            >
              <CalendarDays size={10} />
              日历
            </button>
          </div>
        </div>
        <p className="text-[10px] text-gray-400 mb-3 leading-relaxed">将所选时间范围内的全量消息发给 AI，适合总结关系、分析情感走势。消息量过大时建议缩短范围，或切换到<button className="underline font-semibold hover:text-gray-500 transition-colors" onClick={() => setRagMode('hybrid')}>混合检索</button>。</p>

        {calendarMode ? (
          /* ── 日历拖选 ── */
          <CalendarRangePicker
            data={heatmap}
            from={rangeFrom}
            to={rangeTo}
            onRangeChange={handleRangeChange}
          />
        ) : (
          /* ── 快捷预设 + 日期输入 ── */
          <>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {RANGE_PRESETS.map(p => (
                <button
                  key={p.label}
                  onClick={() => { handleRangeChange(p.from, p.to); setMsgLimit(null); }}
                  className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                    activePreset(p.from, p.to) && msgLimit === null
                      ? 'bg-[#07c160] text-white border-[#07c160]'
                      : 'text-gray-500 dark:text-gray-400 border-gray-200 dark:border-white/15 hover:border-[#07c160] hover:text-[#07c160]'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5 mb-3 items-center">
              <span className="text-[10px] text-gray-400 font-semibold">最近条数：</span>
              {[100, 300, 1000].map(n => (
                <button
                  key={n}
                  onClick={() => setMsgLimit(prev => prev === n ? null : n)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                    msgLimit === n
                      ? 'bg-[#576b95] text-white border-[#576b95]'
                      : 'text-gray-500 dark:text-gray-400 border-gray-200 dark:border-white/15 hover:border-[#576b95] hover:text-[#576b95]'
                  }`}
                >
                  {n} 条
                </button>
              ))}
              {msgLimit !== null && (
                <span className="text-[10px] text-[#576b95]">· 全部聊天记录中最近 {msgLimit} 条，不受时间范围限制</span>
              )}
            </div>
            {msgLimit === null && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={rangeFrom}
                onChange={e => handleRangeChange(e.target.value, rangeTo)}
                className="dk-input flex-1 text-xs border border-gray-200 rounded-xl px-3 py-1.5 focus:outline-none focus:border-[#07c160] bg-white"
              />
              <span className="text-gray-300 text-xs">至</span>
              <input
                type="date"
                value={rangeTo}
                onChange={e => handleRangeChange(rangeFrom, e.target.value)}
                className="dk-input flex-1 text-xs border border-gray-200 rounded-xl px-3 py-1.5 focus:outline-none focus:border-[#07c160] bg-white"
              />
            </div>
            )}
          </>
        )}

        {/* Token 估算 / 无消息提示 */}
        {ctxStatus === 'loading' ? (
          <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
            <Loader2 size={11} className="animate-spin text-[#07c160]" />
            正在统计该时间范围的消息数…
          </div>
        ) : ctxStatus === 'ready' && realMsgCount === 0 ? (
          <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-xl border dk-subtle bg-gray-50 dk-border border-gray-100 text-xs text-gray-400">
            <Info size={13} className="flex-shrink-0" />
            该时间范围内没有聊天记录，请选择其他时间段。
          </div>
        ) : chunkProgress !== null ? (
          <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-xl border bg-blue-50 border-blue-100 text-xs text-blue-600">
            <Loader2 size={11} className="animate-spin flex-shrink-0" />
            正在分段分析第 {chunkProgress.current}/{chunkProgress.total} 段，请稍候…
          </div>
        ) : estTokens !== null && realMsgCount !== 0 && (
          <div className={`mt-3 flex items-start gap-2 px-3 py-2 rounded-xl border text-xs ${LEVEL_STYLE[level]}`}>
            {LEVEL_ICON[level]}
            <div>
              <span className="font-semibold">
                约 {realMsgCount?.toLocaleString()} 条消息，估算 ~{(estTokens / 1000).toFixed(1)}k token
              </span>
              <span className="mx-1.5 text-current/50">·</span>
              {LEVEL_MSG[level]}
              {level === 'danger' && (
                <span className="block mt-0.5 opacity-80">
                  当前模型上下文限制约 {Math.round(limit / 1000)}k token，建议改用「最近三月」或「最近一月」。
                </span>
              )}
              {level === 'over' && estimatedChunks !== null && (
                <span className="block mt-0.5 opacity-80">
                  将自动分为 <strong>{estimatedChunks} 段</strong>（每段约 {CHUNK_SIZE} 条）逐段摘要，耗时较长，发送前可缩短时间范围以减少分段数。
                </span>
              )}
            </div>
          </div>
        )}

        {/* 隐私脱敏开关 */}
        <label className="mt-3 flex items-start gap-2.5 cursor-pointer group">
          <input
            type="checkbox"
            checked={privacyMask}
            onChange={e => setPrivacyMask(e.target.checked)}
            className="mt-0.5 w-3.5 h-3.5 rounded accent-[#07c160] flex-shrink-0 cursor-pointer"
          />
          <span className="text-xs leading-relaxed text-gray-500 dark:text-gray-400 group-hover:text-gray-700 dark:group-hover:text-gray-300 transition-colors select-none">
            <span className="font-semibold text-gray-700 dark:text-gray-300">发送前隐私脱敏</span>
            <span className="mx-1">·</span>
            自动将手机号、身份证、邮箱、银行卡号
            {!isGroup && <span>及联系人姓名</span>}
            替换为占位符后再发送，可有效减少隐私泄露风险
            {privacyMask && <span className="ml-1 text-[#07c160] font-semibold">（已启用）</span>}
          </span>
        </label>
      </div>
      )} {/* end ragMode === 'full' */}

      {/* ── 模式引导（无对话时显示） ── */}
      {messages.length === 0 && !quickMode && (
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setRagMode('hybrid')}
            className={`text-left p-3.5 rounded-2xl border-2 transition-all ${
              ragMode === 'hybrid'
                ? 'border-[#576b95] bg-[#f0f4ff] dark:bg-[#576b95]/10'
                : 'border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 hover:border-[#576b95]/40'
            }`}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <Search size={13} className="text-[#576b95] flex-shrink-0" />
              <span className="text-xs font-bold text-[#576b95]">混合检索</span>
              {ragMode === 'hybrid' && <span className="ml-auto text-[9px] bg-[#576b95] text-white px-1.5 py-0.5 rounded-full font-bold">当前</span>}
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed mb-2">适合消息量大（多年记录），查询具体事件或细节</p>
            <ul className="text-[10px] text-gray-400 space-y-0.5">
              <li>✓ 他喜欢什么运动/食物</li>
              <li>✓ 我们什么时候去过某个地方</li>
              <li>✓ 他说过关于工作的哪些事</li>
            </ul>
          </button>
          <button
            onClick={() => { setRagMode('full'); setRagInfo(null); }}
            className={`text-left p-3.5 rounded-2xl border-2 transition-all ${
              ragMode === 'full'
                ? 'border-[#07c160] bg-[#f0faf4] dark:bg-[#07c160]/10'
                : 'border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 hover:border-[#07c160]/40'
            }`}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <SlidersHorizontal size={13} className="text-[#07c160] flex-shrink-0" />
              <span className="text-xs font-bold text-[#07c160]">全量分析</span>
              {ragMode === 'full' && <span className="ml-auto text-[9px] bg-[#07c160] text-white px-1.5 py-0.5 rounded-full font-bold">当前</span>}
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed mb-2">适合消息量适中，需要整体总结或情感分析</p>
            <ul className="text-[10px] text-gray-400 space-y-0.5">
              <li>✓ 总结我们的聊天风格</li>
              <li>✓ 分析这段关系的走势</li>
              <li>✓ 我们聊得最多的话题</li>
            </ul>
          </button>
        </div>
      )}

      {/* ── 快捷 Prompt（无对话时、全量模式下显示） ── */}
      {messages.length === 0 && ragMode === 'full' && (
        <div>
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-2">快捷分析</p>
          <div className="flex flex-wrap gap-2">
            {presets.map(p => (
              <button
                key={p.label}
                onClick={() => sendMessage(p.prompt)}
                disabled={loading || (ctxStatus === 'ready' && realMsgCount === 0)}
                className="px-3 py-1.5 text-xs font-semibold rounded-full border border-gray-200 dark:border-white/15 text-gray-600 dark:text-gray-300 hover:border-[#07c160] hover:text-[#07c160] hover:bg-[#f0faf4] dark:hover:bg-[#07c160]/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── 加载状态提示（全量模式） ── */}
      {ragMode === 'full' && ctxStatus === 'loading' && (
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Loader2 size={12} className="animate-spin text-[#07c160]" />
          正在加载聊天记录…
        </div>
      )}
      {ragMode === 'full' && ctxStatus === 'error' && (
        <div className="text-xs text-red-500 px-3 py-2 bg-red-50 rounded-xl border border-red-100">
          ❌ 加载聊天记录失败，请检查网络后重试
        </div>
      )}

      {/* ── 对话记录 ── */}
      {messages.length > 0 && (
        <div className="flex-1 overflow-y-auto space-y-4 max-h-[45vh] pr-1">
          {messages.map((msg, i) => (
            <AssistantMessage
              key={i}
              msg={msg}
              displayName={displayName}
              avatarUrl={avatarUrl}
              prevQuestion={
                msg.role === 'assistant'
                  ? [...messages].slice(0, i).reverse().find(m => m.role === 'user')?.content
                  : undefined
              }
              currentProvider={provider}
              currentModel={llmModel}
              onDelete={loading ? undefined : () => {
                // 找到与当前消息配对的索引，成对删除
                let delStart: number;
                let delEnd: number;
                if (msg.role === 'user') {
                  delStart = i;
                  // 找紧随其后的 assistant 消息
                  const nextAssist = messages.findIndex((m, j) => j > i && m.role === 'assistant');
                  delEnd = nextAssist >= 0 ? nextAssist + 1 : i + 1;
                } else {
                  // assistant 消息：找它前面紧邻的 user 消息
                  let prevUser = i - 1;
                  while (prevUser >= 0 && messages[prevUser].role !== 'user') prevUser--;
                  delStart = prevUser >= 0 ? prevUser : i;
                  delEnd = i + 1;
                }
                updateAnalysisState(key, prev => ({
                  ...prev,
                  messages: prev.messages.filter((_, j) => j < delStart || j >= delEnd),
                }));
                scheduleSaveToDB(key);
              }}
            />
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      {/* ── 输入区 ── */}
      <div className="flex flex-col gap-2 mt-auto">
        {/* 当前模型提示 */}
        {profiles.length === 0 ? (
          <button
            onClick={onOpenSettings}
            className="flex items-center gap-1.5 self-start px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-[10px] text-amber-600 hover:bg-amber-100 transition-colors"
          >
            <Bot size={9} className="flex-shrink-0" />
            <span className="font-semibold">未配置 AI 模型</span>
            <span className="underline">去设置</span>
          </button>
        ) : profiles.length <= 1 ? (
          <div className="flex items-center gap-1 self-start px-2 py-0.5 rounded-full bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10 text-[10px] text-gray-400">
            <Bot size={9} className="flex-shrink-0" />
            <span className="font-semibold text-gray-500 dark:text-gray-300">{PROVIDER_LABELS[provider] ?? provider}</span>
            <span className="text-gray-300">·</span>
            <span className="font-mono">{llmModel || PROVIDER_DEFAULT_MODELS[provider] || provider}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 flex-wrap">
            <Bot size={9} className="text-gray-400 flex-shrink-0" />
            {profiles.map(p => (
              <button
                key={p.id}
                onClick={() => setSelectedProfileId(p.id)}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors ${
                  selectedProfileId === p.id
                    ? 'bg-[#576b95] text-white border-[#576b95]'
                    : 'bg-white dark:bg-white/5 text-gray-400 dark:text-gray-400 border-gray-200 dark:border-white/15 hover:border-[#576b95] hover:text-[#576b95]'
                }`}
              >
                {`${PROVIDER_LABELS[p.provider] ?? p.provider}${p.model ? ` · ${p.model}` : ''}`}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
        {!loading && (
          <button
            onClick={handleReset}
            className="p-2.5 rounded-xl text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors flex-shrink-0"
            title="重置对话"
          >
            <RotateCcw size={16} />
          </button>
        )}
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={ragMode === 'hybrid' ? '问具体问题：他喜欢什么、我们什么时候去过哪里… （Enter 发送）' : '输入问题，或选择上方快捷分析…（Enter 发送，Shift+Enter 换行）'}
          rows={2}
          disabled={loading || (ragMode === 'full' ? (ctxStatus === 'ready' && realMsgCount === 0) : (ragMode === 'hybrid' && !ragIndexStatus?.built))}
          className="dk-input flex-1 resize-none px-4 py-2.5 rounded-2xl border border-gray-200 text-sm focus:outline-none focus:border-[#07c160] transition-colors bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
        />
        {loading ? (
          <button
            onClick={handleStop}
            className="p-2.5 bg-red-400 hover:bg-red-500 text-white rounded-xl flex items-center justify-center transition-colors flex-shrink-0"
            title="停止生成"
          >
            <Square size={18} fill="white" />
          </button>
        ) : (
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || (ragMode === 'full' ? (ctxStatus === 'ready' && realMsgCount === 0) : !ragIndexStatus?.built)}
            className="p-2.5 bg-[#07c160] text-white rounded-xl hover:bg-[#06ad56] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
          >
            <Send size={18} />
          </button>
        )}
        </div>
      </div>

      {/* ── 重置确认弹窗 ── */}
      {resetConfirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setResetConfirmOpen(false)}
        >
          <div
            className="dk-card bg-white rounded-2xl shadow-xl p-6 w-72 flex flex-col gap-4"
            onClick={e => e.stopPropagation()}
          >
            <div>
              <p className="font-semibold text-gray-800 dark:text-gray-200 mb-1">重置对话？</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                将清空当前对话记录，并从数据库中删除本次分析历史，此操作不可撤销。
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setResetConfirmOpen(false)}
                className="flex-1 py-2 rounded-xl border border-gray-200 dark:border-white/15 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
              >
                取消
              </button>
              <button
                onClick={confirmReset}
                className="flex-1 py-2 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 transition-colors"
              >
                确认重置
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
