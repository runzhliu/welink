import React, { useState } from 'react';
import { Stethoscope, Copy, RefreshCw, Loader2, CheckCircle2, AlertTriangle, AlertCircle, XCircle } from 'lucide-react';
import axios from 'axios';
import { RelativeTime } from '../../common/RelativeTime';
import { FeedbackModal } from '../../common/FeedbackModal';
import { useToast } from '../../common/Toast';

type DiagSection = { status: 'ok' | 'warn' | 'error' | 'skipped'; message: string };
type DiagResult = {
  generated_at: string;
  data_dir: DiagSection & { path: string; warnings?: string[] };
  index: DiagSection & { is_initialized: boolean; is_indexing: boolean; total_cached: number; last_error?: string };
  llm_profiles: (DiagSection & { name: string; provider: string; model: string; base_url?: string; has_api_key: boolean; latency_ms?: number })[];
  disk: DiagSection & { ai_analysis_db_path: string; ai_analysis_db_size: number; avatar_cache_dir: string; avatar_cache_size: number; avatar_cache_file_count: number };
};

export const DiagnosticsSection: React.FC<{
  appVersion?: string;
}> = ({ appVersion }) => {
  const toast = useToast();
  const [diagRunning, setDiagRunning] = useState(false);
  const [diag, setDiag] = useState<DiagResult | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const runDiag = async () => {
    setDiagRunning(true);
    try {
      const { data } = await axios.get<DiagResult>('/api/diagnostics');
      setDiag(data);
    } catch (e: unknown) {
      const anyE = e as { message?: string };
      setDiag(null);
      toast.error('诊断失败：' + (anyE?.message || String(e)));
    } finally {
      setDiagRunning(false);
    }
  };

  const diagToMarkdown = (d: DiagResult): string => {
    const statusEmoji = (s: string) => s === 'ok' ? '✅' : s === 'warn' ? '⚠️' : s === 'skipped' ? '⏭️' : '❌';
    const lines: string[] = [];
    lines.push(`# WeLink 诊断报告`);
    lines.push(`> 生成时间：${new Date(d.generated_at).toLocaleString()}`);
    lines.push('');
    lines.push(`## ${statusEmoji(d.data_dir.status)} 数据目录`);
    lines.push(`- 状态：**${d.data_dir.message}**`);
    if (d.data_dir.path) lines.push('- 路径：`' + d.data_dir.path + '`');
    if (d.data_dir.warnings?.length) {
      lines.push('- 警告：');
      d.data_dir.warnings.forEach(w => lines.push(`  - ${w}`));
    }
    lines.push('');
    lines.push(`## ${statusEmoji(d.index.status)} 索引`);
    lines.push(`- 状态：**${d.index.message}**`);
    lines.push(`- is_initialized=${d.index.is_initialized}, is_indexing=${d.index.is_indexing}, total_cached=${d.index.total_cached}`);
    if (d.index.last_error) lines.push('- last_error：`' + d.index.last_error + '`');
    lines.push('');
    lines.push(`## LLM Profiles`);
    if (d.llm_profiles.length === 0) {
      lines.push('- 未配置任何 LLM profile');
    } else {
      d.llm_profiles.forEach(p => {
        lines.push(`- ${statusEmoji(p.status)} **${p.name}**（${p.provider} / ${p.model || '?'}）— ${p.message}`);
        if (p.base_url) lines.push('  - base_url：`' + p.base_url + '`');
        lines.push(`  - api_key：${p.has_api_key ? '已配置' : '未配置'}`);
        if (p.latency_ms) lines.push(`  - 延迟：${p.latency_ms}ms`);
      });
    }
    lines.push('');
    lines.push(`## ${statusEmoji(d.disk.status)} 磁盘`);
    lines.push(`- ${d.disk.message}`);
    lines.push('- AI 分析库：`' + d.disk.ai_analysis_db_path + '`');
    return lines.join('\n');
  };

  const copyDiagMd = async () => {
    if (!diag) return;
    try {
      await navigator.clipboard.writeText(diagToMarkdown(diag));
      toast.success('已复制诊断报告到剪贴板（Markdown 格式）');
    } catch (e: unknown) {
      toast.error('复制失败：' + (e as Error).message);
    }
  };

  return (
    <>
      <section className="mb-8" data-section-id="diag" data-diag-anchor data-settings-tags="诊断 diagnostics 健康检查 反馈 问题 feedback issue bug llm">
        <div className="flex items-center gap-2 mb-3">
          <Stethoscope size={18} className="text-[#07c160]" />
          <h3 className="text-base font-bold text-[#1d1d1f] dk-text">诊断</h3>
          <button
            onClick={() => setFeedbackOpen(true)}
            data-feedback-open
            className="ml-auto text-xs text-[#07c160] hover:underline flex items-center gap-1"
            title="带上诊断报告一起反馈问题"
          >
            反馈问题 →
          </button>
        </div>
        <p className="text-sm text-gray-400 mb-4">一键检查数据目录、索引状态、LLM 配置和磁盘占用；遇到问题可把诊断结果附到反馈</p>
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 dk-card dk-border">
          <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
            <span className="text-sm text-gray-500">
              {diag ? <>上次检查：<RelativeTime ts={Math.floor(new Date(diag.generated_at).getTime() / 1000)} /></> : '尚未运行'}
            </span>
            <div className="flex gap-2">
              {diag && (
                <button
                  onClick={copyDiagMd}
                  className="px-3 py-2 rounded-xl bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 text-sm font-semibold hover:bg-gray-200 dark:hover:bg-white/15 transition-colors flex items-center gap-1.5"
                  title="复制为 Markdown（贴到 issue / Slack 友好）"
                >
                  <Copy size={14} />
                  复制为 Markdown
                </button>
              )}
              <button
                onClick={runDiag}
                disabled={diagRunning}
                data-diag-run
                className="px-4 py-2 rounded-xl bg-[#07c160] text-white text-sm font-semibold hover:bg-[#06ad56] disabled:opacity-50 transition-colors flex items-center gap-1.5"
              >
                {diagRunning ? <><Loader2 size={14} className="animate-spin" />检查中…</> : <><RefreshCw size={14} />运行诊断</>}
              </button>
            </div>
          </div>
          {diag && (() => {
            const StatusIcon = ({ s }: { s: string }) => {
              if (s === 'ok') return <CheckCircle2 size={16} className="text-[#07c160] flex-shrink-0" />;
              if (s === 'warn') return <AlertTriangle size={16} className="text-amber-500 flex-shrink-0" />;
              if (s === 'skipped') return <AlertCircle size={16} className="text-gray-400 flex-shrink-0" />;
              return <XCircle size={16} className="text-red-500 flex-shrink-0" />;
            };
            const Row = ({ label, status, message, sub }: { label: string; status: string; message: string; sub?: React.ReactNode }) => (
              <div className="flex items-start gap-3 py-2.5 border-t border-gray-100 dk-border first:border-t-0">
                <StatusIcon s={status} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold text-[#1d1d1f] dk-text">{label}</span>
                    <span className={`text-xs ${status === 'ok' ? 'text-[#07c160]' : status === 'warn' ? 'text-amber-600' : status === 'skipped' ? 'text-gray-400' : 'text-red-500'}`}>{message}</span>
                  </div>
                  {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
                </div>
              </div>
            );
            return (
              <div>
                <Row
                  label="数据目录"
                  status={diag.data_dir.status}
                  message={diag.data_dir.message}
                  sub={
                    <>
                      {diag.data_dir.path && <div className="font-mono break-all">{diag.data_dir.path}</div>}
                      {diag.data_dir.warnings?.map((w, i) => <div key={i} className="text-amber-600">⚠ {w}</div>)}
                    </>
                  }
                />
                <Row
                  label="索引"
                  status={diag.index.status}
                  message={diag.index.message}
                  sub={diag.index.last_error && <div className="text-red-500">{diag.index.last_error}</div>}
                />
                {diag.llm_profiles.length === 0 ? (
                  <Row label="LLM" status="warn" message="未配置任何 LLM profile" />
                ) : (
                  diag.llm_profiles.map((p, i) => (
                    <Row
                      key={i}
                      label={`LLM · ${p.name}`}
                      status={p.status}
                      message={p.message}
                      sub={
                        <>
                          <div>{p.provider} / {p.model || '(未指定 model)'}</div>
                          {p.base_url && <div className="font-mono text-[10px] text-gray-400 break-all">{p.base_url}</div>}
                          {!p.has_api_key && <div className="text-amber-600">未配置 API Key</div>}
                        </>
                      }
                    />
                  ))
                )}
                <Row label="磁盘" status={diag.disk.status} message={diag.disk.message} />
              </div>
            );
          })()}
        </div>
      </section>
      <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} appVersion={appVersion} />
    </>
  );
};
