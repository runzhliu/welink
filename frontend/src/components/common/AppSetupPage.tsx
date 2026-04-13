/**
 * App 模式首次启动配置页
 * 引导用户选择解密数据库目录和日志目录
 */

import { useState } from 'react';
import { FolderOpen, Github, ChevronRight, Loader2, Database, FileText, AlertCircle } from 'lucide-react';
import { appApi } from '../../services/appApi';

interface Props {
  onSetupComplete: () => void;
}

export const AppSetupPage: React.FC<Props> = ({ onSetupComplete }) => {
  const [dataDir, setDataDir] = useState('');
  const [logDir, setLogDir] = useState('');
  const [browsing, setBrowsing] = useState<'data' | 'log' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);

  const browse = async (type: 'data' | 'log') => {
    setBrowsing(type);
    try {
      const prompt = type === 'data' ? '选择解密后的微信数据库目录（decrypted/）' : '选择日志文件存放目录';
      const path = await appApi.browse(prompt);
      if (type === 'data') setDataDir(path);
      else setLogDir(path);
    } catch {
      // 用户取消，忽略
    } finally {
      setBrowsing(null);
    }
  };

  const handleSubmit = async () => {
    setError('');
    setWarnings([]);
    setSubmitting(true);
    try {
      const result = await appApi.setup(dataDir.trim(), logDir.trim());
      if (result.error) {
        setError(result.error);
      } else if (result.warnings && result.warnings.length > 0) {
        // 有警告（如部分库只读）：先展示给用户确认，不直接跳转
        setWarnings(result.warnings);
      } else {
        onSetupComplete();
      }
    } catch (e: unknown) {
      // axios 错误：尝试取出后端返回的具体原因
      const anyE = e as { response?: { data?: { error?: string } }; message?: string };
      const detail = anyE?.response?.data?.error || anyE?.message || String(e);
      setError(detail);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8f9fb] overflow-y-auto flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg">

        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-block w-16 h-16 rounded-2xl mb-4 shadow-lg shadow-green-200 overflow-hidden">
            <img src="/favicon.svg" alt="WeLink" className="w-full h-full" />
          </div>
          <h1 className="text-4xl font-black text-[#1d1d1f] tracking-tight">WeLink</h1>
          <p className="text-gray-400 mt-2 text-sm font-medium">微信聊天记录 AI 助手</p>
        </div>

        {/* 说明卡片 */}
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 mb-4">
          <h2 className="text-base font-black text-[#1d1d1f] mb-4">首次配置</h2>

          <div className="space-y-4 mb-6 text-sm text-gray-500 leading-relaxed">
            <p>
              WeLink 需要读取已解密的微信数据库。使用前请先将手机聊天记录同步到 Mac，
              然后使用解密工具提取数据库：
            </p>
            <div className="flex items-center gap-2 bg-[#f8f9fb] rounded-xl px-3 py-2">
              <a
                href="https://github.com/ylytdeng/wechat-decrypt"
                className="text-xs text-[#07c160] font-medium hover:underline inline-flex items-center gap-1"
                onClick={(e) => { e.preventDefault(); fetch('/api/open-url?url=' + encodeURIComponent('https://github.com/ylytdeng/wechat-decrypt')); }}
              >
                <Github size={13} />
                github.com/ylytdeng/wechat-decrypt
              </a>
            </div>
            <p>解密完成后，目录结构应如下：</p>
            <div className="bg-[#f8f9fb] rounded-xl px-3 py-2">
              <code className="text-xs text-gray-600 font-mono leading-relaxed">
                decrypted/<br />
                ├── contact/contact.db<br />
                └── message/message_*.db
              </code>
            </div>
          </div>

          {/* 数据库目录 */}
          <div className="mb-4">
            <label className="block text-sm font-bold text-[#1d1d1f] mb-2 flex items-center gap-1.5">
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
                className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#07c160] bg-[#f8f9fb] font-mono"
              />
              <button
                onClick={() => browse('data')}
                disabled={browsing !== null}
                className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-[#e7f8f0] text-[#07c160] text-sm font-semibold hover:bg-[#d0f0e0] disabled:opacity-50 transition-colors flex-shrink-0"
              >
                {browsing === 'data' ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
                浏览
              </button>
            </div>
          </div>

          {/* 日志目录（可选） */}
          <div className="mb-2">
            <label className="block text-sm font-bold text-[#1d1d1f] mb-2 flex items-center gap-1.5">
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
                className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#07c160] bg-[#f8f9fb] font-mono"
              />
              <button
                onClick={() => browse('log')}
                disabled={browsing !== null}
                className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-gray-100 text-gray-500 text-sm font-semibold hover:bg-gray-200 disabled:opacity-50 transition-colors flex-shrink-0"
              >
                {browsing === 'log' ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
                浏览
              </button>
            </div>
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mb-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
            <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700 whitespace-pre-line">{error}</p>
          </div>
        )}

        {/* 警告（非致命，如只读盘）：让用户选择继续还是换目录 */}
        {warnings.length > 0 && (
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
            <div className="flex items-start gap-2 mb-3">
              <AlertCircle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800 space-y-1">
                {warnings.map((w, i) => (<p key={i} className="whitespace-pre-line">{w}</p>))}
              </div>
            </div>
            <div className="flex gap-2 ml-6">
              <button
                onClick={onSetupComplete}
                className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600"
              >
                我知道，继续
              </button>
              <button
                onClick={() => { setWarnings([]); setDataDir(''); }}
                className="px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-700 text-xs font-semibold hover:bg-amber-100"
              >
                重新选目录
              </button>
            </div>
          </div>
        )}

        {/* 开始按钮 */}
        <button
          onClick={handleSubmit}
          disabled={submitting || warnings.length > 0}
          className="w-full bg-[#07c160] hover:bg-[#06ad56] disabled:opacity-50 text-white font-black text-base py-4 rounded-2xl flex items-center justify-center gap-2 transition-colors shadow-lg shadow-green-200"
        >
          {submitting ? (
            <>
              <Loader2 size={20} className="animate-spin" />
              正在初始化数据库...
            </>
          ) : (
            <>
              {dataDir.trim() ? '完成配置，开始分析' : '使用演示数据，开始分析'}
              <ChevronRight size={20} strokeWidth={2.5} />
            </>
          )}
        </button>
      </div>
    </div>
  );
};
