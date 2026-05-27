import React, { useState, useEffect, useCallback } from 'react';
import { Database, FileText, FolderOpen, Loader2, AlertCircle, RotateCcw } from 'lucide-react';
import axios from 'axios';
import { appApi } from '../../../services/appApi';

export const AppConfigSection: React.FC<{
  /** App 重启提交后回调；父组件应切到"正在重启"全屏 UI */
  onRestartStart: () => void;
}> = ({ onRestartStart }) => {
  const [dataDir, setDataDir] = useState('');
  const [logDir, setLogDir] = useState('');
  const [downloadDir, setDownloadDir] = useState('');
  const [downloadDirEffective, setDownloadDirEffective] = useState('');
  const [loadingCfg, setLoadingCfg] = useState(true);
  const [browsing, setBrowsing] = useState<'data' | 'log' | 'download' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    appApi.getConfig().then((cfg) => {
      setDataDir(cfg.data_dir || '');
      setLogDir(cfg.log_dir || '');
    }).catch(() => {}).finally(() => setLoadingCfg(false));
    // 下载目录：单独拉取（configured + effective）
    axios.get<{ configured?: string; effective?: string }>('/api/preferences/download-dir')
      .then(({ data }) => {
        setDownloadDir(data.configured || '');
        setDownloadDirEffective(data.effective || '');
      }).catch(() => {});
  }, []);

  const browse = useCallback(async (type: 'data' | 'log' | 'download') => {
    setBrowsing(type);
    try {
      const prompt = type === 'data' ? '选择解密后的微信数据库目录（decrypted/）'
                   : type === 'log'  ? '选择日志文件存放目录'
                   :                   '选择导出图片/文件的保存目录';
      const path = await appApi.browse(prompt);
      if (type === 'data') setDataDir(path);
      else if (type === 'log') setLogDir(path);
      else setDownloadDir(path);
    } catch {
      // 用户取消，忽略
    } finally {
      setBrowsing(null);
    }
  }, []);

  const handleRestart = async () => {
    setError('');
    setSubmitting(true);
    try {
      // 下载目录不需要重启，先独立保存 + 校验；校验失败直接中止，不要带着坏配置重启
      try {
        await axios.put('/api/preferences/download-dir', { download_dir: downloadDir.trim() });
      } catch (e: unknown) {
        const anyE = e as { response?: { data?: { error?: string } } };
        const detail = anyE?.response?.data?.error || '下载目录无效';
        setError('下载目录保存失败：' + detail);
        setSubmitting(false);
        return;
      }
      await appApi.restart(dataDir.trim(), logDir.trim());
      onRestartStart();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError('保存失败：' + msg);
      setSubmitting(false);
    }
  };

  return (
    <section className="mb-8" data-section-id="app" data-settings-tags="应用配置 数据目录 日志 log 下载 download reveal finder 打包日志 更新 version">
      <div className="flex items-center gap-2 mb-3">
        <Database size={18} className="text-[#07c160]" />
        <h3 className="text-base font-bold text-[#1d1d1f] dk-text">应用配置</h3>
      </div>
      <p className="text-sm text-gray-400 mb-4">修改配置后需要重启应用生效</p>

      {loadingCfg ? (
        <div className="flex items-center justify-center h-32 text-gray-400">
          <Loader2 size={24} className="animate-spin" />
        </div>
      ) : (
        <>
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 mb-4 dk-card dk-border">
            {/* 数据库目录 */}
            <div className="mb-5">
              <label className="block text-sm font-bold text-[#1d1d1f] dk-text mb-2 flex items-center gap-1.5">
                <Database size={14} className="text-[#07c160]" />
                解密数据库目录
                <span className="text-xs text-gray-400 font-normal">（留空则使用演示数据）</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={dataDir}
                  onChange={(e) => setDataDir(e.target.value)}
                  placeholder="留空则使用演示数据"
                  className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#07c160] bg-[#f8f9fb] font-mono dk-input"
                />
                <button
                  onClick={() => browse('data')}
                  disabled={browsing !== null}
                  className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-[#e7f8f0] dark:bg-[#07c160]/10 text-[#07c160] text-sm font-semibold hover:bg-[#d0f0e0] dark:hover:bg-[#07c160]/20 disabled:opacity-50 transition-colors flex-shrink-0"
                >
                  {browsing === 'data' ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
                  浏览
                </button>
              </div>
            </div>

            {/* 日志目录 */}
            <div className="mb-5">
              <label className="block text-sm font-bold text-[#1d1d1f] dk-text mb-2 flex items-center gap-1.5">
                <FileText size={14} className="text-gray-400" />
                日志目录
                <span className="text-xs text-gray-400 font-normal">（可选）</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={logDir}
                  onChange={(e) => setLogDir(e.target.value)}
                  placeholder="留空则不记录日志文件"
                  className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#07c160] bg-[#f8f9fb] font-mono dk-input"
                />
                <button
                  onClick={() => browse('log')}
                  disabled={browsing !== null}
                  className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400 text-sm font-semibold hover:bg-gray-200 dark:hover:bg-white/15 disabled:opacity-50 transition-colors flex-shrink-0"
                >
                  {browsing === 'log' ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
                  浏览
                </button>
              </div>
            </div>

            {/* 下载目录（导出图片/文件保存位置） */}
            <div>
              <label className="block text-sm font-bold text-[#1d1d1f] dk-text mb-2 flex items-center gap-1.5">
                <FolderOpen size={14} className="text-gray-400" />
                导出图片保存位置
                <span className="text-xs text-gray-400 font-normal">（留空使用系统默认）</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={downloadDir}
                  onChange={(e) => setDownloadDir(e.target.value)}
                  placeholder={downloadDirEffective || '~/Downloads'}
                  className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#07c160] bg-[#f8f9fb] font-mono dk-input"
                />
                <button
                  onClick={() => browse('download')}
                  disabled={browsing !== null}
                  className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400 text-sm font-semibold hover:bg-gray-200 dark:hover:bg-white/15 disabled:opacity-50 transition-colors flex-shrink-0"
                >
                  {browsing === 'download' ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
                  浏览
                </button>
              </div>
              {downloadDirEffective && (
                <p className="mt-1.5 text-xs text-gray-400">实际生效：<span className="font-mono">{downloadDirEffective}</span></p>
              )}
            </div>
          </div>

          {error && (
            <div className="mb-4 flex items-start gap-2 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-2xl px-4 py-3">
              <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            </div>
          )}

          <button
            onClick={handleRestart}
            disabled={submitting}
            className="w-full bg-[#07c160] hover:bg-[#06ad56] disabled:opacity-50 text-white font-black text-base py-4 rounded-2xl flex items-center justify-center gap-2 transition-colors shadow-lg shadow-green-200"
          >
            {submitting ? (
              <>
                <Loader2 size={20} className="animate-spin" />
                正在保存并重启…
              </>
            ) : (
              <>
                <RotateCcw size={20} strokeWidth={2.5} />
                保存并重启
              </>
            )}
          </button>
        </>
      )}
    </section>
  );
};
