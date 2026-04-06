/**
 * 前端日志收集器 — 捕获 console.error、未捕获异常和 Promise 拒绝，
 * 批量上报到后端 /api/app/frontend-log，写入 frontend.log。
 * API Key 等敏感信息在发送前自动脱敏。
 */

interface LogEntry {
  level: string;
  message: string;
  time: string;
}

const buffer: LogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_INTERVAL = 5000; // 5 秒批量上报
const MAX_BUFFER = 100;

// 敏感信息脱敏模式
const SENSITIVE_PATTERNS = [
  // API Key 格式：sk-xxx（OpenAI/Anthropic）、gsk_（Groq）等，长度 > 15
  /\b(sk-[a-zA-Z0-9_-]{15,})\b/g,
  /\b(sk-ant-[a-zA-Z0-9_-]{15,})\b/g,
  /\b(gsk_[a-zA-Z0-9_-]{15,})\b/g,
  // JWT token（eyJxxx）
  /\b(eyJ[a-zA-Z0-9._-]{20,})\b/g,
  // Bearer token
  /Bearer\s+([a-zA-Z0-9._-]{15,})/gi,
  // 常见 key 字段值
  /("(?:api_key|apiKey|api-key|token|secret|password|access_token|refresh_token)":\s*")([^"]{8,})(")/gi,
  // 长连续密钥（40+ 字符的纯字母数字串，可能是 API key）
  /\b([a-zA-Z0-9]{40,})\b/g,
];

function redactSensitive(msg: string): string {
  let result = msg;
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, (match, ...groups) => {
      // 保留前 4 个字符 + *** + 后 4 个字符
      const key = groups.find((g: unknown) => typeof g === 'string' && (g as string).length > 10) as string | undefined;
      if (key) {
        const masked = key.slice(0, 4) + '***' + key.slice(-4);
        return match.replace(key, masked);
      }
      return '[REDACTED]';
    });
  }
  return result;
}

function addLog(level: string, message: string) {
  const entry: LogEntry = {
    level,
    message: redactSensitive(message),
    time: new Date().toISOString(),
  };
  buffer.push(entry);
  if (buffer.length >= MAX_BUFFER) {
    flush();
  } else if (!flushTimer) {
    flushTimer = setTimeout(flush, FLUSH_INTERVAL);
  }
}

function flush() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (buffer.length === 0) return;

  const logs = buffer.splice(0, buffer.length);
  // fire-and-forget，不阻塞页面
  fetch('/api/app/frontend-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ logs }),
  }).catch(() => {
    // 上报失败静默忽略
  });
}

/**
 * 初始化前端日志收集。在 main.tsx 中调用一次即可。
 */
export function initFrontendLogger() {
  // 拦截 console.error
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    originalError.apply(console, args);
    const msg = args.map(a => {
      if (a instanceof Error) return `${a.message}\n${a.stack ?? ''}`;
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a); } catch { return String(a); }
    }).join(' ');
    addLog('error', msg);
  };

  // 拦截 console.warn
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    originalWarn.apply(console, args);
    const msg = args.map(a => typeof a === 'string' ? a : String(a)).join(' ');
    addLog('warn', msg);
  };

  // 未捕获的 JS 异常
  window.addEventListener('error', (event) => {
    addLog('error', `[Uncaught] ${event.message} at ${event.filename}:${event.lineno}:${event.colno}`);
  });

  // 未处理的 Promise 拒绝
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason instanceof Error
      ? `${event.reason.message}\n${event.reason.stack ?? ''}`
      : String(event.reason);
    addLog('error', `[UnhandledRejection] ${reason}`);
  });

  // 页面关闭前尝试 flush
  window.addEventListener('beforeunload', () => {
    if (buffer.length > 0) {
      const logs = buffer.splice(0, buffer.length);
      // 使用 sendBeacon 保证页面关闭前发送
      navigator.sendBeacon('/api/app/frontend-log', JSON.stringify({ logs }));
    }
  });
}
