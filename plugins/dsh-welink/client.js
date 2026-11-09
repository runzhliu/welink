// WeLink 的受限只读客户端。不保存会话、响应、凭据或聊天记录。
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
const DEFAULTS = {
  baseUrl: 'http://127.0.0.1:8088',
  allowedConversations: [],
  allowedHttpHosts: [],
  allowMessages: false,
  maxItems: 30,
  maxContentChars: 500,
  maxResponseBytes: 2 * 1024 * 1024,
  timeoutMs: 15000,
};

function integer(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return value;
}

export function normalizeConfig(input = {}) {
  const config = { ...DEFAULTS, ...input };
  let url;
  try { url = new URL(config.baseUrl); } catch { throw new Error('baseUrl must be a valid URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('baseUrl must be an HTTP(S) origin without credentials, path, query or fragment');
  }
  if (!Array.isArray(config.allowedHttpHosts) || config.allowedHttpHosts.length > 10 || config.allowedHttpHosts.some(v => typeof v !== 'string' || !/^[a-z0-9.-]+$/.test(v) || v.startsWith('.') || v.endsWith('.'))) {
    throw new Error('allowedHttpHosts must be a list of exact lowercase hostnames or IPv4 addresses');
  }
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !config.allowedHttpHosts.includes(url.hostname)) {
    throw new Error('HTTP is only supported on loopback or explicitly allowed hosts; prefer HTTPS');
  }
  if (!Array.isArray(config.allowedConversations) || config.allowedConversations.length > 100 ||
      config.allowedConversations.some(v => typeof v !== 'string' || !v.trim() || v !== v.trim() || v.length > 128)) {
    throw new Error('allowedConversations must contain at most 100 non-empty conversation IDs');
  }
  if (typeof config.allowMessages !== 'boolean') throw new Error('allowMessages must be a boolean');
  integer(config.maxItems, 'maxItems', 1, 100);
  integer(config.maxContentChars, 'maxContentChars', 20, 2000);
  integer(config.maxResponseBytes, 'maxResponseBytes', 1024, 5 * 1024 * 1024);
  integer(config.timeoutMs, 'timeoutMs', 1000, 60000);
  return { ...config, baseUrl: url.origin, allowedConversations: [...new Set(config.allowedConversations)] };
}

function authorized(config, username) {
  if (typeof username !== 'string' || !config.allowedConversations.includes(username)) throw new Error('会话未获授权，请在 WeLink 插件配置中指定允许的会话');
  return username.endsWith('@chatroom') ? 'group' : 'contact';
}

function requireMessages(config) {
  if (!config.allowMessages) throw new Error('聊天原文访问未启用，请在插件配置中启用 allowMessages');
}

function validDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('date 必须为 YYYY-MM-DD');
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) throw new Error('date 不是有效日期');
  return date;
}

function validOffset(offset = 0) {
  return integer(offset, 'offset', 0, 100000);
}

async function readLimited(response, maxBytes) {
  if (!response.body) throw new Error('WeLink 返回空响应');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('WeLink 响应超过大小限制，请缩小查询范围');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('WeLink 返回的不是有效 JSON'); }
}

function resultItems(rows, config) {
  if (!Array.isArray(rows)) throw new Error('WeLink 返回了无法识别的消息格式');
  const items = rows.slice(0, config.maxItems).map(row => {
    if (!row || typeof row !== 'object') throw new Error('WeLink 返回了无法识别的消息格式');
    const content = typeof row.content === 'string' ? row.content : '';
    const characters = Array.from(content);
    return {
      date: typeof row.date === 'string' ? row.date : '',
      time: typeof row.time === 'string' ? row.time : '',
      speaker: typeof row.speaker === 'string' ? row.speaker : '',
      is_mine: row.is_mine === true,
      type: typeof row.type === 'number' ? row.type : 0,
      content: characters.slice(0, config.maxContentChars).join(''),
      content_truncated: row.content_truncated === true || characters.length > config.maxContentChars,
    };
  });
  return { items, returned: items.length, has_more: rows.length > items.length };
}

