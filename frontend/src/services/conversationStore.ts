import { getServerURL, getToken } from '../runtimeConfig';

// Keep pending saves ordered before a delete so an in-flight autosave cannot
// recreate a conversation that the user just removed.
const pending = new Map<string, Set<Promise<void>>>();
const deleting = new Set<string>();

export function conversationFetch(path: string, init: RequestInit = {}) {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(`${getServerURL().replace(/\/+$/, '')}/api/ai/conversations${path}`, { ...init, headers });
}

export async function saveConversation(key: string, messages: unknown[]) {
  if (deleting.has(key)) return;
  const request = (async () => {
    const response = await conversationFetch('', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, messages }) });
    if (!response.ok) throw new Error('保存对话失败');
  })();
  const requests = pending.get(key) ?? new Set<Promise<void>>();
  requests.add(request); pending.set(key, requests);
  try { await request; } finally { requests.delete(request); if (!requests.size) pending.delete(key); }
}

export async function deleteConversation(key: string) {
  if (deleting.has(key)) throw new Error('正在删除');
  deleting.add(key);
  try {
    await Promise.allSettled([...(pending.get(key) ?? [])]);
    const response = await conversationFetch(`?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(`删除失败 (${response.status})`);
  } finally { deleting.delete(key); }
}
