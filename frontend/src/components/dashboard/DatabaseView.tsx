/**
 * 数据库管理视图组件 - 支持查看表结构和表数据
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Database, HardDrive, Table, FileText, AlertCircle,
  ChevronRight, ChevronDown, Loader2, ArrowLeft, ArrowRight,
  Hash, LayoutList, Search, Terminal, Play, Copy, Check,
  BookOpen, History, Star, BarChart3, X, Download
} from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, LineChart, Line } from 'recharts';
import { databaseApi } from '../../services/api';
import type { DBInfo, TableInfo, ColumnInfo, TableData, QueryResult } from '../../types';

// ─── 点击复制 Hook ────────────────────────────────────────────────────────────

const useCopyable = () => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copy = useCallback((text: string, key: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    }).catch(() => {});
  }, []);
  return { copy, copiedKey };
};

// ─── SQL 模板 ──────────────────────────────────────────────────────────────
const SQL_TEMPLATES: { label: string; db: string; sql: string }[] = [
  { label: '联系人列表（Top 50）', db: 'contact.db', sql: `SELECT username, COALESCE(remark,'') AS remark, nick_name, alias, flag
FROM contact
WHERE verify_flag=0 AND username NOT LIKE '%@chatroom'
ORDER BY nick_name LIMIT 50;` },
  { label: '群聊列表', db: 'contact.db', sql: `SELECT username, nick_name, COALESCE(remark,'') AS remark,
  COALESCE(small_head_url,'') AS avatar
FROM contact WHERE username LIKE '%@chatroom'
ORDER BY nick_name;` },
  { label: '所有表一览', db: 'contact.db', sql: `SELECT type, name, tbl_name
FROM sqlite_master
WHERE type IN ('table','view')
ORDER BY name;` },
  { label: 'Name2Id 映射（wxid 反查）', db: 'message_0.db', sql: `SELECT rowid, user_name FROM Name2Id
ORDER BY rowid LIMIT 100;` },
  { label: 'AI 对话历史', db: 'ai_analysis.db', sql: `SELECT id, key, role, substr(content,1,80) AS preview, created_at
FROM ai_conversations
ORDER BY created_at DESC LIMIT 30;` },
  { label: 'Skill 炼化记录', db: 'ai_analysis.db', sql: `SELECT id, skill_type, format, target_name, status,
  model_provider, model_name, msg_limit, created_at
FROM skill_records ORDER BY created_at DESC;` },
  { label: '记忆提炼结果', db: 'ai_analysis.db', sql: `SELECT key, substr(fact,1,100) AS fact_preview, created_at
FROM mem_facts
ORDER BY created_at DESC LIMIT 30;` },
  { label: '联系人头像列表', db: 'contact.db', sql: `SELECT username, COALESCE(remark, nick_name) AS name,
  COALESCE(small_head_url,'') AS avatar
FROM contact
WHERE small_head_url != '' AND verify_flag=0
ORDER BY nick_name LIMIT 30;` },
  { label: '表结构（PRAGMA）', db: 'contact.db', sql: `PRAGMA table_info(contact);` },
];

// ─── SQL 历史（localStorage）────────────────────────────────────────────────
const SQL_HISTORY_KEY = 'welink_sql_history';
const SQL_FAVORITES_KEY = 'welink_sql_favorites';
const MAX_HISTORY = 20;

function loadHistory(): { sql: string; db: string; ts: number }[] {
  try { return JSON.parse(localStorage.getItem(SQL_HISTORY_KEY) || '[]'); } catch { return []; }
}
function saveHistory(h: { sql: string; db: string; ts: number }[]) {
  localStorage.setItem(SQL_HISTORY_KEY, JSON.stringify(h.slice(0, MAX_HISTORY)));
}
function loadFavorites(): { sql: string; db: string; label: string }[] {
  try { return JSON.parse(localStorage.getItem(SQL_FAVORITES_KEY) || '[]'); } catch { return []; }
}
function saveFavorites(f: { sql: string; db: string; label: string }[]) {
  localStorage.setItem(SQL_FAVORITES_KEY, JSON.stringify(f));
}

// ─── 饼图颜色 ──────────────────────────────────────────────────────────────
const PIE_COLORS = ['#07c160', '#10aeff', '#ff9500', '#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b', '#6366f1'];

// ─── 子组件：自然语言查数据 ──────────────────────────────────────────────────

interface LLMProfileItem { id: string; name: string; provider: string; model?: string }

const NLQueryPanel: React.FC = () => {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [generatedSQL, setGeneratedSQL] = useState('');
  const [targetDB, setTargetDB] = useState('');
  const [explain, setExplain] = useState('');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState('');
  const [resultView, setResultView] = useState<'table' | 'chart'>('table');
  const [profiles, setProfiles] = useState<LLMProfileItem[]>([]);
  const [profileId, setProfileId] = useState('');

  useEffect(() => {
    fetch('/api/preferences').then(r => r.json()).then(d => {
      const ps: LLMProfileItem[] = d?.llm_profiles ?? [];
      setProfiles(ps);
      if (ps.length > 0 && !profileId) setProfileId(ps[0].id);
    }).catch(() => {});
  }, []);

  const activeProfile = profiles.find(p => p.id === profileId);

  const EXAMPLES = [
    '我有多少个联系人？',
    '哪些群聊名字里带"工作"？',
    '列出所有 AI 对话记录',
    '我炼化过哪些 Skill？',
  ];

  const handleAsk = async (q?: string) => {
    const text = (q || question).trim();
    if (!text || loading) return;
    setLoading(true);
    setError('');
    setGeneratedSQL('');
    setResult(null);
    setResultView('table');
    try {
      const resp = await fetch('/api/databases/nl-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text, profile_id: profileId }),
      });
      const data = await resp.json();
      if (data.error && !data.generated_sql) {
        setError(data.error);
      } else {
        setGeneratedSQL(data.generated_sql || '');
        setTargetDB(data.db || '');
        setExplain(data.explain || '');
        if (data.result) {
          setResult(data.result);
          if (data.result.error) setError(data.result.error);
        }
        if (data.error) setError(data.error);
      }
    } catch (e: any) {
      setError(e?.message || '请求失败');
    } finally {
      setLoading(false);
    }
  };

  const renderCellValue = (val: any) => {
    if (val === null || val === undefined) return <span className="text-gray-300 italic">NULL</span>;
    const str = String(val);
    if (str.length > 100) return <span title={str}>{str.slice(0, 100)}…</span>;
    return str;
  };

  const rows = result?.rows ?? [];
  const cols = result?.columns ?? [];

  return (
    <div className="dk-card bg-white rounded-3xl dk-border border border-gray-100 overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 dark:border-white/5 bg-gradient-to-r from-[#07c160]/5 to-[#10aeff]/5 dk-subtle flex-wrap">
        <span className="text-lg">🪄</span>
        <h3 className="font-black text-[#1d1d1f] dk-text text-base">自然语言查数据</h3>
        <span className="text-xs text-gray-400">用中文问，AI 自动写 SQL 并执行</span>
        <div className="ml-auto flex items-center gap-2">
          {profiles.length > 1 && (
            <select
              value={profileId}
              onChange={e => setProfileId(e.target.value)}
              className="text-xs border border-gray-200 dark:border-white/10 rounded-lg px-2 py-1 dk-input focus:outline-none focus:border-[#07c160]"
            >
              {profiles.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
          {activeProfile && (
            <span className="text-[10px] text-gray-400 font-mono">
              {activeProfile.provider}{activeProfile.model ? ` · ${activeProfile.model}` : ''}
            </span>
          )}
        </div>
      </div>

      <div className="px-5 py-4">
        <form onSubmit={e => { e.preventDefault(); handleAsk(); }} className="flex gap-2 mb-3">
          <input
            type="text"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder="谁给我发消息最多？/ 列出所有群聊 / 最近的 AI 对话..."
            className="flex-1 text-sm border border-gray-200 dark:border-white/10 rounded-xl px-4 py-2.5 focus:outline-none focus:border-[#07c160] dk-input"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !question.trim()}
            className="flex items-center gap-1.5 px-5 py-2.5 bg-[#07c160] text-white rounded-xl text-sm font-bold disabled:opacity-40 hover:bg-[#06ad56] transition-colors"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            提问
          </button>
        </form>

        {!generatedSQL && !loading && !error && (
          <div className="flex flex-wrap gap-2 mb-2">
            {EXAMPLES.map(ex => (
              <button
                key={ex}
                onClick={() => { setQuestion(ex); handleAsk(ex); }}
                className="px-3 py-1.5 rounded-full text-xs font-semibold bg-[#f8f9fb] dark:bg-white/5 text-gray-500 hover:text-[#07c160] hover:bg-[#e7f8f0] transition-colors"
              >
                {ex}
              </button>
            ))}
          </div>
        )}

        {explain && (
          <p className="text-xs text-[#07c160] font-semibold mb-2">💡 {explain}</p>
        )}

        {generatedSQL && (
          <div className="mb-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold text-gray-400 uppercase">AI 生成的 SQL</span>
              {targetDB && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-500 font-bold">{targetDB}</span>}
            </div>
            <pre className="text-xs font-mono bg-[#f8f9fb] dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-xl px-4 py-3 overflow-x-auto text-gray-700 dk-text whitespace-pre-wrap">
              {generatedSQL}
            </pre>
          </div>
        )}

        {error && (
          <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl px-4 py-2.5 text-sm text-red-700 dark:text-red-300 mb-3">
            {error}
          </div>
        )}

        {result && cols.length > 0 && rows.length > 0 && (
          <>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-400">{rows.length} 行 · {cols.length} 列</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const csvHeader = cols.join(',');
                    const csvRows = rows.map(r => r.map(c => {
                      const s = String(c ?? '');
                      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
                    }).join(',')).join('\n');
                    const blob = new Blob([csvHeader + '\n' + csvRows], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url; a.download = 'query_result.csv'; a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-[#07c160] transition-colors"
                >
                  <Download size={12} />
                  CSV
                </button>
                {cols.length >= 2 && (
                  <button onClick={() => setResultView(v => v === 'table' ? 'chart' : 'table')}
                    className={`flex items-center gap-1 text-xs transition-colors ${resultView === 'chart' ? 'text-[#07c160] font-bold' : 'text-gray-400 hover:text-[#07c160]'}`}>
                    <BarChart3 size={12} />
                    {resultView === 'chart' ? '表格' : '图表'}
                  </button>
                )}
              </div>
            </div>

            {resultView === 'chart' && cols.length >= 2 && (() => {
              const valueCol = rows.length > 0 ? rows[0].findIndex((v, i) => i > 0 && typeof v === 'number') : -1;
              if (valueCol < 0) return <p className="text-xs text-gray-400 text-center py-4">没有数值列可画图</p>;
              const chartData = rows.slice(0, 30).map(r => ({ name: String(r[0] ?? ''), value: Number(r[valueCol]) || 0 }));
              const isTime = /^\d{4}[-/]/.test(chartData[0]?.name ?? '');
              return (
                <div className="bg-[#f8f9fb] dark:bg-white/5 rounded-2xl p-4 mb-2">
                  <ResponsiveContainer width="100%" height={200}>
                    {isTime ? (
                      <LineChart data={chartData}>
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 10 }} width={50} />
                        <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                        <Line type="monotone" dataKey="value" stroke="#07c160" strokeWidth={2} dot={false} />
                      </LineChart>
                    ) : (
                      <BarChart data={chartData}>
                        <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} angle={-25} textAnchor="end" height={45} />
                        <YAxis tick={{ fontSize: 10 }} width={50} />
                        <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                        <Bar dataKey="value" fill="#07c160" radius={[4, 4, 0, 0]} maxBarSize={28} />
                      </BarChart>
                    )}
                  </ResponsiveContainer>
                </div>
              );
            })()}

            {resultView === 'table' && (
              <div className="bg-[#f8f9fb] dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 overflow-auto max-h-64">
                <table className="w-full text-xs font-mono">
                  <thead className="sticky top-0 bg-[#f0f0f0] dark:bg-white/5">
                    <tr>
                      {cols.map(col => (
                        <th key={col} className="px-3 py-2 text-left text-gray-600 font-bold whitespace-nowrap">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, ri) => (
                      <tr key={ri} className="border-t border-gray-100 dark:border-white/5 hover:bg-white dark:hover:bg-white/5">
                        {row.map((cell, ci) => (
                          <td key={ci} className="px-3 py-1.5 text-gray-700 dk-text max-w-[200px] truncate">{renderCellValue(cell)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

// ─── 子组件：表数据面板 ──────────────────────────────────────────────────────

interface TablePanelProps {
  dbName: string;
  tableName: string;
  onClose: () => void;
}

type PanelTab = 'schema' | 'data';

const TablePanel: React.FC<TablePanelProps> = ({ dbName, tableName, onClose }) => {
  const [tab, setTab] = useState<PanelTab>('data');
  const [schema, setSchema] = useState<ColumnInfo[]>([]);
  const [tableData, setTableData] = useState<TableData | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const limit = 50;

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const fetchSchema = useCallback(async () => {
    try {
      const cols = await databaseApi.getTableSchema(dbName, tableName);
      setSchema(cols || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load schema');
    }
  }, [dbName, tableName]);

  const fetchData = useCallback(async (off: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await databaseApi.getTableData(dbName, tableName, off, limit);
      setTableData(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [dbName, tableName]);

  useEffect(() => {
    fetchSchema();
    fetchData(0);
  }, [fetchSchema, fetchData]);

  const handlePageChange = (newOffset: number) => {
    setOffset(newOffset);
    fetchData(newOffset);
  };

  const totalPages = tableData ? Math.ceil(tableData.total / limit) : 0;
  const currentPage = Math.floor(offset / limit) + 1;

  const renderCellValue = (val: any) => {
    if (val === null || val === undefined) return <span className="text-gray-300 italic">NULL</span>;
    const str = String(val);
    if (str.startsWith('<binary')) return <span className="text-orange-400 italic text-xs">{str}</span>;
    if (str.length > 100) return <span title={str}>{str.slice(0, 100)}…</span>;
    return str;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="dk-card bg-white rounded-3xl shadow-2xl w-[92vw] h-[88vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-gray-100 dark:border-white/5 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#07c160] rounded-xl flex items-center justify-center">
              <Table size={20} className="text-white" strokeWidth={2.5} />
            </div>
            <div>
              <h2 className="text-lg font-black text-[#1d1d1f] dk-text">{tableName}</h2>
              <p className="text-xs text-gray-400 font-mono">{dbName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-sm font-semibold px-4 py-2 rounded-xl hover:bg-gray-100 transition"
          >
            关闭
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 px-8 pt-4 pb-0 flex-shrink-0">
          {(['data', 'schema'] as PanelTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-2 rounded-t-xl text-sm font-bold transition border-b-2 ${
                tab === t
                  ? 'text-[#07c160] border-[#07c160] bg-[#f0faf4]'
                  : 'text-gray-400 border-transparent hover:text-gray-600'
              }`}
            >
              {t === 'data' ? '表数据' : '表结构'}
            </button>
          ))}
          {tableData && (
            <span className="ml-auto text-xs text-gray-400 self-end pb-2">
              共 {tableData.total.toLocaleString()} 行
            </span>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto px-8 py-4">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-red-700 text-sm mb-4">
              {error}
            </div>
          )}

          {tab === 'schema' && (
            <div className="dk-card dk-border bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="dk-thead bg-[#f8f9fb] dk-border border-b border-gray-100">
                    <th className="px-5 py-3 text-left text-xs font-black text-gray-500 uppercase">#</th>
                    <th className="px-5 py-3 text-left text-xs font-black text-gray-500 uppercase">列名</th>
                    <th className="px-5 py-3 text-left text-xs font-black text-gray-500 uppercase">类型</th>
                    <th className="px-5 py-3 text-left text-xs font-black text-gray-500 uppercase">NOT NULL</th>
                    <th className="px-5 py-3 text-left text-xs font-black text-gray-500 uppercase">主键</th>
                    <th className="px-5 py-3 text-left text-xs font-black text-gray-500 uppercase">默认值</th>
                  </tr>
                </thead>
                <tbody>
                  {schema.map((col) => (
                    <tr key={col.cid} className="border-b border-gray-50 dark:border-white/5 hover:bg-[#f8f9fb] dark:hover:bg-white/5">
                      <td className="px-5 py-3 text-gray-400 font-mono text-xs">{col.cid}</td>
                      <td className="px-5 py-3 font-semibold text-[#1d1d1f] dk-text">
                        {col.primary_key && (
                          <Hash size={12} className="inline mr-1 text-[#07c160]" />
                        )}
                        {col.name}
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-blue-600 bg-blue-50 rounded-lg w-fit">
                        {col.type || 'ANY'}
                      </td>
                      <td className="px-5 py-3">
                        {col.not_null ? (
                          <span className="text-xs text-red-500 font-bold">YES</span>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {col.primary_key ? (
                          <span className="text-xs text-[#07c160] font-bold">PK</span>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-xs text-gray-400 font-mono">
                        {col.default_value || <span className="text-gray-200">NULL</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'data' && (
            <>
              {loading ? (
                <div className="flex items-center justify-center h-64">
                  <Loader2 size={32} className="text-[#07c160] animate-spin" />
                </div>
              ) : tableData && tableData.columns && tableData.columns.length > 0 ? (
                <div className="dk-card dk-border bg-white rounded-2xl border border-gray-100 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="dk-thead bg-[#f8f9fb] dk-border border-b border-gray-100">
                          <th className="px-4 py-3 text-left text-xs font-black text-gray-400 uppercase w-10">#</th>
                          {tableData.columns.map((col) => (
                            <th key={col} className="px-4 py-3 text-left text-xs font-black text-gray-500 uppercase whitespace-nowrap">
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(tableData.rows ?? []).map((row, ri) => (
                          <tr key={ri} className="border-b border-gray-50 dark:border-white/5 hover:bg-[#f8faf8] dark:hover:bg-white/5 transition-colors">
                            <td className="px-4 py-2 text-gray-300 text-xs font-mono">
                              {offset + ri + 1}
                            </td>
                            {row.map((cell, ci) => (
                              <td key={ci} className="px-4 py-2 text-gray-700 text-xs max-w-[200px] truncate font-mono">
                                {renderCellValue(cell)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="text-center py-20 text-gray-300">暂无数据</div>
              )}
            </>
          )}
        </div>

        {/* Pagination */}
        {tab === 'data' && tableData && tableData.total > limit && (
          <div className="flex items-center justify-between px-8 py-4 border-t border-gray-100 dark:border-white/5 flex-shrink-0">
            <span className="text-sm text-gray-400">
              第 {offset + 1}–{Math.min(offset + limit, tableData.total)} 行，共 {tableData.total.toLocaleString()} 行
            </span>
            <div className="flex gap-2">
              <button
                disabled={offset === 0}
                onClick={() => handlePageChange(Math.max(0, offset - limit))}
                className="flex items-center gap-1 px-4 py-2 rounded-xl text-sm font-semibold border border-gray-200 dark:border-white/10 hover:border-[#07c160] hover:text-[#07c160] disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                <ArrowLeft size={14} /> 上一页
              </button>
              <span className="px-4 py-2 text-sm text-gray-500 font-mono">
                {currentPage} / {totalPages}
              </span>
              <button
                disabled={offset + limit >= tableData.total}
                onClick={() => handlePageChange(offset + limit)}
                className="flex items-center gap-1 px-4 py-2 rounded-xl text-sm font-semibold border border-gray-200 dark:border-white/10 hover:border-[#07c160] hover:text-[#07c160] disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                下一页 <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── 子组件：SQL 编辑器 ───────────────────────────────────────────────────────

interface SQLEditorProps {
  databases: DBInfo[];
}

const SQLEditor: React.FC<SQLEditorProps> = ({ databases }) => {
  const [selectedDb, setSelectedDb] = useState('');
  const [sql, setSql] = useState('SELECT * FROM sqlite_master WHERE type=\'table\';');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState(loadHistory);
  const [favorites, setFavorites] = useState(loadFavorites);
  const [resultView, setResultView] = useState<'table' | 'chart'>('table');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleRun = async () => {
    if (!selectedDb || !sql.trim()) return;
    setLoading(true);
    setResult(null);
    setResultView('table');
    try {
      const r = await databaseApi.query(selectedDb, sql.trim());
      setResult(r);
      // 写入历史
      const next = [{ sql: sql.trim(), db: selectedDb, ts: Date.now() }, ...history.filter(h => h.sql !== sql.trim())];
      setHistory(next);
      saveHistory(next);
    } catch (e: any) {
      setResult({ columns: [], rows: [], error: e?.message || '查询失败' });
    } finally {
      setLoading(false);
    }
  };

  const addFavorite = () => {
    const label = prompt('给这条查询起个名字');
    if (!label?.trim()) return;
    const next = [...favorites, { sql: sql.trim(), db: selectedDb, label: label.trim() }];
    setFavorites(next);
    saveFavorites(next);
  };

  const removeFavorite = (idx: number) => {
    const next = favorites.filter((_, i) => i !== idx);
    setFavorites(next);
    saveFavorites(next);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleRun();
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = textareaRef.current!;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newVal = sql.slice(0, start) + '  ' + sql.slice(end);
      setSql(newVal);
      setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + 2; }, 0);
    }
  };

  const copyResult = async () => {
    if (!result) return;
    const header = result.columns.join('\t');
    const rows = (result.rows ?? []).map(r => r.map(c => c ?? 'NULL').join('\t')).join('\n');
    await navigator.clipboard.writeText(header + '\n' + rows);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const renderCellValue = (val: any) => {
    if (val === null || val === undefined) return <span className="text-gray-300 italic">NULL</span>;
    const str = String(val);
    if (str.startsWith('<binary')) return <span className="text-orange-400 italic text-xs">{str}</span>;
    if (str.length > 120) return <span title={str}>{str.slice(0, 120)}…</span>;
    return str;
  };

  return (
    <div className="dk-card bg-white rounded-3xl dk-border border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 dark:border-white/5 bg-[#f8f9fb] dk-subtle flex-wrap">
        <Terminal size={18} className="text-[#07c160]" strokeWidth={2.5} />
        <h3 className="font-black text-[#1d1d1f] dk-text text-base">SQL 编辑器</h3>
        <div className="flex items-center gap-1">
          <button onClick={() => { setShowTemplates(v => !v); setShowHistory(false); }}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${showTemplates ? 'bg-[#07c160] text-white' : 'text-gray-400 hover:text-[#07c160] hover:bg-[#e7f8f0]'}`}>
            <BookOpen size={11} />模板
          </button>
          <button onClick={() => { setShowHistory(v => !v); setShowTemplates(false); }}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${showHistory ? 'bg-[#07c160] text-white' : 'text-gray-400 hover:text-[#07c160] hover:bg-[#e7f8f0]'}`}>
            <History size={11} />历史
          </button>
          <button onClick={addFavorite} disabled={!sql.trim()}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold text-gray-400 hover:text-[#ff9500] hover:bg-orange-50 disabled:opacity-30 transition-all">
            <Star size={11} />收藏
          </button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={selectedDb}
            onChange={(e) => setSelectedDb(e.target.value)}
            className="text-sm border border-gray-200 rounded-xl px-3 py-1.5 focus:outline-none focus:border-[#07c160] bg-white dk-input"
          >
            <option value="">选择数据库</option>
            {databases.map((db) => (
              <option key={db.name} value={db.name}>{db.name}</option>
            ))}
          </select>
          <button
            onClick={handleRun}
            disabled={!selectedDb || !sql.trim() || loading}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-[#07c160] text-white rounded-xl text-sm font-bold disabled:opacity-40 hover:bg-[#06ad56] transition-colors"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            运行
          </button>
        </div>
      </div>

      {/* 模板 / 历史 / 收藏 面板 */}
      {(showTemplates || showHistory) && (
        <div className="px-4 pt-3 max-h-48 overflow-y-auto border-b border-gray-100 dark:border-white/5">
          {showTemplates && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 pb-3">
              {SQL_TEMPLATES.map((t, i) => (
                <button key={i} onClick={() => { setSql(t.sql); if (t.db) setSelectedDb(t.db); setShowTemplates(false); }}
                  className="text-left px-3 py-2 rounded-xl bg-[#f8f9fb] dark:bg-white/5 hover:bg-[#e7f8f0] dark:hover:bg-[#07c160]/10 transition-colors">
                  <div className="text-xs font-bold text-[#1d1d1f] dk-text">{t.label}</div>
                  {t.db && <div className="text-[10px] text-gray-400 mt-0.5">{t.db}</div>}
                </button>
              ))}
            </div>
          )}
          {showHistory && (
            <div className="space-y-1 pb-3">
              {favorites.length > 0 && (
                <>
                  <div className="text-[10px] font-bold text-[#ff9500] uppercase tracking-wider mb-1 flex items-center gap-1"><Star size={10} />收藏</div>
                  {favorites.map((f, i) => (
                    <div key={`f-${i}`} className="flex items-center gap-2 group">
                      <button onClick={() => { setSql(f.sql); if (f.db) setSelectedDb(f.db); setShowHistory(false); }}
                        className="flex-1 text-left px-3 py-1.5 rounded-lg hover:bg-[#e7f8f0] dark:hover:bg-[#07c160]/10 transition-colors">
                        <span className="text-xs font-bold text-[#1d1d1f] dk-text">{f.label}</span>
                        <span className="text-[10px] text-gray-400 ml-2">{f.db}</span>
                      </button>
                      <button onClick={() => removeFavorite(i)} className="text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 p-1"><X size={11} /></button>
                    </div>
                  ))}
                  <div className="h-px bg-gray-100 dark:bg-white/10 my-2" />
                </>
              )}
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1"><History size={10} />最近执行</div>
              {history.length === 0 ? (
                <p className="text-xs text-gray-300 py-2">暂无历史</p>
              ) : history.map((h, i) => (
                <button key={i} onClick={() => { setSql(h.sql); setSelectedDb(h.db); setShowHistory(false); }}
                  className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                  <div className="text-xs font-mono text-gray-600 dk-text truncate">{h.sql.replace(/\n/g, ' ').slice(0, 80)}</div>
                  <div className="text-[10px] text-gray-400 mt-0.5">{h.db} · {new Date(h.ts).toLocaleString()}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Editor */}
      <div className="px-4 pt-3 pb-2">
        <textarea
          ref={textareaRef}
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={5}
          spellCheck={false}
          placeholder="SELECT * FROM ..."
          className="w-full font-mono text-sm bg-[#f8f9fb] border border-gray-200 rounded-2xl px-4 py-3 resize-y focus:outline-none focus:border-[#07c160] transition-colors text-[#1d1d1f] leading-relaxed dk-input"
        />
        <p className="text-[10px] text-gray-300 mt-1 px-1">⌘+Enter 执行 · Tab 缩进</p>
      </div>

      {/* Results */}
      {result && (
        <div className="px-4 pb-4">
          {result.error ? (
            <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3 text-sm text-red-700 font-mono">
              {result.error}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-400">
                  {(result.rows ?? []).length} 行 · {result.columns.length} 列
                  {(result.rows ?? []).length >= 500 && <span className="text-orange-400 ml-1">（已截断至 500 行）</span>}
                </span>
                <div className="flex items-center gap-2">
                  {(result.rows ?? []).length > 0 && result.columns.length >= 2 && (
                    <button onClick={() => setResultView(v => v === 'table' ? 'chart' : 'table')}
                      className={`flex items-center gap-1 text-xs transition-colors ${resultView === 'chart' ? 'text-[#07c160] font-bold' : 'text-gray-400 hover:text-[#07c160]'}`}>
                      <BarChart3 size={12} />
                      {resultView === 'chart' ? '表格' : '图表'}
                    </button>
                  )}
                  <button onClick={copyResult} className="flex items-center gap-1 text-xs text-gray-400 hover:text-[#07c160] transition-colors">
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                    {copied ? '已复制' : '复制'}
                  </button>
                </div>
              </div>

              {resultView === 'chart' && result.columns.length >= 2 && (() => {
                const rows = result.rows ?? [];
                const labelCol = 0;
                const valueCol = rows.length > 0 ? rows[0].findIndex((v, i) => i > 0 && typeof v === 'number') : -1;
                if (valueCol < 0) return <p className="text-xs text-gray-400 text-center py-6">没有数值列可以画图（需要至少一列数字）</p>;
                const chartData = rows.slice(0, 50).map(r => ({ name: String(r[labelCol] ?? ''), value: Number(r[valueCol]) || 0 }));
                const isTimeSeries = chartData.length > 3 && /^\d{4}[-/]/.test(chartData[0]?.name ?? '');
                return (
                  <div className="bg-[#f8f9fb] dark:bg-white/5 rounded-2xl p-4 mb-2">
                    <div className="text-[10px] text-gray-400 mb-2">X: {result.columns[labelCol]} · Y: {result.columns[valueCol]}（前 50 行）</div>
                    <ResponsiveContainer width="100%" height={220}>
                      {isTimeSeries ? (
                        <LineChart data={chartData}>
                          <XAxis dataKey="name" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                          <YAxis tick={{ fontSize: 10 }} width={50} />
                          <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                          <Line type="monotone" dataKey="value" stroke="#07c160" strokeWidth={2} dot={false} />
                        </LineChart>
                      ) : (
                        <BarChart data={chartData}>
                          <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={50} />
                          <YAxis tick={{ fontSize: 10 }} width={50} />
                          <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                          <Bar dataKey="value" fill="#07c160" radius={[4, 4, 0, 0]} maxBarSize={32} />
                        </BarChart>
                      )}
                    </ResponsiveContainer>
                  </div>
                );
              })()}

              {resultView === 'table' && (
                result.columns.length === 0 ? (
                  <div className="text-center text-gray-300 py-6 text-sm">无结果</div>
                ) : (
                  <div className="dk-subtle dk-border bg-[#f8f9fb] rounded-2xl border border-gray-100 overflow-auto max-h-80">
                    <table className="w-full text-xs font-mono">
                      <thead className="sticky top-0 bg-[#f0f0f0] dark:bg-white/5">
                        <tr>
                          <th className="px-3 py-2 text-left text-gray-400 w-8 font-bold">#</th>
                          {result.columns.map((col) => (
                            <th key={col} className="px-3 py-2 text-left text-gray-600 font-bold whitespace-nowrap">{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(result.rows ?? []).map((row, ri) => (
                          <tr key={ri} className="border-t border-gray-100 dark:border-white/5 hover:bg-white dark:hover:bg-white/5 transition-colors">
                            <td className="px-3 py-1.5 text-gray-300">{ri + 1}</td>
                            {row.map((cell, ci) => (
                              <td key={ci} className="px-3 py-1.5 text-gray-700 max-w-[240px] truncate">
                                {renderCellValue(cell)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

// ─── 子组件：单个数据库行（可展开表列表）──────────────────────────────────────

interface DBRowProps {
  db: DBInfo;
  formatSize: (b: number) => string;
  onSelectTable: (dbName: string, tableName: string) => void;
}

const DBRow: React.FC<DBRowProps> = ({ db, formatSize, onSelectTable }) => {
  const [expanded, setExpanded] = useState(false);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tableSearch, setTableSearch] = useState('');
  const { copy, copiedKey } = useCopyable();

  const handleExpand = async () => {
    if (!expanded && tables.length === 0) {
      setLoading(true);
      setError(null);
      try {
        const data = await databaseApi.getTables(db.name);
        setTables(data || []);
      } catch (e: any) {
        setError(e?.message || 'Failed to load tables');
      } finally {
        setLoading(false);
      }
    }
    setExpanded(!expanded);
  };

  const filteredTables = tables.filter(t =>
    t.name.toLowerCase().includes(tableSearch.toLowerCase())
  );

  return (
    <>
      <tr
        className="border-b border-gray-100 dark:border-white/5 hover:bg-[#f8f9fb] dark:hover:bg-white/5 cursor-pointer select-none transition-colors"
        onClick={handleExpand}
      >
        <td className="px-6 py-4 w-8">
          {expanded
            ? <ChevronDown size={16} className="text-[#07c160]" />
            : <ChevronRight size={16} className="text-gray-400" />
          }
        </td>
        <td className="px-4 py-4">
          <button
            onClick={(e) => copy(db.name, `db:${db.name}`, e)}
            className="group/copy inline-flex items-center gap-1.5 font-bold text-[#1d1d1f] dk-text hover:text-[#07c160] transition-colors"
            title="点击复制"
          >
            {db.name}
            {copiedKey === `db:${db.name}`
              ? <Check size={12} className="text-[#07c160]" />
              : <Copy size={11} className="text-gray-300 opacity-0 group-hover/copy:opacity-100 transition-opacity" />
            }
          </button>
        </td>
        <td className="px-4 py-4">
          <span className="text-gray-600 font-medium">{formatSize(db.size)}</span>
        </td>
        <td className="px-4 py-4">
          <button
            onClick={(e) => copy(db.path, `path:${db.name}`, e)}
            className="group/copy inline-flex items-start gap-1.5 text-xs text-gray-400 font-mono break-all hover:text-[#07c160] text-left transition-colors"
            title="点击复制路径"
          >
            <span>{db.path}</span>
            {copiedKey === `path:${db.name}`
              ? <Check size={11} className="text-[#07c160] flex-shrink-0 mt-0.5" />
              : <Copy size={10} className="text-gray-300 flex-shrink-0 mt-0.5 opacity-0 group-hover/copy:opacity-100 transition-opacity" />
            }
          </button>
        </td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={4} className="bg-[#f8faf8] dark:bg-white/[0.03] px-6 pb-4 pt-2">
            {loading && (
              <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
                <Loader2 size={16} className="animate-spin text-[#07c160]" />
                加载表列表...
              </div>
            )}
            {error && (
              <div className="text-sm text-red-500 py-2">{error}</div>
            )}
            {!loading && !error && tables.length > 0 && (
              <div className="ml-4">
                {tables.length > 8 && (
                  <div className="flex items-center gap-2 mb-3 mt-1">
                    <Search size={14} className="text-gray-400" />
                    <input
                      type="text"
                      value={tableSearch}
                      onChange={(e) => setTableSearch(e.target.value)}
                      placeholder="过滤表名..."
                      className="text-sm border border-gray-200 dark:border-white/10 rounded-lg px-3 py-1.5 w-60 focus:outline-none focus:border-[#07c160] dk-input"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span className="text-xs text-gray-400">{filteredTables.length}/{tables.length} 张表</span>
                  </div>
                )}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                  {filteredTables.map((t) => (
                    <div
                      key={t.name}
                      className="flex items-center justify-between dk-card dk-border bg-white border border-gray-100 rounded-xl px-4 py-3 hover:border-[#07c160] hover:bg-[#f0faf4] dark:hover:bg-white/5 transition group cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectTable(db.name, t.name);
                      }}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <LayoutList size={14} className="text-gray-300 group-hover:text-[#07c160] flex-shrink-0" />
                        <span className="text-sm font-semibold text-[#1d1d1f] dk-text truncate">{t.name}</span>
                      </div>
                      <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                        <span className="text-xs text-gray-400">{t.row_count.toLocaleString()}</span>
                        <button
                          onClick={(e) => copy(t.name, `t:${db.name}:${t.name}`, e)}
                          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-white/10 text-gray-300 hover:text-[#07c160] opacity-0 group-hover:opacity-100 transition-all"
                          title="复制表名"
                        >
                          {copiedKey === `t:${db.name}:${t.name}`
                            ? <Check size={11} className="text-[#07c160]" />
                            : <Copy size={11} />
                          }
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!loading && !error && tables.length === 0 && (
              <p className="text-sm text-gray-400 py-3 ml-4">无表</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
};

// ─── 左栏：DB / 表树形导航 ──────────────────────────────────────────────────

interface SidebarProps {
  databases: DBInfo[];
  formatSize: (b: number) => string;
  onSelectTable: (dbName: string, tableName: string) => void;
  selectedTable: { dbName: string; tableName: string } | null;
}

const DBSidebar: React.FC<SidebarProps> = ({ databases, formatSize, onSelectTable, selectedTable }) => {
  const [expandedDB, setExpandedDB] = useState<string | null>(null);
  const [tables, setTables] = useState<Record<string, TableInfo[]>>({});
  const [tableSearch, setTableSearch] = useState('');
  const [loadingDB, setLoadingDB] = useState('');

  const handleToggle = async (dbName: string) => {
    if (expandedDB === dbName) { setExpandedDB(null); return; }
    setExpandedDB(dbName);
    if (!tables[dbName]) {
      setLoadingDB(dbName);
      try {
        const data = await databaseApi.getTables(dbName);
        setTables(prev => ({ ...prev, [dbName]: data || [] }));
      } catch {}
      setLoadingDB('');
    }
  };

  const DB_ICONS: Record<string, string> = { contact: '👤', message: '💬', ai: '🤖' };
  const totalSize = databases.reduce((s, d) => s + d.size, 0);

  return (
    <div className="flex flex-col h-full">
      {/* 搜索 */}
      <div className="px-3 py-2">
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300" />
          <input
            type="text"
            value={tableSearch}
            onChange={e => setTableSearch(e.target.value)}
            placeholder="搜索表名..."
            className="w-full pl-7 pr-2 py-1.5 text-xs border border-gray-200 dark:border-white/10 rounded-lg focus:outline-none focus:border-[#07c160] dk-input"
          />
        </div>
      </div>

      {/* 树 */}
      <div className="flex-1 overflow-y-auto px-1.5 pb-3">
        {databases.map((db, di) => {
          const isExpanded = expandedDB === db.name;
          const dbTables = (tables[db.name] ?? []).filter(t =>
            !tableSearch || t.name.toLowerCase().includes(tableSearch.toLowerCase())
          );
          return (
            <div key={db.name}>
              <button
                onClick={() => handleToggle(db.name)}
                className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-left text-xs font-semibold transition-colors ${
                  isExpanded ? 'bg-[#07c160]/5 text-[#07c160]' : 'text-[#1d1d1f] dk-text hover:bg-gray-50 dark:hover:bg-white/5'
                }`}
              >
                {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} className="text-gray-400" />}
                <span>{DB_ICONS[db.type] || '📁'}</span>
                <span className="flex-1 truncate">{db.name}</span>
                <span className="text-[10px] text-gray-400 font-mono">{formatSize(db.size)}</span>
              </button>
              {isExpanded && (
                <div className="ml-3 pl-2 border-l border-gray-100 dark:border-white/10">
                  {loadingDB === db.name ? (
                    <div className="flex items-center gap-1 px-2 py-2 text-[10px] text-gray-400">
                      <Loader2 size={10} className="animate-spin" /> 加载中...
                    </div>
                  ) : dbTables.length === 0 ? (
                    <div className="px-2 py-2 text-[10px] text-gray-300">{tableSearch ? '无匹配' : '无表'}</div>
                  ) : dbTables.map(t => {
                    const isActive = selectedTable?.dbName === db.name && selectedTable?.tableName === t.name;
                    return (
                      <button
                        key={t.name}
                        onClick={() => onSelectTable(db.name, t.name)}
                        className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-left text-xs transition-colors ${
                          isActive
                            ? 'bg-[#07c160] text-white font-bold'
                            : 'text-gray-600 dk-text hover:bg-gray-50 dark:hover:bg-white/5'
                        }`}
                      >
                        <LayoutList size={10} className={isActive ? 'text-white' : 'text-gray-300'} />
                        <span className="flex-1 truncate">{t.name}</span>
                        <span className={`text-[10px] font-mono ${isActive ? 'text-green-200' : 'text-gray-400'}`}>{t.row_count.toLocaleString()}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── 主组件 ──────────────────────────────────────────────────────────────────

type DBViewMode = 'full' | 'nl' | 'sql' | 'browse';
const VIEW_MODE_KEY = 'welink_db_view_mode_v1';

export const DatabaseView: React.FC = () => {
  const [databases, setDatabases] = useState<DBInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [selectedTable, setSelectedTable] = useState<{ dbName: string; tableName: string } | null>(null);
  const [showSQL, setShowSQL] = useState(false);
  const [viewMode, setViewMode] = useState<DBViewMode>(() => {
    try {
      const v = localStorage.getItem(VIEW_MODE_KEY) as DBViewMode | null;
      if (v && ['full', 'nl', 'sql', 'browse'].includes(v)) return v;
    } catch { /* ignore */ }
    return 'full';
  });
  const applyViewMode = (m: DBViewMode) => {
    setViewMode(m);
    try { localStorage.setItem(VIEW_MODE_KEY, m); } catch { /* ignore */ }
    if (m === 'sql') setShowSQL(true); // SQL 模式自动展开 SQL 编辑器
  };

  const showNL     = viewMode === 'full' || viewMode === 'nl';
  const showSQLRow = viewMode === 'full' || viewMode === 'sql';
  const showTable  = viewMode === 'full' || viewMode === 'browse' || !!selectedTable;

  useEffect(() => {
    const fetchDatabases = async () => {
      try {
        setLoading(true);
        const data = await databaseApi.getInfo();
        setDatabases(data || []);
        setError(null);
      } catch (err) {
        setError(err as Error);
      } finally {
        setLoading(false);
      }
    };
    fetchDatabases();
  }, []);

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <Database size={48} className="mx-auto text-gray-300 mb-4 animate-pulse" />
          <p className="text-gray-400 font-semibold">加载数据库信息...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-3xl p-12 text-center">
        <AlertCircle size={48} className="mx-auto text-red-500 mb-4" />
        <h3 className="text-xl font-bold text-red-900 mb-2">加载失败</h3>
        <p className="text-red-700">{error.message}</p>
      </div>
    );
  }

  return (
    <div className="flex gap-4" style={{ height: 'calc(100vh - 120px)' }}>
      {/* 左栏：DB 树形导航 */}
      <div className="w-56 flex-shrink-0 dk-card bg-white dk-border border border-gray-100 rounded-2xl overflow-hidden">
        <DBSidebar
          databases={databases}
          formatSize={formatSize}
          onSelectTable={(db, tbl) => setSelectedTable({ dbName: db, tableName: tbl })}
          selectedTable={selectedTable}
        />
      </div>

      {/* 右栏：工作区 */}
      <div className="flex-1 min-w-0 overflow-y-auto space-y-4">
        {/* 视图预设切换 */}
        <div className="flex items-center gap-1 bg-gray-100 dark:bg-white/5 rounded-full p-0.5 w-fit">
          {([
            ['full',   '完整'],
            ['nl',     '自然语言'],
            ['sql',    'SQL 模式'],
            ['browse', '浏览表'],
          ] as [DBViewMode, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => applyViewMode(key)}
              className={`px-3 py-1 rounded-full text-[11px] font-bold transition-all ${
                viewMode === key
                  ? 'bg-white dark:bg-[#1d1d1f] text-[#07c160] shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 自然语言查数据 */}
        {showNL && <NLQueryPanel />}

        {/* SQL 编辑器（折叠，点击展开） */}
        {showSQLRow && (
          <div>
            <button
              onClick={() => setShowSQL(v => !v)}
              className="flex items-center gap-2 text-xs font-bold text-gray-400 hover:text-[#07c160] transition-colors mb-2"
            >
              {showSQL ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <Terminal size={14} />
              SQL 编辑器（高级）
            </button>
            {showSQL && <SQLEditor databases={databases} />}
          </div>
        )}

        {/* 表数据面板（选中表后展示） */}
        {showTable && selectedTable && (
          <TablePanel
            dbName={selectedTable.dbName}
            tableName={selectedTable.tableName}
            onClose={() => setSelectedTable(null)}
          />
        )}
      </div>
    </div>
  );
};
