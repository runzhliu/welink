/**
 * Skill 管理页面 — 列出所有已炼化的 Skill，支持重新下载和删除
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Sparkles, Download, Trash2, Loader2, Package, User, Users, Bot, AlertCircle, Clock } from 'lucide-react';
import { skillsApi, type SkillRecord } from '../../services/api';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';

const FORMAT_LABELS: Record<string, { icon: string; name: string }> = {
  'claude-skill':  { icon: '📁', name: 'Claude Code Skill' },
  'claude-agent':  { icon: '🤖', name: 'Claude Code Subagent' },
  'codex':         { icon: '🧠', name: 'OpenAI Codex' },
  'opencode':      { icon: '💡', name: 'OpenCode Agent' },
  'cursor':        { icon: '✏️', name: 'Cursor Rule' },
  'generic':       { icon: '📄', name: '通用 Markdown' },
};

const TYPE_LABELS: Record<string, { icon: React.ReactNode; name: string; color: string }> = {
  'contact':       { icon: <User size={12} />,   name: '联系人',   color: 'bg-[#07c160]/10 text-[#07c160]' },
  'self':          { icon: <Bot size={12} />,    name: '自画像',   color: 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-300' },
  'group':         { icon: <Users size={12} />,  name: '群聊智囊', color: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300' },
  'group-member':  { icon: <Users size={12} />,  name: '群成员',   color: 'bg-cyan-100 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-300' },
};

const formatBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

const formatTime = (unix: number) => {
  const d = new Date(unix * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// 检测是否在 App WebView 里
const isWebView = () => {
  const ua = navigator.userAgent;
  return ua.includes('AppleWebKit') && !ua.includes('Safari') && !ua.includes('Chrome') && !ua.includes('Firefox');
};

export const SkillsView: React.FC = () => {
  const { privacyMode } = usePrivacyMode();
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadSkills = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const list = await skillsApi.list();
      setSkills(list);
    } catch (e) {
      if (!silent) setToast({ type: 'error', text: `加载失败: ${(e as Error).message}` });
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  // 如果有 pending/running 任务，自动每 2s 轮询一次
  useEffect(() => {
    const hasActive = skills.some(s => s.status === 'pending' || s.status === 'running');
    if (hasActive) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => loadSkills(true), 2000);
      return () => {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      };
    } else {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
  }, [skills, loadSkills]);

  const showToast = (type: 'success' | 'error', text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3000);
  };

  const handleDownload = async (rec: SkillRecord) => {
    setDownloadingId(rec.id);
    try {
      if (isWebView()) {
        // App 模式：后端读文件 → 前端再 POST 到 save-file
        const resp = await fetch(skillsApi.downloadUrl(rec.id));
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = (reader.result as string).split(',')[1] ?? '';
          const saveResp = await fetch('/api/app/save-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: rec.filename, content: base64, encoding: 'base64' }),
          });
          if (saveResp.ok) {
            const d = await saveResp.json() as { path?: string };
            showToast('success', `已保存到 ${d.path ?? rec.filename}`);
          } else {
            showToast('error', '保存失败');
          }
          setDownloadingId(null);
        };
        reader.readAsDataURL(blob);
      } else {
        // 浏览器模式：直接触发下载
        const a = document.createElement('a');
        a.href = skillsApi.downloadUrl(rec.id);
        a.download = rec.filename;
        a.click();
        setDownloadingId(null);
      }
    } catch (e) {
      showToast('error', `下载失败: ${(e as Error).message}`);
      setDownloadingId(null);
    }
  };

  const handleDelete = async (rec: SkillRecord) => {
    if (!confirm(`确定删除「${rec.target_name}」的 ${FORMAT_LABELS[rec.format]?.name ?? rec.format}？\n文件也会一并删除。`)) {
      return;
    }
    setDeletingId(rec.id);
    try {
      await skillsApi.delete(rec.id);
      setSkills(prev => prev.filter(s => s.id !== rec.id));
      showToast('success', '已删除');
    } catch (e) {
      showToast('error', `删除失败: ${(e as Error).message}`);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="max-w-5xl">
      {/* 标题 */}
      <div className="mb-6">
        <h1 className="dk-text text-3xl sm:text-5xl font-black tracking-tight text-[#1d1d1f] mb-1 flex items-center gap-3">
          <Sparkles size={32} className="text-[#07c160]" />
          Skill 管理
        </h1>
        <p className="text-gray-400 text-sm">查看所有已炼化的 Skill 包，支持重新下载和删除</p>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`mb-4 p-3 rounded-xl text-sm ${
          toast.type === 'success'
            ? 'bg-[#07c160]/10 text-[#07c160] border border-[#07c160]/30'
            : 'bg-red-50 text-red-500 border border-red-200 dark:bg-red-900/20 dark:border-red-800'
        }`}>
          {toast.type === 'success' ? '✓ ' : '✕ '}{toast.text}
        </div>
      )}

      {/* 加载中 */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={32} className="animate-spin text-[#07c160]" />
        </div>
      )}

      {/* 空状态 */}
      {!loading && skills.length === 0 && (
        <div className="dk-card bg-white dk-border border border-gray-100 rounded-2xl p-12 text-center">
          <Package size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-400 text-sm mb-1">还没有炼化过 Skill</p>
          <p className="text-gray-300 text-xs">
            在联系人、群聊或洞察页点击 <Sparkles size={10} className="inline text-[#07c160]" /> 按钮开始炼化
          </p>
        </div>
      )}

      {/* Skill 列表 */}
      {!loading && skills.length > 0 && (
        <div className="dk-card bg-white dk-border border border-gray-100 rounded-2xl overflow-hidden">
          <div className="hidden sm:grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-4 px-5 py-3 bg-[#f8f9fb] dark:bg-white/5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
            <div>目标</div>
            <div className="w-20 text-center">类型</div>
            <div className="w-28 text-center">格式</div>
            <div className="w-32 text-right">模型</div>
            <div className="w-36 text-right">炼化时间</div>
            <div className="w-20 text-right">操作</div>
          </div>

          <div className="divide-y divide-gray-100 dark:divide-white/5">
            {skills.map(rec => {
              const typeInfo = TYPE_LABELS[rec.skill_type];
              const formatInfo = FORMAT_LABELS[rec.format];
              const isActive = rec.status === 'pending' || rec.status === 'running';
              const isFailed = rec.status === 'failed';
              return (
                <div key={rec.id} className={`grid sm:grid-cols-[1fr_auto_auto_auto_auto_auto] gap-4 px-5 py-4 items-center transition-colors ${
                  isActive ? 'bg-blue-50/40 dark:bg-blue-900/10' :
                  isFailed ? 'bg-red-50/40 dark:bg-red-900/10' :
                  'hover:bg-gray-50 dark:hover:bg-white/[0.02]'
                }`}>
                  {/* 目标名 + 文件名 / 状态 */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className={`font-bold text-sm dk-text text-[#1d1d1f] truncate ${privacyMode ? 'privacy-blur' : ''}`}>
                        {rec.target_name}
                      </div>
                      {rec.status === 'pending' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-500">
                          <Clock size={10} /> 等待中
                        </span>
                      )}
                      {rec.status === 'running' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300">
                          <Loader2 size={10} className="animate-spin" /> 炼化中
                        </span>
                      )}
                      {rec.status === 'failed' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300">
                          <AlertCircle size={10} /> 失败
                        </span>
                      )}
                    </div>
                    {isActive ? (
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        {rec.status === 'pending' ? '已提交，等待执行…' : 'AI 正在分析聊天记录…'}
                      </div>
                    ) : isFailed ? (
                      <div className="text-[10px] text-red-500 dark:text-red-400 truncate mt-0.5" title={rec.error_msg}>
                        {rec.error_msg}
                      </div>
                    ) : (
                      <div className="text-[10px] text-gray-400 truncate mt-0.5">
                        {rec.filename} · {formatBytes(rec.file_size)}
                      </div>
                    )}
                  </div>

                  {/* 类型标签 */}
                  <div className="w-20 flex justify-center">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${typeInfo?.color ?? 'bg-gray-100 text-gray-500'}`}>
                      {typeInfo?.icon}
                      {typeInfo?.name ?? rec.skill_type}
                    </span>
                  </div>

                  {/* 格式 */}
                  <div className="w-28 text-center text-xs text-gray-500">
                    <span>{formatInfo?.icon ?? '📦'}</span>{' '}
                    <span className="text-[10px]">{formatInfo?.name ?? rec.format}</span>
                  </div>

                  {/* 模型 */}
                  <div className="w-32 text-right text-[10px] text-gray-400 truncate">
                    {rec.model_provider}
                    {rec.model_name && <div className="text-gray-300 truncate">{rec.model_name}</div>}
                  </div>

                  {/* 时间 */}
                  <div className="w-36 text-right text-[10px] text-gray-400 tabular-nums">
                    {formatTime(rec.created_at)}
                  </div>

                  {/* 操作 */}
                  <div className="w-20 flex items-center justify-end gap-1">
                    <button
                      onClick={() => handleDownload(rec)}
                      disabled={downloadingId === rec.id || rec.status !== 'success'}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-[#07c160] hover:bg-[#07c160]/10 transition-colors disabled:opacity-30 disabled:hover:text-gray-400 disabled:hover:bg-transparent"
                      title={rec.status === 'success' ? '重新下载' : '任务未完成'}
                    >
                      {downloadingId === rec.id
                        ? <Loader2 size={14} className="animate-spin" />
                        : <Download size={14} />
                      }
                    </button>
                    <button
                      onClick={() => handleDelete(rec)}
                      disabled={deletingId === rec.id}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                      title="删除"
                    >
                      {deletingId === rec.id
                        ? <Loader2 size={14} className="animate-spin" />
                        : <Trash2 size={14} />
                      }
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && skills.length > 0 && (
        <p className="text-[10px] text-gray-300 mt-3 text-center">
          共 {skills.length} 个 Skill · 存储在 ai_analysis.db 的 skills 表
        </p>
      )}
    </div>
  );
};
