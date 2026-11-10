import axios from 'axios';
import { getServerURL, getToken } from '../runtimeConfig';

export interface SFTMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface SFTProject { id: string; name: string; created_at: number }
export interface SFTReport { raw: number; candidates: number; excluded: Record<string, number>; kept: number; unreviewed: number; splits: Record<string, number>; contributions: Record<string, number> }
export interface SFTDataset { id: string; project_id: string; name: string; state: string; revision: number; report: SFTReport; sha256: string; created_at: number; pipeline: string }
export interface SFTSample { id: string; messages: SFTMessage[]; issues: string[]; review: string; contact: string; timestamp: number; split: string }
export interface SFTConfig { dataset_id: string; worker_id: string; engine: string; model: string; revision: string; template: string; preset: string; max_steps: number; max_seconds: number; sequence_length: number; learning_rate: number; rank: number; gradient_accumulation: number; seed: number; gpu: string; parent_run?: string; resume_mode?: string }
export interface SFTJob { id: string; project_id: string; kind: string; state: string; worker_id: string; attempt: string; config: SFTConfig; result?: Record<string, any>; error?: string; cancel: boolean; last_seq: number; created_at: number; updated_at: number }
export interface SFTWorker { id: string; name: string; project_id: string; last_seen: number; revoked: boolean; capabilities: { os: string; arch: string; free_disk_bytes: number; versions: Record<string, string>; devices: { id: string; name: string; free_bytes?: number }[]; engines: Record<string, { available: boolean; reason: string; resume: string }> } }
export interface SFTArtifact { id: string; name: string; kind: string; size: number; sha256: string; resume: string; job_id: string }
export interface SFTModel { id: string; config: SFTConfig; result: Record<string, any>; artifacts: SFTArtifact[]; created_at: number }
export interface SFTDeployment { id: string; run_id: string; worker_id: string; state: string; profile_id: string; previous_profile: string }
export interface SFTEvent { seq: number; type: string; data: Record<string, any>; created_at: number }
export interface SFTCase { id: string; messages: SFTMessage[]; a: string; b: string; voted: boolean; a_name?: string; b_name?: string; reference?: string; errors: string[]; leakage: string[]; vote?: { choice: string } }
export interface SFTEvaluation { job: SFTJob; cases: SFTCase[]; summary?: Record<string, any>; sample_count: number }

let session = '';
let owner = '';
const pendingKeys = new Map<string, string>();
const base = () => `${getServerURL().replace(/\/+$/, '')}/api/sft`;
const headers = () => ({ ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}), 'X-SFT-Session': session, ...(owner ? { 'X-SFT-Owner': owner } : {}) });
// Shared short-lived PIN session for sensitive Agent authorization settings.
export const sensitiveSessionHeaders = () => ({ ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}), 'X-SFT-Session': session });
export class SFTError extends Error { constructor(message: string, public status = 0) { super(message); } }

