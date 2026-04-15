/**
 * 反馈问题 Modal：预填诊断报告 / 环境信息，提供三条出口
 *   1. 打开 GitHub 新建 issue（有账号的首选）
 *   2. 复制为 Markdown（没账号 → 贴微信 / 邮件）
 *   3. 下载 .md 文件（没账号 → 换台机器再发）
 *
 * GitHub issue URL 有 ~8KB 上限；超过时先复制到剪贴板，再打开空 issue，让用户粘贴。
 */

import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { X, Bug, Github, Copy, Download, Loader2, CheckCircle2 } from 'lucide-react';
import { useToast } from './Toast';
import { canReveal } from '../../utils/reveal';
import { useEscape } from '../../hooks/useEscape';

interface Props {
  open: boolean;
  onClose: () => void;
  appVersion?: string;
}

// GitHub URL 长度预算：实测 issue new 接口 URL 上限约 8200 chars；保守用 7000
const GITHUB_URL_BUDGET = 7000;
const REPO = 'runzhliu/welink';

type DiagResult = any; // 结构和 Settings 里一致，此处只读不改

function buildEnvSection(appVersion?: string): string {
  const ua = navigator.userAgent;
  const mode = canReveal() ? 'App（WebView）' : 'Docker / 浏览器';
  const parts = [
    `- 运行模式：${mode}`,
    `- 版本：${appVersion ?? '未知'}`,
    `- User-Agent：\`${ua}\``,
    `- 时区：${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
    `- 提交时间：${new Date().toISOString()}`,
  ];
  return parts.join('\n');
}

function diagToMarkdown(d: DiagResult): string {
  if (!d) return '';
  const statusEmoji = (s: string) => s === 'ok' ? '✅' : s === 'warn' ? '⚠️' : s === 'skipped' ? '⏭️' : '❌';
  const lines: string[] = [];
  lines.push(`### ${statusEmoji(d.data_dir.status)} 数据目录`);
  lines.push(`- ${d.data_dir.message}`);
  if (d.data_dir.path) lines.push('- 路径：`' + d.data_dir.path + '`');
  d.data_dir.warnings?.forEach((w: string) => lines.push(`- ⚠️ ${w}`));
  lines.push('');
  lines.push(`### ${statusEmoji(d.index.status)} 索引`);
  lines.push(`- ${d.index.message}（total_cached=${d.index.total_cached}）`);
  if (d.index.last_error) lines.push('- last_error：`' + d.index.last_error + '`');
  lines.push('');
  lines.push(`### LLM Profiles`);
  if (!d.llm_profiles.length) lines.push('- 未配置');
  d.llm_profiles.forEach((p: any) => {
    lines.push(`- ${statusEmoji(p.status)} **${p.name}**（${p.provider} / ${p.model || '?'}）— ${p.message}`);
  });
  lines.push('');
  lines.push(`### ${statusEmoji(d.disk.status)} 磁盘`);
  lines.push(`- ${d.disk.message}`);
  return lines.join('\n');
}

export const FeedbackModal: React.FC<Props> = ({ open, onClose, appVersion }) => {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [includeEnv, setIncludeEnv] = useState(true);
  const [includeDiag, setIncludeDiag] = useState(true);

  const [diag, setDiag] = useState<DiagResult | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEscape(open, onClose);

  // 打开时拉一次诊断（失败不阻塞）
  useEffect(() => {
    if (!open) return;
    if (!includeDiag) return;
    setDiagLoading(true);
    axios.get('/api/diagnostics')
      .then(r => setDiag(r.data))
      .catch(() => { /* 后端未就绪时允许继续，勾选就会跳过 */ })
      .finally(() => setDiagLoading(false));
  }, [open, includeDiag]);

  // 关闭时清状态
  useEffect(() => {
    if (!open) {
      setTitle('');
      setBody('');
      setDiag(null);
    }
  }, [open]);

  const assembleMarkdown = (): string => {
    const sections: string[] = [];
    sections.push(`## 问题描述\n\n${body.trim() || '_（用户未填写）_'}`);
    if (includeEnv) {
      sections.push(`## 环境信息\n\n${buildEnvSection(appVersion)}`);
    }
    if (includeDiag && diag) {
      sections.push(`## 诊断报告\n\n${diagToMarkdown(diag)}`);
    }
    return sections.join('\n\n');
  };

  const submitViaGitHub = async () => {
    if (!title.trim()) { toast.error('请先填写问题标题'); return; }
    setSubmitting(true);
    try {
      const md = assembleMarkdown();
      const urlBase = `https://github.com/${REPO}/issues/new`;
      const params = new URLSearchParams();
      params.set('title', title.trim());
      params.set('body', md);
      const fullUrl = `${urlBase}?${params.toString()}`;

      let openUrl = fullUrl;
      if (fullUrl.length > GITHUB_URL_BUDGET) {
        // 超长：先复制 body 到剪贴板，再打开空 body 的 issue 页让用户粘贴
        await navigator.clipboard.writeText(md);
        const fallbackParams = new URLSearchParams();
        fallbackParams.set('title', title.trim());
        fallbackParams.set('body', '> ⚠️ 详情内容过长，已自动复制到剪贴板，请在这里粘贴（Cmd/Ctrl + V）。');
        openUrl = `${urlBase}?${fallbackParams.toString()}`;
        toast.info('内容较长，已复制到剪贴板；GitHub 打开后请粘贴');
      }

      if (canReveal()) {
        // App 模式：走后端 open-url（系统浏览器）
        await axios.get('/api/open-url', { params: { url: openUrl } });
      } else {
        window.open(openUrl, '_blank');
      }
      onClose();
    } catch (e: unknown) {
      toast.error('打开 GitHub 失败：' + (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const copyAsMarkdown = async () => {
    try {
      const md = `# ${title.trim() || '问题反馈'}\n\n${assembleMarkdown()}`;
      await navigator.clipboard.writeText(md);
      toast.success('已复制到剪贴板，可粘贴到邮件 / 微信 / 任何地方');
    } catch (e: unknown) {
      toast.error('复制失败：' + (e as Error).message);
    }
  };

  const downloadAsFile = () => {
    const md = `# ${title.trim() || '问题反馈'}\n\n${assembleMarkdown()}`;
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.download = `welink-feedback-${ts}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success('已下载，可作为附件发送');
  };

  if (!open) return null;

  const mdPreview = assembleMarkdown();
  const urlLen = (() => {
    const p = new URLSearchParams();
    p.set('title', title.trim());
    p.set('body', mdPreview);
    return `https://github.com/${REPO}/issues/new?`.length + p.toString().length;
  })();
  const tooLong = urlLen > GITHUB_URL_BUDGET;

  return (
    <div
      className="fixed inset-0 z-[250] bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
      onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }}
      tabIndex={-1}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] bg-white dark:bg-[#1d1d1f] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-6 py-4 border-b border-gray-100 dark:border-white/10">
          <Bug size={18} className="text-[#07c160]" />
          <h3 className="text-base font-bold text-[#1d1d1f] dk-text flex-1">反馈问题 / 发送建议</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div>
            <label className="text-xs font-bold text-[#1d1d1f] dk-text">问题标题 <span className="text-red-500">*</span></label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="简短描述遇到的问题"
              className="mt-1 w-full text-sm border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 bg-[#f8f9fb] dk-input focus:outline-none focus:border-[#07c160]"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-[#1d1d1f] dk-text">详细描述</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={5}
              placeholder="发生了什么？做了哪些操作？期望是什么？"
              className="mt-1 w-full text-sm border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 bg-[#f8f9fb] dk-input focus:outline-none focus:border-[#07c160] resize-none"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer">
              <input type="checkbox" checked={includeEnv} onChange={e => setIncludeEnv(e.target.checked)} />
              附带环境信息（版本、平台、时区；不含任何聊天内容）
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer">
              <input type="checkbox" checked={includeDiag} onChange={e => setIncludeDiag(e.target.checked)} />
              附带诊断报告（数据目录状态 / 索引状态 / LLM 配置健康度）
              {diagLoading && <Loader2 size={12} className="animate-spin text-gray-400" />}
              {diag && !diagLoading && <CheckCircle2 size={12} className="text-[#07c160]" />}
            </label>
          </div>

          {/* Markdown 预览 */}
          <details>
            <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">预览生成的 Markdown（{mdPreview.length} 字符，URL ~{urlLen}）</summary>
            <pre className="mt-2 text-[10px] bg-gray-50 dark:bg-white/5 rounded-lg p-3 overflow-x-auto max-h-40 whitespace-pre-wrap font-mono text-gray-600 dark:text-gray-400">
              {mdPreview}
            </pre>
          </details>

          {tooLong && (
            <div className="text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-amber-800">
              ⚠️ 内容已超过 GitHub URL 长度限制。点击「在 GitHub 创建 issue」时会自动复制到剪贴板，并在 issue 页面提示粘贴。
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 dark:border-white/10 bg-[#f8f9fb] dark:bg-white/5">
          <div className="flex items-start justify-between gap-4 mb-3">
            <p className="text-[10px] text-gray-400 leading-relaxed">
              没有 GitHub 账号？用「复制为 Markdown」贴到邮件 / 微信，或用「下载 .md」作为附件发给维护者。
            </p>
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            <button
              onClick={downloadAsFile}
              disabled={!title.trim() || submitting}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white dark:bg-white/10 border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-white/15 disabled:opacity-50 transition-colors"
            >
              <Download size={14} />
              下载 .md
            </button>
            <button
              onClick={copyAsMarkdown}
              disabled={!title.trim() || submitting}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white dark:bg-white/10 border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-white/15 disabled:opacity-50 transition-colors"
            >
              <Copy size={14} />
              复制为 Markdown
            </button>
            <button
              onClick={submitViaGitHub}
              disabled={!title.trim() || submitting}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#07c160] text-white text-sm font-semibold hover:bg-[#06ad56] disabled:opacity-50 transition-colors"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Github size={14} />}
              在 GitHub 创建 issue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
