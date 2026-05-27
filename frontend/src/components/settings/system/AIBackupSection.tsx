import React, { useState, useRef } from 'react';
import { Bot, Database, FolderOpen, Loader2 } from 'lucide-react';
import axios from 'axios';
import { appApi } from '../../../services/appApi';

export const AIBackupSection: React.FC<{
  isAppMode: boolean;
}> = ({ isAppMode }) => {
  const [aiBackuping, setAiBackuping] = useState(false);
  const [aiBackupResult, setAiBackupResult] = useState<{ ok: boolean; text: string; path?: string } | null>(null);
  const aiRestoreInputRef = useRef<HTMLInputElement | null>(null);

  const handleAIBackup = async () => {
    setAiBackuping(true);
    setAiBackupResult(null);
    try {
      const r = await appApi.aiBackup();
      if (r.error) {
        setAiBackupResult({ ok: false, text: r.error });
      } else {
        setAiBackupResult({ ok: true, text: `已备份到 ${r.path}（${((r.size || 0) / 1024 / 1024).toFixed(2)} MB）`, path: r.path });
      }
    } catch (e: unknown) {
      const anyE = e as { response?: { data?: { error?: string } }; message?: string };
      setAiBackupResult({ ok: false, text: anyE?.response?.data?.error || anyE?.message || '备份失败' });
    } finally {
      setAiBackuping(false);
    }
  };

  const handleAIRestore = async (file: File) => {
    if (!confirm(`即将用 "${file.name}" 覆盖当前 AI 数据，原文件会自动备份为 .bak。确定继续？`)) return;
    setAiBackuping(true);
    setAiBackupResult(null);
    try {
      const r = await appApi.aiRestore(file);
      if (r.error) {
        setAiBackupResult({ ok: false, text: r.error });
      } else {
        setAiBackupResult({ ok: true, text: '恢复成功，原文件已备份为 .bak。' });
      }
    } catch (e: unknown) {
      const anyE = e as { response?: { data?: { error?: string } }; message?: string };
      setAiBackupResult({ ok: false, text: anyE?.response?.data?.error || anyE?.message || '恢复失败' });
    } finally {
      setAiBackuping(false);
    }
  };

  return (
    <section className="mb-8" data-section-id="backup" data-settings-tags="AI 备份 恢复 backup restore skills 记忆 memories 对话历史 ai_analysis">
      <div className="flex items-center gap-2 mb-3">
        <Bot size={18} className="text-[#07c160]" />
        <h3 className="text-base font-bold text-[#1d1d1f] dk-text">AI 数据备份</h3>
      </div>
      <p className="text-sm text-gray-400 mb-4">Skills、聊天历史、记忆都在 ai_analysis.db；建议定期导出</p>
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 dk-card dk-border">
        <div className="flex flex-wrap gap-2 items-center">
          <button
            onClick={() => {
              if (isAppMode) {
                handleAIBackup();
              } else {
                // Docker / 浏览器：直接触发流式下载
                window.location.href = '/api/ai-backup-download';
              }
            }}
            disabled={aiBackuping}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#07c160] text-white text-sm font-semibold hover:bg-[#06ad56] disabled:opacity-50 transition-colors"
          >
            {aiBackuping ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
            {isAppMode ? '导出备份到下载目录' : '下载备份'}
          </button>
          <button
            onClick={() => aiRestoreInputRef.current?.click()}
            disabled={aiBackuping}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 text-sm font-semibold hover:bg-gray-200 dark:hover:bg-white/15 disabled:opacity-50 transition-colors"
          >
            <FolderOpen size={14} />
            从备份恢复
          </button>
          <input
            ref={aiRestoreInputRef}
            type="file"
            accept=".db,.sqlite"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleAIRestore(f);
              e.target.value = '';
            }}
          />
          <span className="text-[10px] text-gray-400 ml-auto">
            {isAppMode ? '导出会写到设置里的下载目录' : '浏览器会触发文件下载'}
          </span>
        </div>
        {aiBackupResult && (
          <p className={`mt-3 text-xs break-all ${aiBackupResult.ok ? 'text-[#07c160]' : 'text-red-500'}`}>
            {aiBackupResult.text}
            {aiBackupResult.path && isAppMode && (
              <button
                type="button"
                onClick={async () => { await axios.post('/api/app/reveal', { path: aiBackupResult.path }); }}
                className="ml-2 underline hover:no-underline"
              >
                在 Finder 中显示
              </button>
            )}
          </p>
        )}
      </div>
    </section>
  );
};
