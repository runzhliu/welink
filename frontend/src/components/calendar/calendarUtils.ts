/**
 * 时光机共用工具：日期 / 热图配色 / SSE 流解析 / 常量。
 * 抽出来让 ChatCalendarPage / DayAIPanel 共享，并让主文件从 1066 行瘦身。
 */

// ─── 热图颜色 ─────────────────────────────────────────────────────────────────
// 非零档的 4 个色阶固定（内联样式），0 档走 CSS 类名，保证暗色模式下不至于「消失」
export const HEAT_COLORS_NONZERO = ['#c6e9d0', '#87d4a8', '#40c463', '#216e39'];
// 给 <legend> 展示用的 5 档（含 0），前端调色板显示
export const HEAT_COLORS_DISPLAY = ['#ebedf0', ...HEAT_COLORS_NONZERO];
export const EMPTY_CELL_CLASS = 'bg-gray-100 dark:bg-white/5';

// 返回非零色；0 档返回 null 表示「走 CSS 类名」
export function heatColor(val: number, max: number): string | null {
  if (val === 0 || max === 0) return null;
  const r = val / max;
  if (r <= 0.1) return HEAT_COLORS_NONZERO[0];
  if (r <= 0.3) return HEAT_COLORS_NONZERO[1];
  if (r <= 0.6) return HEAT_COLORS_NONZERO[2];
  return HEAT_COLORS_NONZERO[3];
}

// ─── 日期工具 ─────────────────────────────────────────────────────────────────
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
export const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
export const firstWeekday = (y: number, m: number) => {
  const d = new Date(y, m, 1).getDay();
  return d === 0 ? 6 : d - 1;
};
export const pad2 = (n: number) => String(n).padStart(2, '0');
export const dateKey = (y: number, mZero: number, d: number) => `${y}-${pad2(mZero + 1)}-${pad2(d)}`;

export const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
export const MONTH_NAMES = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

// ─── LLM 供应商 → 显示名 ─────────────────────────────────────────────────────
export const PROVIDER_LABELS: Record<string, string> = {
  deepseek: 'DeepSeek', kimi: 'Kimi', gemini: 'Gemini', glm: 'GLM',
  grok: 'Grok', openai: 'OpenAI', claude: 'Claude', ollama: 'Ollama', custom: '自定义',
};

// ─── SSE 流解析 ──────────────────────────────────────────────────────────────
// 把原来 hybrid / full 两处重复的 reader.read + buffer + JSON 解析逻辑合并。
// onChunk 抛错会中断；服务端下发 {done:true} 即结束本次消费。
export interface SSEChunk {
  delta?: string;
  done?: boolean;
  error?: string;
  rag_meta?: { hits: number; retrieved: number };
}

export async function consumeSSEStream(
  resp: Response,
  onChunk: (chunk: SSEChunk) => void,
): Promise<void> {
  if (!resp.body) throw new Error('response body is empty');
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let terminated = false;
  while (!terminated) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const chunk = JSON.parse(line.slice(6)) as SSEChunk;
        onChunk(chunk);
        if (chunk.done) { terminated = true; break; }
      } catch (e) {
        if (!(e instanceof SyntaxError)) throw e;
      }
    }
  }
}

// ─── 右侧面板宽度 ─────────────────────────────────────────────────────────────
export const PANEL_MIN_WIDTH = 240;
export const PANEL_MAX_WIDTH = 600;
export const PANEL_DEFAULT_WIDTH = 360;
// 手机视口 < 640px 时：panel 占满屏幕（用 window.innerWidth 动态取，避免硬编码）
export const isNarrowViewport = () => window.innerWidth < 640;

// ─── 视图切换 ────────────────────────────────────────────────────────────────
// 四种视图：季度（默认）/ 单月 / 年度贡献图 / 认识时间线
export type CalendarViewType = 'quarter' | 'month' | 'year' | 'timeline';
export const CALENDAR_VIEW_KEY = 'welink_calendar_view';

export function loadCalendarView(): CalendarViewType {
  try {
    const v = localStorage.getItem(CALENDAR_VIEW_KEY);
    if (v === 'quarter' || v === 'month' || v === 'year' || v === 'timeline') return v;
  } catch { /* ignore */ }
  return 'quarter';
}

export function saveCalendarView(v: CalendarViewType) {
  try { localStorage.setItem(CALENDAR_VIEW_KEY, v); } catch { /* ignore */ }
}

export interface CalendarViewRange {
  label: string;      // 展示文案，例如 "2025年 1月 — 3月"
  from: string;       // yyyy-mm-dd
  to: string;         // yyyy-mm-dd
}

// 所有视图共用的 props：数据 + 选中态 + 点击回调 + 范围上报
export interface CalendarViewProps {
  heatmap: Record<string, number>;
  selectedDate: string | null;
  onDayClick: (date: string) => void;
  onRangeChange?: (range: CalendarViewRange) => void;
}
