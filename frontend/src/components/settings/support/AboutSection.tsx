import React, { useState } from 'react';
import { FileText, Loader2, RotateCcw, Database } from 'lucide-react';
import { formatVersion } from '../constants';
import { appApi } from '../../../services/appApi';
import { useToast } from '../../common/Toast';

export const AboutSection: React.FC<{
  isAppMode: boolean;
  appVersion?: string;
}> = ({ isAppMode, appVersion }) => {
  const toast = useToast();
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{
    has_update: boolean; latest: string; changelog: string; url: string;
    assets: { name: string; size: number; url: string }[];
    error?: string;
  } | null>(null);
  const [bundling, setBundling] = useState(false);
  const [bundlePath, setBundlePath] = useState<string | null>(null);

  return (
    <section className="mb-8 bg-white rounded-3xl border border-gray-100 p-6 sm:p-8 dk-card dk-border" data-section-id="about" data-settings-tags="版本 关于 about version 日志 log 更新 update">
      <h2 className="text-lg font-black text-[#1d1d1f] dk-text mb-4 flex items-center gap-2">
        <FileText size={18} className="text-gray-400" />
        关于 WeLink
      </h2>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            当前版本：<span className="font-mono font-bold text-[#1d1d1f] dk-text">{formatVersion(appVersion)}</span>
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            <a href="https://github.com/runzhliu/welink/releases" target="_blank" rel="noreferrer" className="hover:text-[#07c160] underline">更新日志</a>
            {' · '}
            <a href="https://welink.click" target="_blank" rel="noreferrer" className="hover:text-[#07c160] underline">官方文档</a>
            {' · '}
            <a href="https://github.com/runzhliu/WeLink" target="_blank" rel="noreferrer" className="hover:text-[#07c160] underline">GitHub</a>
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {/* 检查更新 */}
          <button
            onClick={async () => {
              setCheckingUpdate(true);
              setUpdateInfo(null);
              try {
                const resp = await fetch('/api/app/check-update');
                const data = await resp.json();
                setUpdateInfo(data);
              } catch {
                setUpdateInfo({ has_update: false, latest: '', changelog: '', url: '', assets: [], error: '网络请求失败' });
              } finally {
                setCheckingUpdate(false);
              }
            }}
            disabled={checkingUpdate}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#07c160] hover:bg-[#06ad56] text-white text-sm font-semibold disabled:opacity-50 transition-colors"
          >
            {checkingUpdate ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            检查更新
          </button>
        </div>
      </div>

      {/* 更新检测结果 */}
      {updateInfo && (
        <div className="mt-4">
          {updateInfo.error ? (
            <p className="text-xs text-red-500">{updateInfo.error}</p>
          ) : updateInfo.has_update ? (
            <div className="bg-[#e7f8f0] dark:bg-[#07c160]/10 border border-[#07c160]/20 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-[#07c160]">发现新版本 {updateInfo.latest}</span>
                <span className="text-[10px] text-gray-400">当前 {formatVersion(appVersion)}</span>
              </div>
              {updateInfo.changelog && (
                <pre className="text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap max-h-32 overflow-y-auto bg-white/50 dark:bg-black/10 rounded-lg p-3">{updateInfo.changelog}</pre>
              )}
              {updateInfo.assets.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-bold text-gray-500">下载安装包：</p>
                  {updateInfo.assets.map(a => (
                    <div key={a.name} className="flex items-center gap-2 text-xs">
                      <span className="text-gray-600 dark:text-gray-300 font-mono truncate flex-1">{a.name}</span>
                      <span className="text-gray-400 flex-shrink-0">{(a.size / 1024 / 1024).toFixed(1)} MB</span>
                      <a href={a.url} target="_blank" rel="noreferrer"
                        className="px-2 py-0.5 rounded-lg bg-[#07c160] text-white font-bold hover:bg-[#06ad56] transition-colors flex-shrink-0">
                        GitHub 下载
                      </a>
                    </div>
                  ))}
                </div>
              )}
              <a href={updateInfo.url} target="_blank" rel="noreferrer"
                className="inline-block text-xs text-[#07c160] font-bold hover:underline">
                在 GitHub 上查看完整发布说明 →
              </a>
            </div>
          ) : (
            <p className="text-xs text-[#07c160] font-semibold">✓ 当前已是最新版本</p>
          )}
        </div>
      )}

      {/* 日志打包 */}
      <div className="flex flex-wrap items-center justify-between gap-4 mt-4 pt-4 border-t border-gray-100 dark:border-white/10">
        <p className="text-xs text-gray-400">遇到问题？打包日志发送给开发者</p>
        {isAppMode && (
          <div className="flex flex-col items-end gap-1.5">
            <button
              onClick={async () => {
                setBundling(true);
                setBundlePath(null);
                try {
                  const r = await appApi.bundleLogs();
                  if (r.error) throw new Error(r.error);
                  setBundlePath(r.path);
                } catch (e: unknown) {
                  const anyE = e as { message?: string };
                  toast.error('打包失败：' + (anyE?.message || '未知错误'));
                } finally {
                  setBundling(false);
                }
              }}
              disabled={bundling}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/15 text-gray-600 dark:text-gray-300 text-sm font-semibold disabled:opacity-50 transition-colors"
            >
              {bundling ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
              一键打包日志
            </button>
            <p className="text-[10px] text-gray-400 max-w-xs text-right">API Key 等敏感信息会自动脱敏，可放心分享</p>
            {bundlePath && (
              <p className="text-xs text-[#07c160] font-mono break-all max-w-xs text-right">
                ✓ 已保存至：{bundlePath}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
