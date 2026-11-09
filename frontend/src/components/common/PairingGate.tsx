import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { setRuntimeConfig } from '../../runtimeConfig';

// A browser on a Docker network is not the backend's loopback client. When
// pairing is enabled, authenticate it explicitly instead of trusting Origin.
export function PairingGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<'checking' | 'required' | 'ready'>('checking');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/app/info').then(response => {
      if (!cancelled) setStatus(response.status === 401 ? 'required' : 'ready');
    }).catch(() => { if (!cancelled) setStatus('ready'); });
    return () => { cancelled = true; };
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token.trim()) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/app/pairing/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      });
      if (!response.ok) { setError('配对令牌无效，请检查后重试。'); return; }
      setRuntimeConfig({ token: token.trim() });
      setToken('');
      setStatus('ready');
    } catch { setError('无法连接 WeLink，请检查服务是否运行。'); }
    finally { setBusy(false); }
  };

  if (status === 'checking') return <div className="min-h-screen bg-[#f5f6f7]" aria-label="正在连接 WeLink" />;
  if (status === 'ready') return <>{children}</>;
  return (
    <main className="min-h-screen bg-[#f5f6f7] flex items-center justify-center px-5">
      <form onSubmit={submit} className="w-full max-w-md bg-white border border-gray-200 rounded-xl p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-gray-900">连接 WeLink</h1>
        <p className="mt-3 text-sm leading-6 text-gray-600">此服务已启用配对。请输入已有的配对令牌，验证后本浏览器才能访问聊天数据。</p>
        <details className="mt-3 text-sm text-gray-600">
          <summary className="cursor-pointer">Docker 用户如何查看令牌？</summary>
          <p className="mt-2 leading-6">在运行 WeLink 的电脑、Compose 项目目录中执行以下命令，将输出的 token 填入下方。令牌可访问聊天数据，请勿分享。</p>
          <code className="mt-2 block overflow-x-auto rounded bg-gray-100 p-2 text-xs">docker compose exec backend wget -qO- http://127.0.0.1:8080/api/app/pairing/status</code>
        </details>
        <label htmlFor="pairing-token" className="mt-6 block text-sm font-medium text-gray-700">配对令牌</label>
        <input id="pairing-token" type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2" />
        {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={busy || !token.trim()} className="mt-5 w-full rounded-md bg-emerald-700 px-4 py-2 text-white disabled:opacity-50">{busy ? '正在验证…' : '验证并继续'}</button>
      </form>
    </main>
  );
}
