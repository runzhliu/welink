/**
 * 数据库管理视图组件 - 支持查看表结构和表数据
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Database, HardDrive, Table, FileText, AlertCircle,
  ChevronRight, ChevronDown, Loader2, ArrowLeft, ArrowRight,
  Hash, LayoutList, Search, Terminal, Play, Copy, Check
} from 'lucide-react';
import { databaseApi } from '../../services/api';
import type { DBInfo, TableInfo, ColumnInfo, TableData, QueryResult } from '../../types';

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
              ) : tableData && tableData.columns.length > 0 ? (
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
                        {tableData.rows.map((row, ri) => (
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleRun = async () => {
    if (!selectedDb || !sql.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const r = await databaseApi.query(selectedDb, sql.trim());
      setResult(r);
    } catch (e: any) {
      setResult({ columns: [], rows: [], error: e?.message || '查询失败' });
    } finally {
      setLoading(false);
    }
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
    const rows = result.rows.map(r => r.map(c => c ?? 'NULL').join('\t')).join('\n');
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
      <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 dark:border-white/5 bg-[#f8f9fb] dk-subtle">
        <Terminal size={18} className="text-[#07c160]" strokeWidth={2.5} />
        <h3 className="font-black text-[#1d1d1f] dk-text text-base">SQL 编辑器</h3>
        <span className="text-xs text-gray-400 ml-1">仅支持 SELECT / PRAGMA / EXPLAIN，最多返回 500 行</span>
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
                  {result.rows.length} 行 · {result.columns.length} 列
                  {result.rows.length >= 500 && <span className="text-orange-400 ml-1">（已截断至 500 行）</span>}
                </span>
                <button
                  onClick={copyResult}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-[#07c160] transition-colors"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? '已复制' : '复制'}
                </button>
              </div>
              {result.columns.length === 0 ? (
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
                      {result.rows.map((row, ri) => (
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
          <span className="font-bold text-[#1d1d1f] dk-text">{db.name}</span>
        </td>
        <td className="px-4 py-4">
          <span className="text-gray-600 font-medium">{formatSize(db.size)}</span>
        </td>
        <td className="px-4 py-4">
          <span className="text-xs text-gray-400 font-mono break-all">{db.path}</span>
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
                    <button
                      key={t.name}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectTable(db.name, t.name);
                      }}
                      className="flex items-center justify-between dk-card dk-border bg-white border border-gray-100 rounded-xl px-4 py-3 hover:border-[#07c160] hover:bg-[#f0faf4] dark:hover:bg-white/5 transition group text-left"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <LayoutList size={14} className="text-gray-300 group-hover:text-[#07c160] flex-shrink-0" />
                        <span className="text-sm font-semibold text-[#1d1d1f] dk-text truncate">{t.name}</span>
                      </div>
                      <span className="text-xs text-gray-400 ml-2 flex-shrink-0">
                        {t.row_count.toLocaleString()}
                      </span>
                    </button>
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

// ─── 主组件 ──────────────────────────────────────────────────────────────────

export const DatabaseView: React.FC = () => {
  const [databases, setDatabases] = useState<DBInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [selectedTable, setSelectedTable] = useState<{ dbName: string; tableName: string } | null>(null);

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

  const getTotalSize = () => databases.reduce((sum, db) => sum + db.size, 0);
  const contactDbs = databases.filter((db) => db.type === 'contact');
  const messageDbs = databases.filter((db) => db.type === 'message');

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

  const renderDBSection = (dbs: DBInfo[], label: string, icon: React.ReactNode, color: string) => {
    if (dbs.length === 0) return null;
    return (
      <div>
        <h2 className="text-2xl font-black text-[#1d1d1f] dk-text mb-6 flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
            {icon}
          </div>
          {label}
          <span className="text-gray-400 text-lg font-semibold ml-2">{dbs.length} 个文件</span>
        </h2>
        <div className="dk-card bg-white rounded-3xl dk-border border border-gray-100 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="dk-thead bg-[#f8f9fb] dk-border border-b border-gray-100">
                <th className="px-6 py-4 w-8" />
                <th className="px-4 py-4 text-left text-xs font-black text-gray-500 uppercase">名称</th>
                <th className="px-4 py-4 text-left text-xs font-black text-gray-500 uppercase">大小</th>
                <th className="px-4 py-4 text-left text-xs font-black text-gray-500 uppercase">路径</th>
              </tr>
            </thead>
            <tbody>
              {dbs.map((db, index) => (
                <DBRow
                  key={index}
                  db={db}
                  formatSize={formatSize}
                  onSelectTable={(dbName, tableName) => setSelectedTable({ dbName, tableName })}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-8">
      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gradient-to-br from-[#07c160] to-[#06ad56] text-white p-8 rounded-3xl shadow-lg">
          <Database size={32} className="mb-4" strokeWidth={2.5} />
          <p className="text-green-100 text-sm font-bold uppercase mb-2">数据库总数</p>
          <h3 className="text-5xl font-black">{databases.length}</h3>
        </div>
        <div className="bg-gradient-to-br from-[#10aeff] to-[#0e8dd6] text-white p-8 rounded-3xl shadow-lg">
          <HardDrive size={32} className="mb-4" strokeWidth={2.5} />
          <p className="text-blue-100 text-sm font-bold uppercase mb-2">总占用空间</p>
          <h3 className="text-5xl font-black">{formatSize(getTotalSize())}</h3>
        </div>
        <div className="bg-gradient-to-br from-[#576b95] to-[#4a5a7f] text-white p-8 rounded-3xl shadow-lg">
          <Table size={32} className="mb-4" strokeWidth={2.5} />
          <p className="text-purple-100 text-sm font-bold uppercase mb-2">消息数据库</p>
          <h3 className="text-5xl font-black">{messageDbs.length}</h3>
        </div>
      </div>

      <p className="text-sm text-gray-400 -mt-4">点击数据库行可展开查看表列表，点击表名可查看结构与数据</p>

      {/* SQL 编辑器 */}
      <SQLEditor databases={databases} />

      {renderDBSection(
        contactDbs,
        '联系人数据库',
        <FileText size={20} className="text-white" strokeWidth={2.5} />,
        'bg-[#07c160]'
      )}

      {renderDBSection(
        messageDbs,
        '消息数据库',
        <Database size={20} className="text-white" strokeWidth={2.5} />,
        'bg-[#10aeff]'
      )}

      {databases.length === 0 && (
        <div className="dk-card dk-border bg-white rounded-3xl border border-gray-100 p-20 text-center">
          <Database size={80} className="mx-auto text-gray-200 mb-6" />
          <h3 className="text-2xl font-black text-gray-300 mb-2">暂无数据库</h3>
          <p className="text-gray-400">请检查数据目录配置</p>
        </div>
      )}

      {selectedTable && (
        <TablePanel
          dbName={selectedTable.dbName}
          tableName={selectedTable.tableName}
          onClose={() => setSelectedTable(null)}
        />
      )}
    </div>
  );
};