export function createClient(input = {}, { fetchImpl = globalThis.fetch, token, tokenFile = process.env.WELINK_TOKEN_FILE } = {}) {
  const config = normalizeConfig(input);
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
  if (tokenFile && !isAbsolute(tokenFile)) throw new Error('WELINK_TOKEN_FILE must be an absolute path');
  const target = new URL(config.baseUrl);
  if (target.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) && !token && !tokenFile) {
    throw new Error('WELINK_TOKEN_FILE is required for an explicitly allowed non-loopback HTTP host');
  }
  async function sendQuery(action, params, signal) {
    const url = new URL('/api/agent/query', config.baseUrl);
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    let credential = token;
    if (tokenFile) {
      try { credential = readFileSync(tokenFile, 'utf8').trim(); } catch { throw new Error('无法读取 WeLink 凭据文件'); }
      if (!credential || credential.length > 4096 || /[\r\n]/.test(credential)) throw new Error('WeLink 凭据文件格式无效');
    }
    if (credential) headers.Authorization = `Bearer ${credential}`;
    const timeout = AbortSignal.timeout(config.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    try {
      response = await fetchImpl(url, { method: 'POST', headers, redirect: 'error', signal: combined,
        body: JSON.stringify({ action, ...params, max_items: config.maxItems, max_chars: config.maxContentChars }) });
    }
    catch { throw new Error('无法连接 WeLink 后端或请求已超时'); }
    if (!response.ok) throw new Error(`WeLink 后端返回 HTTP ${response.status}`);
    return readLimited(response, config.maxResponseBytes);
  }
  return {
    listConversations() {
      return { conversations: config.allowedConversations.map(username => ({ username, kind: username.endsWith('@chatroom') ? 'group' : 'contact' })), messages_enabled: config.allowMessages };
    },
    async activeDates({ username, offset }, signal) {
      authorized(config, username);
      offset = validOffset(offset);
      const data = await sendQuery('dates', { username, offset }, signal);
      if (!Array.isArray(data?.dates) || typeof data.has_more !== 'boolean' || (data.has_more && data.dates.length === 0)) throw new Error('WeLink 返回了无法识别的日期格式');
      const dates = data.dates.filter(date => typeof date === 'string');
      const result = { username, dates: dates.slice(-config.maxItems), has_more: data.has_more === true || dates.length > config.maxItems };
      if (result.has_more) result.next_offset = offset + result.dates.length;
      return result;
    },
    async dayMessages({ username, date, offset }, signal) {
      authorized(config, username);
      requireMessages(config);
      validDate(date);
      offset = validOffset(offset);
      const data = await sendQuery('day', { username, date, offset }, signal);
      if (typeof data?.has_more !== 'boolean' || (data.has_more && !data.items?.length)) throw new Error('WeLink 返回了无法识别的消息格式');
      const result = resultItems(data?.items, config);
      const output = { username, date, ...result, has_more: data?.has_more === true || result.has_more, items: result.items.map(item => ({ ...item, date: item.date || date })) };
      if (output.has_more) output.next_offset = offset + output.returned;
      return output;
    },
    async searchMessages({ username, query, offset }, signal) {
      authorized(config, username);
      requireMessages(config);
      if (typeof query !== 'string' || Array.from(query.trim()).length < 2 || Array.from(query.trim()).length > 100) throw new Error('query 需要 2 至 100 个字符');
      offset = validOffset(offset);
      const data = await sendQuery('search', { username, query: query.trim(), offset }, signal);
      if (typeof data?.has_more !== 'boolean' || (data.has_more && !data.items?.length)) throw new Error('WeLink 返回了无法识别的消息格式');
      const result = resultItems(data?.items, config);
      const output = { username, ...result, has_more: data?.has_more === true || result.has_more };
      if (output.has_more) output.next_offset = offset + output.returned;
      return output;
    },
  };
}
