// Run inside the DSH environment with the same WELINK_* settings as the plugin.
// Only probes a single authorized dates query; never prints credentials or returned dates.
import { createClient } from './client.js';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function jsonArray(value, name) {
  let result;
  try { result = JSON.parse(value || '[]'); } catch { throw new Error(`${name} 不是有效的 JSON 数组`); }
  if (!Array.isArray(result)) throw new Error(`${name} 必须是 JSON 数组`);
  return result;
}

export async function diagnose(env = process.env, fetchImpl = globalThis.fetch) {
  if (!env.WELINK_TOKEN_FILE) throw new Error('未设置 WELINK_TOKEN_FILE；请指定受保护的凭据文件。');
  const conversations = jsonArray(env.WELINK_ALLOWED_CONVERSATIONS, 'WELINK_ALLOWED_CONVERSATIONS');
  if (!conversations.length) throw new Error('插件会话白名单为空，请先选择已授权的会话。');
  const client = createClient({ baseUrl: env.WELINK_URL || 'http://127.0.0.1:8088', allowedConversations: conversations, allowedHttpHosts: jsonArray(env.WELINK_ALLOWED_HTTP_HOSTS, 'WELINK_ALLOWED_HTTP_HOSTS'), maxItems: 1 }, { fetchImpl, tokenFile: env.WELINK_TOKEN_FILE });
  await client.activeDates({ username: conversations[0] });
  return 'DSH 环境到 WeLink 的网络、凭据和首个会话的日期权限测试通过；未读取或输出聊天正文。';
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  diagnose().then(message => console.log(message)).catch(error => {
    const message = error instanceof Error ? error.message : '未知错误';
    console.error(`连接诊断失败：${message}`);
    if (message.includes('HTTP 401')) console.error('请检查凭据是否有效或已过期。');
    else if (message.includes('HTTP 403')) console.error('请检查 WeLink 会话授权和当前数据账号。');
    else if (message.includes('无法连接')) console.error('请检查容器网络、服务地址和端口；容器内 127.0.0.1 指向容器自身。');
    process.exitCode = 1;
  });
}
