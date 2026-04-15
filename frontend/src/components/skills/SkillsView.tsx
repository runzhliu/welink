/**
 * Skill 管理页面 — 列出所有已炼化的 Skill，支持重新下载和删除
 */

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Sparkles, Download, Trash2, Loader2, Package, User, Users, Bot, AlertCircle, Clock, Search, ChevronUp, ChevronDown, X } from 'lucide-react';
import { skillsApi, type SkillRecord } from '../../services/api';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';
import { RevealLink } from '../common/RevealLink';
import { RelativeTime } from '../common/RelativeTime';
import { EmptyState } from '../common/EmptyState';

type SortKey = 'target_name' | 'skill_type' | 'format' | 'created_at' | 'file_size' | 'status';
type SortDir = 'asc' | 'desc';
type FilterType = 'all' | 'contact' | 'self' | 'group' | 'group-member';
type FilterStatus = 'all' | 'success' | 'pending' | 'running' | 'failed';

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
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string; path?: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 搜索 + 排序 + 筛选
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');

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

  const showToast = (type: 'success' | 'error', text: string, path?: string) => {
    setToast({ type, text, path });
    setTimeout(() => setToast(null), path ? 8000 : 3000);
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
            showToast('success', `已保存到 ${d.path ?? rec.filename}`, d.path);
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

  // 过滤 + 搜索 + 排序
  const displayedSkills = useMemo(() => {
    let list = [...skills];

    // 类型筛选
    if (filterType !== 'all') {
      list = list.filter(s => s.skill_type === filterType);
    }
    // 状态筛选
    if (filterStatus !== 'all') {
      list = list.filter(s => s.status === filterStatus);
    }
    // 关键词搜索（目标名、文件名、模型）
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(s =>
        s.target_name.toLowerCase().includes(q) ||
        s.filename.toLowerCase().includes(q) ||
        s.model_provider.toLowerCase().includes(q) ||
        s.model_name.toLowerCase().includes(q) ||
        (FORMAT_LABELS[s.format]?.name ?? '').toLowerCase().includes(q)
      );
    }
    // 排序
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'target_name': cmp = a.target_name.localeCompare(b.target_name, 'zh'); break;
        case 'skill_type':  cmp = a.skill_type.localeCompare(b.skill_type); break;
        case 'format':      cmp = a.format.localeCompare(b.format); break;
        case 'created_at':  cmp = a.created_at - b.created_at; break;
        case 'file_size':   cmp = a.file_size - b.file_size; break;
        case 'status':      cmp = a.status.localeCompare(b.status); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [skills, query, sortKey, sortDir, filterType, filterStatus]);

  // 状态统计
  const statusCounts = useMemo(() => {
    const counts = { all: skills.length, success: 0, pending: 0, running: 0, failed: 0 };
    for (const s of skills) {
      if (s.status === 'success') counts.success++;
      else if (s.status === 'pending') counts.pending++;
      else if (s.status === 'running') counts.running++;
      else if (s.status === 'failed') counts.failed++;
    }
    return counts;
  }, [skills]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <span className="opacity-20 ml-0.5 inline-block"><ChevronUp size={10} /></span>;
    return sortDir === 'asc'
      ? <ChevronUp size={10} className="ml-0.5 text-[#07c160] inline-block" />
      : <ChevronDown size={10} className="ml-0.5 text-[#07c160] inline-block" />;
  };

  return (
    <div className="max-w-5xl">
      {/* 标题 */}
      <div className="mb-6">
        <h1 className="dk-text text-3xl sm:text-5xl font-black tracking-tight text-[#1d1d1f] mb-1 flex items-center gap-3">
          <Sparkles size={32} className="text-[#07c160]" />
          Skills
        </h1>
        <p className="text-gray-400 text-sm">查看所有已炼化的 Skill 包，支持重新下载和删除</p>
      </div>

      {/* 搜索 + 筛选 */}
      {!loading && skills.length > 0 && (
        <div className="mb-4 space-y-3">
          {/* 搜索框 */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="搜索目标名、文件名、模型..."
              className="w-full pl-9 pr-9 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm focus:outline-none focus:border-[#07c160] bg-white dk-card dk-border"
            />
            {query && (
              <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
                <X size={12} />
              </button>
            )}
          </div>

          {/* 筛选按钮行 */}
          <div className="flex flex-wrap items-center gap-4 text-xs">
            {/* 类型筛选 */}
            <div className="flex items-center gap-1">
              <span className="text-gray-400">类型:</span>
              {([
                ['all', '全部'],
                ['contact', '联系人'],
                ['self', '自画像'],
                ['group', '群聊'],
                ['group-member', '群成员'],
              ] as const).map(([key, label]) => (
                <button key={key} onClick={() => setFilterType(key)}
                  className={`px-2 py-0.5 rounded-lg font-bold transition-all ${
                    filterType === key ? 'bg-[#07c160] text-white' : 'bg-gray-100 dark:bg-white/10 text-gray-500 hover:bg-gray-200'
                  }`}>
                  {label}
                </button>
              ))}
            </div>
            {/* 状态筛选 */}
            <div className="flex items-center gap-1">
              <span className="text-gray-400">状态:</span>
              {([
                ['all', `全部 (${statusCounts.all})`, ''],
                ['success', `成功 (${statusCounts.success})`, 'text-[#07c160]'],
                ['running', `进行中 (${statusCounts.pending + statusCounts.running})`, 'text-blue-500'],
                ['failed', `失败 (${statusCounts.failed})`, 'text-red-500'],
              ] as const).map(([key, label, colorCls]) => (
                <button key={key} onClick={() => setFilterStatus(key as FilterStatus)}
                  className={`px-2 py-0.5 rounded-lg font-bold transition-all ${
                    filterStatus === key
                      ? 'bg-[#07c160] text-white'
                      : `bg-gray-100 dark:bg-white/10 ${colorCls || 'text-gray-500'} hover:bg-gray-200`
                  }`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`mb-4 p-3 rounded-xl text-sm ${
          toast.type === 'success'
            ? 'bg-[#07c160]/10 text-[#07c160] border border-[#07c160]/30'
            : 'bg-red-50 text-red-500 border border-red-200 dark:bg-red-900/20 dark:border-red-800'
        }`}>
          {toast.type === 'success' ? '✓ ' : '✕ '}{toast.text}
          {toast.path && <RevealLink path={toast.path} className="ml-2" />}
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
        <EmptyState
          icon={<Package size={24} />}
          title="还没有炼化过 Skill"
          description="Skill 把聊天记录的人物风格打包成 Claude Code / Codex / Cursor 等工具能用的文件。在联系人、群聊或洞察页点紫色 Sparkles 图标开始炼化。"
        />
      )}

      {/* Skill 列表 */}
      {!loading && skills.length > 0 && (
        <div className="dk-card bg-white dk-border border border-gray-100 rounded-2xl overflow-hidden">
          <div className="hidden sm:grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-4 px-5 py-3 bg-[#f8f9fb] dark:bg-white/5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
            <button onClick={() => handleSort('target_name')} className="text-left hover:text-[#07c160] transition-colors flex items-center">
              目标<SortIcon col="target_name" />
            </button>
            <button onClick={() => handleSort('skill_type')} className="w-20 text-center hover:text-[#07c160] transition-colors">
              类型<SortIcon col="skill_type" />
            </button>
            <button onClick={() => handleSort('format')} className="w-28 text-center hover:text-[#07c160] transition-colors">
              格式<SortIcon col="format" />
            </button>
            <div className="w-32 text-right">模型</div>
            <button onClick={() => handleSort('created_at')} className="w-36 text-right hover:text-[#07c160] transition-colors">
              炼化时间<SortIcon col="created_at" />
            </button>
            <div className="w-20 text-right">操作</div>
          </div>

          {/* 无匹配结果 */}
          {displayedSkills.length === 0 && (
            <div className="px-5 py-12 text-center text-sm text-gray-400">
              没有匹配的 Skill
              <button onClick={() => { setQuery(''); setFilterType('all'); setFilterStatus('all'); }}
                className="ml-2 text-[#07c160] underline text-xs">重置筛选</button>
            </div>
          )}

          <div className="divide-y divide-gray-100 dark:divide-white/5">
            {displayedSkills.map(rec => {
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
                    <RelativeTime ts={rec.created_at} />
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
          {displayedSkills.length === skills.length
            ? `共 ${skills.length} 个 Skill`
            : `显示 ${displayedSkills.length} / ${skills.length} 个 Skill`
          } · 存储在 ai_analysis.db 的 skills 表
        </p>
      )}
    </div>
  );
};
