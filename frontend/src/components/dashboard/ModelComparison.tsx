import { useEffect, useState } from 'react';
import { Dialog } from '../common/Dialog';
import { SearchContextModal, type SearchContextTarget } from '../search/SearchContextModal';

type Profile = { id: string; provider: string; model?: string; base_url?: string; name?: string };
type Entry = { role: string; content: string };
type Source = { id: string; username: string; display_name: string; is_group: boolean; avatar_url?: string; date: string; time: string; content: string };
type Result = { text: string; error: string; done: boolean; elapsed?: number };

/** The exact same prepared messages are sent to both profiles only after confirmation. */
export function ModelComparison({ profiles, messages, sources, onClose }: { profiles: [Profile, Profile]; messages: Entry[]; sources: Source[]; onClose: () => void }) {
  const [results, setResults] = useState<Result[]>([{ text: '', error: '', done: false }, { text: '', error: '', done: false }]);
  const [target, setTarget] = useState<SearchContextTarget | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const update = (i: number, f: (old: Result) => Result) => setResults(prev => prev.map((v, j) => j === i ? f(v) : v));
    const run = async (profile: Profile, i: number) => {
      const started = Date.now();
      try {
        const response = await fetch('/api/ai/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ messages, profile_id: profile.id === '__default__' ? '' : profile.id, expected_profile: { provider: profile.provider, model: profile.model || '', base_url: profile.base_url || '' } }) });
        if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || `请求失败 (${response.status})`); }
        if (!response.body) throw new Error('无法读取回复');
        const reader = response.body.getReader(), decoder = new TextDecoder();
        let buffer = '', completed = false;
        try {
          while (true) {
            const chunk = await reader.read(); buffer += decoder.decode(chunk.value, { stream: !chunk.done });
            const lines = buffer.split('\n'); buffer = lines.pop() || '';
            for (const line of lines) {
              if (!line.startsWith('data:')) continue;
              const event = JSON.parse(line.slice(5).trim()) as { delta?: string; error?: string; done?: boolean };
              if (event.error) throw new Error(event.error);
              if (event.delta) update(i, old => ({ ...old, text: old.text + event.delta }));
              if (event.done) completed = true;
            }
            if (chunk.done) break;
          }
          if (!completed) throw new Error('响应中断，结果可能不完整');
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        update(i, old => ({ ...old, done: true, elapsed: (Date.now() - started) / 1000 }));
      } catch (e) {
        if (controller.signal.aborted) return;
        update(i, old => ({ ...old, done: true, error: e instanceof Error ? e.message : '请求失败' }));
      }
    };
    void Promise.all(profiles.map(run));
    return () => controller.abort();
  }, [profiles, messages]);
  return <><Dialog open title="模型回答对比" onClose={onClose} className="max-w-5xl"><p className="mb-3 text-xs text-gray-500">两个模型收到相同的聊天材料和问题。关闭窗口会停止尚未完成的请求；对比结果不会保存。</p><div className="grid gap-3 md:grid-cols-2">{profiles.map((profile, i) => { const ids = new Set(Array.from(results[i].text.matchAll(/\[(\d+)\]/g), match => match[1])); const cited = sources.filter(source => ids.has(source.id)); return <section key={profile.id} className="rounded-lg border dk-border p-4 min-w-0"><h3 className="font-semibold text-sm">{profile.name || profile.provider}{profile.model ? ` · ${profile.model}` : ''}</h3><p className="text-xs text-gray-500 mt-1">{results[i].done ? results[i].elapsed != null ? `${results[i].elapsed?.toFixed(1)} 秒` : '请求失败' : '正在生成…'}</p><div className="mt-3 max-h-[55vh] overflow-auto whitespace-pre-wrap break-words text-sm">{results[i].text}</div>{results[i].error && <p role="alert" className="mt-2 text-xs text-red-600">{results[i].error}</p>}{!!cited.length && <details className="mt-3 text-xs"><summary>查看引用（{cited.length}）</summary>{cited.map(source => <button type="button" key={source.id} className="block w-full mt-2 text-left break-all" onClick={() => setTarget({ username: source.username, displayName: source.display_name, isGroup: source.is_group, date: source.date, targetTime: source.time, targetContent: source.content, avatarUrl: source.avatar_url })}>[{source.id}] {source.date} {source.time} · {source.content}</button>)}</details>}</section>; })}</div></Dialog>{target && <SearchContextModal {...target} onClose={() => setTarget(null)} />}</>;
}
