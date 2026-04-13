/**
 * 数据未配置提示页 — 用于 Docker / 本地开发模式。
 * 桌面 App 模式走 AppSetupPage（可选目录、切 Demo），这里主要面向需要运维介入的部署。
 */

import React, { useEffect, useState } from 'react';
import { appApi, type AppInfo } from '../../services/appApi';

interface Props {
  info: AppInfo;
  onReady: (info: AppInfo) => void;
}

const COMPOSE_SNIPPET = `services:
  backend:
    volumes:
      - ./decrypted:/data/decrypted:ro
    environment:
      - WELINK_DATA_DIR=/data/decrypted`;

export const SetupRequiredPage: React.FC<Props> = ({ info, onReady }) => {
  const [copied, setCopied] = useState(false);
  const [latest, setLatest] = useState<AppInfo>(info);

  // 持续轮询，一旦后端就绪就放行
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const next = await appApi.getInfo();
        setLatest(next);
        if (next.ready) {
          clearInterval(id);
          onReady(next);
        }
      } catch {
        /* 忽略瞬时错误，下一轮再试 */
      }
    }, 3000);
    return () => clearInterval(id);
  }, [onReady]);

  const isLinux = latest.platform === 'linux';
  const title = isLinux ? '等待挂载 decrypted/ 数据目录' : '未找到 WeChat 解密数据';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(COMPOSE_SNIPPET);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 忽略 */
    }
  };

  return (
    <div className="min-h-screen bg-[#f8f9fb] dk-page flex items-center justify-center p-6">
      <div className="max-w-2xl w-full bg-white dk-card rounded-2xl shadow-sm border border-gray-100 dk-border p-8">
        <div className="flex items-start gap-4 mb-6">
          <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
            <svg className="w-6 h-6 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-[#1d1d1f] dk-text mb-1">{title}</h1>
            <p className="text-sm text-gray-500">
              后端已启动，但尚未加载到微信聊天数据库，暂时无法提供数据分析功能。
            </p>
          </div>
        </div>

        {latest.reason && (
          <div className="mb-6">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">错误信息</div>
            <pre className="text-xs bg-gray-50 dk-bg-soft rounded-lg p-3 overflow-x-auto text-gray-700 dk-text-soft">
              {latest.reason}
            </pre>
          </div>
        )}

        {latest.probed_paths && latest.probed_paths.length > 0 && (
          <div className="mb-6">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">已探测的候选路径</div>
            <ul className="text-sm text-gray-700 dk-text-soft space-y-1">
              {latest.probed_paths.map((p) => (
                <li key={p} className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-300" />
                  <code className="font-mono">{p || '(空)'}</code>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mb-6">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">如何修复</div>
          {isLinux ? (
            <div className="space-y-3 text-sm text-gray-700 dk-text-soft">
              <p>
                在 <code className="font-mono text-[#07c160]">docker-compose.yml</code> 中挂载 decrypted 目录，然后重启容器：
              </p>
              <div className="relative">
                <pre className="text-xs bg-gray-900 text-gray-100 rounded-lg p-4 overflow-x-auto">
                  {COMPOSE_SNIPPET}
                </pre>
                <button
                  onClick={copy}
                  className="absolute top-2 right-2 text-xs px-2 py-1 rounded bg-gray-700 text-gray-200 hover:bg-gray-600"
                >
                  {copied ? '已复制' : '复制'}
                </button>
              </div>
              <p className="text-xs text-gray-500">
                或直接使用演示数据：<code className="font-mono">docker compose -f docker-compose.demo.yml up</code>
              </p>
            </div>
          ) : (
            <div className="space-y-2 text-sm text-gray-700 dk-text-soft">
              <p>任选其一：</p>
              <ul className="list-disc list-inside space-y-1">
                <li>把 <code className="font-mono">decrypted/</code> 放到仓库根目录（与后端工作目录同级）</li>
                <li>设置环境变量 <code className="font-mono text-[#07c160]">WELINK_DATA_DIR=/path/to/decrypted</code></li>
                <li>临时体验：<code className="font-mono">DEMO_MODE=true</code> 启动</li>
              </ul>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 pt-4 border-t border-gray-100 dk-border">
          <span className="flex items-center gap-2 text-xs text-gray-400">
            <span className="w-2 h-2 rounded-full bg-[#07c160] animate-pulse" />
            每 3 秒自动重新检测
          </span>
          <button
            onClick={() => window.location.reload()}
            className="ml-auto text-xs text-[#07c160] hover:underline font-semibold"
          >
            立即刷新
          </button>
        </div>
      </div>
    </div>
  );
};
