/**
 * 聊天记录导出工具（CSV / TXT）
 *
 * 优先尝试后端保存（App 模式）：POST /api/app/save-file → ~/Downloads → 返回绝对路径
 * 后端返回 404（非 App 模式）或请求失败 → fallback Blob 下载
 */

import type { ChatMessage, GroupChatMessage, GlobalSearchGroup } from '../types';

export const EXPORT_LIMIT = 50000;

function escapeCsv(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return '"' + val.replace(/"/g, '""') + '"';
  }
  return val;
}

/**
 * 先尝试通过后端保存到 ~/Downloads（App 模式）。
 * 后端返回 404（非 App 模式）或网络错误 → fallback Blob 下载。
 * 返回值：
 *   成功时为展示用字符串（App 模式：绝对路径；浏览器模式：固定字符串 "browser"）
 *   失败时为包含错误的字符串（以 "error:" 开头）
 */
async function triggerDownload(content: string, filename: string, mime: string): Promise<string> {
  // ── 尝试后端保存 ──────────────────────────────────────────────
  try {
    const res = await fetch('/api/app/save-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, content }),
    });
    if (res.ok) {
      const data = await res.json();
      return (data.path as string) || 'browser';
    }
    if (res.status !== 404) {
      const data = await res.json().catch(() => ({}));
      return 'error:' + ((data as { error?: string }).error ?? res.statusText);
    }
    // 404 = 非 App 模式，fallback to Blob
  } catch {
    // 网络异常，fallback to Blob
  }

  // ── Blob 下载（浏览器 / Docker）────────────────────────────────
  const blob = new Blob(['\uFEFF' + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return 'browser';
}

/** 将 triggerDownload 返回值转为用户可见的消息。null 表示错误。 */
export function parseExportResult(result: string): { ok: boolean; message: string } {
  if (result.startsWith('error:')) return { ok: false, message: result.slice(6) };
  if (result === 'browser') return { ok: true, message: '文件已开始下载' };
  // App 模式绝对路径：只显示文件名，路径太长
  const filename = result.split('/').pop() ?? result;
  return { ok: true, message: `已保存到 Downloads/${filename}` };
}

/** 根据 from/to 日期字符串生成文件名日期后缀，例如 "_2026-03-17至2026-03-24" 或 "_全部" */
function dateSuffix(from?: string, to?: string): string {
  if (from && to) return `_${from}至${to}`;
  if (from) return `_${from}起`;
  if (to) return `_至${to}`;
  return '_全部';
}

// ─── 私聊导出 ─────────────────────────────────────────────────────────────────

export async function exportContactCsv(msgs: ChatMessage[], name: string, from?: string, to?: string): Promise<string> {
  const header = '日期,时间,发送方,内容,类型\n';
  const rows = msgs.map(m =>
    [m.date ?? '', m.time, m.is_mine ? '我' : name, escapeCsv(m.content), m.type === 1 ? '文本' : '其他'].join(',')
  ).join('\n');
  return triggerDownload(header + rows, `${name}_聊天记录${dateSuffix(from, to)}.csv`, 'text/csv;charset=utf-8');
}

export async function exportContactTxt(msgs: ChatMessage[], name: string, from?: string, to?: string): Promise<string> {
  const lines = msgs.map(m => {
    const sender = m.is_mine ? '我' : name;
    return `${m.date ?? ''} ${m.time} [${sender}]: ${m.content}`;
  }).join('\n');
  return triggerDownload(lines, `${name}_聊天记录${dateSuffix(from, to)}.txt`, 'text/plain;charset=utf-8');
}

// ─── 群聊导出 ─────────────────────────────────────────────────────────────────

export async function exportGroupCsv(msgs: GroupChatMessage[], name: string, from?: string, to?: string): Promise<string> {
  const header = '日期,时间,发言者,内容,类型\n';
  const rows = msgs.map(m =>
    [m.date ?? '', m.time, escapeCsv(m.speaker), escapeCsv(m.content), m.type === 1 ? '文本' : '其他'].join(',')
  ).join('\n');
  return triggerDownload(header + rows, `${name}_群聊记录${dateSuffix(from, to)}.csv`, 'text/csv;charset=utf-8');
}

export async function exportGroupTxt(msgs: GroupChatMessage[], name: string, from?: string, to?: string): Promise<string> {
  const lines = msgs.map(m =>
    `${m.date ?? ''} ${m.time} [${m.speaker}]: ${m.content}`
  ).join('\n');
  return triggerDownload(lines, `${name}_群聊记录${dateSuffix(from, to)}.txt`, 'text/plain;charset=utf-8');
}

// ─── 全局搜索结果导出 ──────────────────────────────────────────────────────────

export async function exportSearchResultsCsv(results: GlobalSearchGroup[], query: string): Promise<string> {
  const header = '联系人/群聊,发送方,日期,时间,内容\n';
  const rows = results.flatMap(g =>
    g.messages.map(m =>
      [escapeCsv(g.display_name), m.is_mine ? '我' : escapeCsv(g.display_name), m.date ?? '', m.time, escapeCsv(m.content)].join(',')
    )
  ).join('\n');
  return triggerDownload(header + rows, `搜索结果_${query}.csv`, 'text/csv;charset=utf-8');
}

export async function exportSearchResultsTxt(results: GlobalSearchGroup[], query: string): Promise<string> {
  const lines = results.flatMap(g =>
    g.messages.map(m => {
      const sender = m.is_mine ? '我' : g.display_name;
      return `[${g.display_name}] ${m.date ?? ''} ${m.time} [${sender}]: ${m.content}`;
    })
  ).join('\n');
  return triggerDownload(lines, `搜索结果_${query}.txt`, 'text/plain;charset=utf-8');
}

// ─── 单日对话导出（SearchContextModal）─────────────────────────────────────────

export async function exportDayMessagesCsv(
  messages: (ChatMessage | GroupChatMessage)[],
  displayName: string,
  date: string,
  isGroup: boolean,
): Promise<string> {
  const header = isGroup ? '时间,发言者,内容\n' : '时间,发送方,内容\n';
  const rows = messages.map(m => {
    const sender = isGroup
      ? escapeCsv((m as GroupChatMessage).speaker ?? '')
      : (m.is_mine ? '我' : escapeCsv(displayName));
    return [m.time, sender, escapeCsv(m.content)].join(',');
  }).join('\n');
  return triggerDownload(header + rows, `${displayName}_${date}.csv`, 'text/csv;charset=utf-8');
}

export async function exportDayMessagesTxt(
  messages: (ChatMessage | GroupChatMessage)[],
  displayName: string,
  date: string,
  isGroup: boolean,
): Promise<string> {
  const lines = messages.map(m => {
    const sender = isGroup
      ? ((m as GroupChatMessage).speaker ?? '未知')
      : (m.is_mine ? '我' : displayName);
    return `${m.time} [${sender}]: ${m.content}`;
  }).join('\n');
  return triggerDownload(lines, `${displayName}_${date}.txt`, 'text/plain;charset=utf-8');
}
