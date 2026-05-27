import React, { useState, useRef } from 'react';
import { Settings, Download, Upload, Trash2, Loader2 } from 'lucide-react';
import { appApi } from '../../../services/appApi';

export const PreferencesSection: React.FC = () => {
  const [prefBusy, setPrefBusy] = useState(false);
  const [prefResult, setPrefResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [hardReset, setHardReset] = useState(false);
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const prefImportInputRef = useRef<HTMLInputElement | null>(null);

  const handleReset = async () => {
    const msg = hardReset
      ? '硬重置：将清空所有设置 + 删除 AI 分析库（含 Skills / 聊天记忆 / 对话历史）。原文件会备份为 .bak。确定继续？'
      : '软重置：将清空所有设置（LLM / 导出渠道 / 黑名单 / 纪念日等）。AI 分析库保留。原 preferences.json 会备份为 .bak。确定继续？';
    if (!confirm(msg)) return;
    setPrefBusy(true);
    setPrefResult(null);
    try {
      const r = await appApi.resetPreferences(hardReset);
      if (r.error) {
        setPrefResult({ ok: false, text: r.error });
      } else {
        setPrefResult({ ok: true, text: `重置完成（${hardReset ? '硬' : '软'}），备份 ${r.backups?.length || 0} 个文件。页面即将刷新。` });
        setTimeout(() => window.location.reload(), 1500);
      }
    } catch (e: unknown) {
      const anyE = e as { response?: { data?: { error?: string } }; message?: string };
      setPrefResult({ ok: false, text: anyE?.response?.data?.error || anyE?.message || '重置失败' });
    } finally {
      setPrefBusy(false);
    }
  };

  const handleExport = () => {
    if (includeSecrets) {
      if (!confirm('导出文件将包含 API Key / OAuth Token / 密码等明文凭证。请妥善保管，切勿发给他人。确定继续？')) return;
    }
    window.location.href = `/api/preferences/export?include_secrets=${includeSecrets ? 1 : 0}`;
  };

  const handleImport = async (file: File) => {
    if (!confirm(`即将用 "${file.name}" 覆盖当前设置（机器相关路径如数据目录会保留），原配置会备份为 .bak。确定继续？`)) return;
    setPrefBusy(true);
    setPrefResult(null);
    try {
      const r = await appApi.importPreferences(file);
      if (r.error) {
        setPrefResult({ ok: false, text: r.error });
      } else {
        const tip = r.needs_data_dir ? '当前未配置数据目录，请在页面刷新后重新选择。' : '';
        setPrefResult({ ok: true, text: `导入成功。${tip} 页面即将刷新。` });
        setTimeout(() => window.location.reload(), 1800);
      }
    } catch (e: unknown) {
      const anyE = e as { response?: { data?: { error?: string } }; message?: string };
      setPrefResult({ ok: false, text: anyE?.response?.data?.error || anyE?.message || '导入失败' });
    } finally {
      setPrefBusy(false);
    }
  };

  return (
    <section className="mb-8" data-section-id="preferences" data-settings-tags="重置 reset 导出 export 导入 import 配置 preferences 迁移">
      <div className="flex items-center gap-2 mb-3">
        <Settings size={18} className="text-[#07c160]" />
        <h3 className="text-base font-bold text-[#1d1d1f] dk-text">配置管理</h3>
      </div>
      <p className="text-sm text-gray-400 mb-4">导出当前所有设置为 JSON 以便换机器迁移；或者一键重置回首次启动状态</p>
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 dk-card dk-border space-y-5">

        {/* 导出 / 导入 */}
        <div>
          <div className="text-sm font-semibold text-[#1d1d1f] dk-text mb-2">导出 / 导入</div>
          <div className="flex flex-wrap gap-2 items-center mb-2">
            <button
              onClick={handleExport}
              disabled={prefBusy}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#07c160] text-white text-sm font-semibold hover:bg-[#06ad56] disabled:opacity-50 transition-colors"
            >
              <Download size={14} />
              导出配置
            </button>
            <button
              onClick={() => prefImportInputRef.current?.click()}
              disabled={prefBusy}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 text-sm font-semibold hover:bg-gray-200 dark:hover:bg-white/15 disabled:opacity-50 transition-colors"
            >
              <Upload size={14} />
              导入配置
            </button>
            <input
              ref={prefImportInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImport(f);
                e.target.value = '';
              }}
            />
          </div>
          <label className="flex items-start gap-2 text-xs text-gray-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeSecrets}
              onChange={(e) => setIncludeSecrets(e.target.checked)}
              className="mt-0.5 accent-[#07c160]"
            />
            <span>
              导出时包含 API Key / OAuth Token / 密码（默认不含）
              <span className="text-amber-600 dark:text-amber-400 ml-1">⚠️ 勾选后导出文件含敏感凭证，请妥善保管</span>
            </span>
          </label>
          <p className="text-[11px] text-gray-400 mt-1.5">
            机器特定字段（数据目录 / 日志目录 / 下载目录）始终不会导出，导入后也不会覆盖当前机器的这些路径。
          </p>
        </div>

        {/* 重置 */}
        <div className="pt-4 border-t border-gray-100 dk-border">
          <div className="text-sm font-semibold text-[#1d1d1f] dk-text mb-2">重置到首次启动状态</div>
          <label className="flex items-start gap-2 text-xs text-gray-500 cursor-pointer select-none mb-3">
            <input
              type="checkbox"
              checked={hardReset}
              onChange={(e) => setHardReset(e.target.checked)}
              className="mt-0.5 accent-red-500"
            />
            <span>
              硬重置：同时删除 AI 分析库（含 Skills / 聊天记忆 / 对话历史）
              <span className="text-red-500 ml-1">⚠️ 不可撤销，原文件会备份为 .bak</span>
            </span>
          </label>
          <button
            onClick={handleReset}
            disabled={prefBusy}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50 transition-colors ${
              hardReset
                ? 'bg-red-500 text-white hover:bg-red-600'
                : 'bg-amber-500 text-white hover:bg-amber-600'
            }`}
          >
            {prefBusy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            {hardReset ? '执行硬重置' : '执行软重置'}
          </button>
        </div>

        {prefResult && (
          <p className={`text-xs break-all ${prefResult.ok ? 'text-[#07c160]' : 'text-red-500'}`}>
            {prefResult.text}
          </p>
        )}
      </div>
    </section>
  );
};