async function request<T>(method: string, path: string, data?: unknown): Promise<T> {
  const key = `${base()}|${method}|${path}|${JSON.stringify(data)}`;
  const mutation = !['GET', 'HEAD'].includes(method);
  if (mutation && !pendingKeys.has(key)) { const bytes = crypto.getRandomValues(new Uint8Array(16)); pendingKeys.set(key, Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('')); }
  try {
    const response = await axios({ method, url: base() + path, data, headers: { ...headers(), ...(mutation ? { 'Idempotency-Key': pendingKeys.get(key) } : {}) }, timeout: 30000 });
    pendingKeys.delete(key);
    return response.data as T;
  } catch (error) {
    if (axios.isAxiosError(error)) { if (error.response && error.response.status < 500) pendingKeys.delete(key); throw new SFTError(error.response?.data?.error || (error.code === 'ECONNABORTED' ? '请求超时，重试会沿用同一个任务标识' : '无法连接 SFT 服务'), error.response?.status); }
    throw error;
  }
}
export const sftApi = {
  unlock: async (pin: string) => { const result = await request<{ session: string }>('POST', '/unlock', { pin }); session = result.session; },
  capabilities: async () => { const value = await request<{ owner: string; protocol: number }>('GET', '/capabilities'); owner = value.owner; return value; },
  projects: () => request<SFTProject[]>('GET', '/projects'),
  createProject: (name: string) => request<SFTProject>('POST', '/projects', { name }),
  datasets: (project: string) => request<SFTDataset[]>('GET', `/datasets?project_id=${project}`),
  createDataset: (project: string, body: unknown) => request<{ job: SFTJob; dataset: SFTDataset }>('POST', `/projects/${project}/datasets`, body),
  samples: (id: string, offset: number, review = '', issues = false) => request<{ samples: SFTSample[]; total: number; revision: number }>('GET', `/datasets/${id}/samples?offset=${offset}&review=${review}&issues=${issues}`),
  review: (id: string, body: unknown) => request<SFTDataset>('PATCH', `/datasets/${id}/reviews`, body),
  freeze: (dataset: SFTDataset) => request<SFTDataset>('POST', `/datasets/${dataset.id}/freeze`, { revision: dataset.revision }),
  fork: (id: string) => request<SFTDataset>('POST', `/datasets/${id}/fork`, {}),
  cleanupPreview: (project: string) => request<{ items: { id: string; job_id: string; name: string; size: number; reason: string }[]; bytes: number; hash: string }>('POST', `/projects/${project}/cleanup-preview`, {}),
  cleanup: (project: string, hash: string) => request('POST', `/projects/${project}/cleanup`, { hash }),
  workers: () => request<SFTWorker[]>('GET', '/workers'),
  pairing: (project: string) => request<{ code: string; expires_at: number }>('POST', '/workers/pairings', { project_id: project }),
  revoke: (id: string) => request('DELETE', `/workers/${id}/binding`),
  jobs: (project: string) => request<SFTJob[]>('GET', `/runs?project_id=${project}`),
  events: (id: string, after = 0) => request<SFTEvent[]>('GET', `/jobs/${id}/events?after=${after}`),
  preflight: (config: SFTConfig) => request<SFTJob>('POST', '/preflights', config),
  train: (preflight: string) => request<SFTJob>('POST', '/runs', { preflight_id: preflight }),
  cancel: (id: string) => request<SFTJob>('POST', `/jobs/${id}/cancel`, {}),
  checkpoints: (id: string) => request<SFTArtifact[]>('GET', `/runs/${id}/checkpoints`),
  resume: (id: string, artifact: SFTArtifact) => request<SFTJob>('POST', `/runs/${id}/resume`, { mode: artifact.resume, artifact_id: artifact.id }),
  evaluate: (run: string) => request<SFTJob>('POST', '/evaluations', { run_id: run }),
  evaluation: (id: string) => request<SFTEvaluation>('GET', `/evaluations/${id}`),
  vote: (id: string, sample: string, choice: string, dimension: string) => request('POST', `/evaluations/${id}/votes`, { sample_id: sample, choice, dimension }),
  models: (project: string) => request<{ models: SFTModel[]; deployments: SFTDeployment[] }>('GET', `/models?project_id=${project}`),
  deploy: (id: string) => request<SFTDeployment>('POST', `/models/${id}/deployments`, {}),
  connect: (id: string) => request<SFTDeployment>('POST', `/deployments/${id}/connect`, {}),
  default: (id: string) => request<SFTDeployment>('POST', `/deployments/${id}/default`, {}),
  rollback: (id: string) => request<SFTDeployment>('POST', `/deployments/${id}/rollback`, {}),
  stop: (id: string) => request<SFTDeployment>('POST', `/deployments/${id}/stop`, {}),
  chat: (id: string, messages: SFTMessage[]) => request<{ choices: { message: SFTMessage }[] }>('POST', `/deployments/${id}/chat`, { messages, max_tokens: 512, temperature: 0, stream: false }),
  streamChat: async (id: string, messages: SFTMessage[], onDelta: (text: string) => void, signal?: AbortSignal) => {
    const response = await fetch(base() + `/deployments/${id}/chat`, { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ messages, max_tokens: 512, temperature: 0, stream: true }), signal });
    if (!response.ok) { const body = await response.json().catch(() => ({})); throw new SFTError(body.error || '试聊服务不可用', response.status); }
    if (!response.body) throw new SFTError('当前客户端无法读取流式回复');
    const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '', completed = false;
    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split('\n'); buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') { completed = true; return; }
          const item = JSON.parse(data);
          if (item.error) throw new SFTError(typeof item.error === 'string' ? item.error : '模型推理失败');
          const text = item.choices?.[0]?.delta?.content; if (text) onDelta(text);
        }
        if (done) break;
      }
      if (!completed) throw new SFTError('推理连接中断，未收到完成回执');
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  },
  download: async (path: string, filename: string) => {
    try { const response = await axios.get(base() + path, { headers: headers(), responseType: 'blob', timeout: 120000 }); const url = URL.createObjectURL(response.data); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch { throw new SFTError('下载失败，请确认数据账号、PIN 和网络状态后重试'); }
  },
};
