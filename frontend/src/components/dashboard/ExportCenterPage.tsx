/**
 * 导出中心 — 向导式流程：
 *   Step 1 · 选内容（2×2 内容卡，选中后展开内联筛选）
 *   Step 2 · 选目标（本地 / 云端分组，选中后内联展示配置表单）
 *   Step 3 · 预览 / 下载（只有 step 1+2 就绪才启用）
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Download, FileText, MessagesSquare, Bot, Brain,
  Eye, Loader2, ExternalLink, Check, X, HardDrive, Cloud,
} from 'lucide-react';
import { Header } from '../layout/Header';
import {
  exportApi,
  type ExportItem,
  type ExportTarget,
  type ExportPreviewDoc,
  type ExportResultItem,
  type ExportConfigDTO,
} from '../../services/api';
import type { ContactStats, GroupInfo } from '../../types';

interface ExportCenterPageProps {
  contacts: ContactStats[];
  groups: GroupInfo[];
}

interface SelectionState {
  yearReview: boolean;
  yearReviewYear: number; // 0 = 全部
  conversation: boolean;
  conversationTarget: string;
  conversationIsGroup: boolean;
  conversationFrom: string;
  conversationTo: string;
  aiHistory: boolean;
  aiHistoryKey: string;
  memory: boolean;
  memoryUsername: string;
  memoryIsGroup: boolean;
}

const HAS_KEY_PLACEHOLDER = '__HAS_KEY__';

const TARGET_META: Record<ExportTarget, { label: string; emoji: string; hint: string; group: 'local' | 'cloud' }> = {
  markdown: { label: 'Markdown 文件', emoji: '📝', hint: '直接下载 .md（多文件 → .zip）', group: 'local' },
  notion:   { label: 'Notion',        emoji: '📘', hint: '推送到指定 Page 下',          group: 'cloud' },
  feishu:   { label: '飞书文档',       emoji: '📒', hint: '导入到云空间',                group: 'cloud' },
  webdav:   { label: 'WebDAV',        emoji: '📡', hint: '坚果云 / Nextcloud / 群晖等',  group: 'cloud' },
  s3:       { label: 'S3 兼容',        emoji: '☁️', hint: 'AWS / R2 / OSS / COS / MinIO',group: 'cloud' },
  dropbox:  { label: 'Dropbox',       emoji: '📦', hint: 'App Console 长期 Token',      group: 'cloud' },
  gdrive:   { label: 'Google Drive',  emoji: '💾', hint: 'OAuth 2.0 授权',              group: 'cloud' },
  onedrive: { label: 'OneDrive',      emoji: '🪟', hint: 'Microsoft 账号（Entra ID）',  group: 'cloud' },
};

export const ExportCenterPage: React.FC<ExportCenterPageProps> = ({ contacts, groups }) => {
  const [target, setTarget] = useState<ExportTarget>('markdown');
  const [sel, setSel] = useState<SelectionState>({
    yearReview: true,
    yearReviewYear: 0,
    conversation: false,
    conversationTarget: '',
    conversationIsGroup: false,
    conversationFrom: '',
    conversationTo: '',
    aiHistory: false,
    aiHistoryKey: '',
    memory: false,
    memoryUsername: '',
    memoryIsGroup: false,
  });

  const [config, setConfig] = useState<ExportConfigDTO>({
    notion_token: '', notion_parent_page: '',
    feishu_app_id: '', feishu_app_secret: '', feishu_folder_token: '',
    webdav_url: '', webdav_username: '', webdav_password: '', webdav_path: '',
    s3_endpoint: '', s3_region: '', s3_bucket: '', s3_access_key: '', s3_secret_key: '', s3_path_prefix: '', s3_use_path_style: false,
    dropbox_token: '', dropbox_path: '',
    gdrive_client_id: '', gdrive_client_secret: '', gdrive_folder_id: '', gdrive_connected: false,
    onedrive_client_id: '', onedrive_client_secret: '', onedrive_tenant: 'common', onedrive_folder_path: '', onedrive_connected: false,
  });
  const [configLoaded, setConfigLoaded] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  const [previewDocs, setPreviewDocs] = useState<ExportPreviewDoc[] | null>(null);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [results, setResults] = useState<ExportResultItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sortedContacts = useMemo(() => [...contacts].sort((a, b) => b.total_messages - a.total_messages), [contacts]);
  const sortedGroups = useMemo(() => [...groups].sort((a, b) => b.total_messages - a.total_messages), [groups]);

  const yearOptions = useMemo(() => {
    let minYear = new Date().getFullYear();
    for (const c of contacts) {
      if (c.first_message_time && c.first_message_time.length >= 4) {
        const y = Number(c.first_message_time.slice(0, 4));
        if (y && y < minYear) minYear = y;
      }
    }
    const cur = new Date().getFullYear();
    const arr: number[] = [];
    for (let y = cur; y >= minYear; y--) arr.push(y);
    return arr;
  }, [contacts]);

  useEffect(() => {
    exportApi.getConfig()
      .then((c) => { setConfig(c); setConfigLoaded(true); })
      .catch(() => setConfigLoaded(true));
  }, []);

  const buildItems = (): ExportItem[] => {
    const items: ExportItem[] = [];
    if (sel.yearReview) {
      items.push({ type: 'year_review', year: sel.yearReviewYear || undefined });
    }
    if (sel.conversation && sel.conversationTarget) {
      const item: ExportItem = {
        type: 'conversation',
        username: sel.conversationTarget,
        is_group: sel.conversationIsGroup,
      };
      if (sel.conversationFrom) {
        const ts = Math.floor(new Date(sel.conversationFrom + 'T00:00:00').getTime() / 1000);
        if (!isNaN(ts)) item.from = ts;
      }
      if (sel.conversationTo) {
        const ts = Math.floor(new Date(sel.conversationTo + 'T23:59:59').getTime() / 1000);
        if (!isNaN(ts)) item.to = ts;
      }
      items.push(item);
    }
    if (sel.aiHistory && sel.aiHistoryKey) {
      items.push({ type: 'ai_history', ai_key: sel.aiHistoryKey });
    }
    if (sel.memory && sel.memoryUsername) {
      items.push({ type: 'memory_graph', username: sel.memoryUsername, is_group: sel.memoryIsGroup });
    }
    return items;
  };

  const itemCount = buildItems().length;
  const step1Done = itemCount > 0;
  const step2Done = !!target;

  const handlePreview = async () => {
    setError(null); setResults(null);
    const items = buildItems();
    if (items.length === 0) { setError('请至少选择一项内容'); return; }
    setPreviewing(true);
    try {
      const r = await exportApi.preview({ items, target });
      setPreviewDocs(r.docs);
      setPreviewIdx(0);
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || String(e));
    } finally {
      setPreviewing(false);
    }
  };

  const handleExport = async () => {
    setError(null); setResults(null);
    const items = buildItems();
    if (items.length === 0) { setError('请至少选择一项内容'); return; }
    setExporting(true);
    try {
      if (target === 'markdown') {
        const fname = await exportApi.downloadMarkdown({ items, target });
        setResults([{ title: fname, ok: true }]);
      } else if (target === 'notion') {
        setResults((await exportApi.pushNotion({ items, target })).results);
      } else if (target === 'feishu') {
        setResults((await exportApi.pushFeishu({ items, target })).results);
      } else if (target === 'webdav') {
        setResults((await exportApi.pushWebDAV({ items, target })).results);
      } else if (target === 's3') {
        setResults((await exportApi.pushS3({ items, target })).results);
      } else if (target === 'dropbox') {
        setResults((await exportApi.pushDropbox({ items, target })).results);
      } else if (target === 'gdrive') {
        setResults((await exportApi.pushGDrive({ items, target })).results);
      } else if (target === 'onedrive') {
        setResults((await exportApi.pushOneDrive({ items, target })).results);
      }
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || String(e));
    } finally {
      setExporting(false);
    }
  };

  const handleSaveConfig = async () => {
    setSavingConfig(true); setError(null);
    try {
      await exportApi.saveConfig(config);
      const c = await exportApi.getConfig();
      setConfig(c);
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || String(e));
    } finally {
      setSavingConfig(false);
    }
  };

  const cloudTargets: ExportTarget[] = ['notion', 'feishu', 'webdav', 's3', 'dropbox', 'gdrive', 'onedrive'];

  const actionLabel =
    target === 'markdown' ? '下载 Markdown'
    : target === 'notion' ? '推送到 Notion'
    : target === 'feishu' ? '推送到飞书'
    : target === 'webdav' ? '上传到 WebDAV'
    : target === 's3' ? '上传到 S3'
    : target === 'dropbox' ? '上传到 Dropbox'
    : target === 'gdrive' ? '上传到 Google Drive'
    : target === 'onedrive' ? '上传到 OneDrive'
    : '导出';

  return (
    <div>
      <Header title="导出中心" subtitle="把分析结果与聊天数据导出到本地或云端" />

      <div className="max-w-4xl mx-auto mt-4 space-y-6">
        {/* ─── Step 1 · 选内容 ─── */}
        <Step num={1} title="选择内容" hint="想导出哪些数据" done={step1Done}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <ContentCard
              icon={<FileText size={20} />}
              title="年度回顾报告"
              desc="一年的关系、话题、情绪总结"
              checked={sel.yearReview}
              onToggle={(v) => setSel((s) => ({ ...s, yearReview: v }))}
            >
              <FilterRow label="年份">
                <select
                  value={sel.yearReviewYear}
                  onChange={(e) => setSel((s) => ({ ...s, yearReviewYear: Number(e.target.value) }))}
                  className="text-sm bg-white dark:bg-white/10 border dk-border rounded-lg px-2 py-1"
                >
                  <option value={0}>全部年份</option>
                  {yearOptions.map((y) => (<option key={y} value={y}>{y}</option>))}
                </select>
              </FilterRow>
            </ContentCard>

            <ContentCard
              icon={<MessagesSquare size={20} />}
              title="对话归档"
              desc="原始聊天记录，按时间筛选"
              checked={sel.conversation}
              onToggle={(v) => setSel((s) => ({ ...s, conversation: v }))}
            >
              <div className="space-y-2">
                <FilterRow label="类型">
                  <select
                    value={sel.conversationIsGroup ? 'group' : 'contact'}
                    onChange={(e) => setSel((s) => ({ ...s, conversationIsGroup: e.target.value === 'group', conversationTarget: '' }))}
                    className="text-sm bg-white dark:bg-white/10 border dk-border rounded-lg px-2 py-1"
                  >
                    <option value="contact">联系人</option>
                    <option value="group">群聊</option>
                  </select>
                  <select
                    value={sel.conversationTarget}
                    onChange={(e) => setSel((s) => ({ ...s, conversationTarget: e.target.value }))}
                    className="text-sm bg-white dark:bg-white/10 border dk-border rounded-lg px-2 py-1 min-w-[160px] flex-1"
                  >
                    <option value="">选择对象...</option>
                    {(sel.conversationIsGroup ? sortedGroups : sortedContacts).map((c) => (
                      <option key={c.username} value={c.username}>
                        {(('remark' in c ? c.remark : '') || ('nickname' in c ? c.nickname : '') || ('name' in c ? c.name : '') || c.username)} ({c.total_messages})
                      </option>
                    ))}
                  </select>
                </FilterRow>
                <FilterRow label="时间">
                  <input type="date" value={sel.conversationFrom}
                    onChange={(e) => setSel((s) => ({ ...s, conversationFrom: e.target.value }))}
                    className="text-sm bg-white dark:bg-white/10 border dk-border rounded-lg px-2 py-1" />
                  <span className="text-xs text-gray-400">至</span>
                  <input type="date" value={sel.conversationTo}
                    onChange={(e) => setSel((s) => ({ ...s, conversationTo: e.target.value }))}
                    className="text-sm bg-white dark:bg-white/10 border dk-border rounded-lg px-2 py-1" />
                </FilterRow>
                <p className="text-[11px] text-gray-400">留空 = 全部时间 · 单次最多 50000 条</p>
              </div>
            </ContentCard>

            <ContentCard
              icon={<Bot size={20} />}
              title="AI 对话历史"
              desc="和 AI 聊过的分析记录"
              checked={sel.aiHistory}
              onToggle={(v) => setSel((s) => ({ ...s, aiHistory: v }))}
            >
              <FilterRow label="来源">
                <select
                  value={sel.aiHistoryKey}
                  onChange={(e) => setSel((s) => ({ ...s, aiHistoryKey: e.target.value }))}
                  className="text-sm bg-white dark:bg-white/10 border dk-border rounded-lg px-2 py-1 flex-1"
                >
                  <option value="">选择...</option>
                  {sortedContacts.map((c) => (
                    <option key={c.username} value={`contact:${c.username}`}>{(c.remark || c.nickname || c.username)}</option>
                  ))}
                  {sortedGroups.map((g) => (
                    <option key={g.username} value={`group:${g.username}`}>[群] {g.name || g.username}</option>
                  ))}
                  <option value="ai-home:cross_qa">AI 首页 · 跨联系人问答</option>
                </select>
              </FilterRow>
            </ContentCard>

            <ContentCard
              icon={<Brain size={20} />}
              title="记忆图谱"
              desc="AI 提炼的事实库"
              checked={sel.memory}
              onToggle={(v) => setSel((s) => ({ ...s, memory: v }))}
            >
              <FilterRow label="对象">
                <select
                  value={sel.memoryIsGroup ? 'group' : 'contact'}
                  onChange={(e) => setSel((s) => ({ ...s, memoryIsGroup: e.target.value === 'group', memoryUsername: '' }))}
                  className="text-sm bg-white dark:bg-white/10 border dk-border rounded-lg px-2 py-1"
                >
                  <option value="contact">联系人</option>
                  <option value="group">群聊</option>
                </select>
                <select
                  value={sel.memoryUsername}
                  onChange={(e) => setSel((s) => ({ ...s, memoryUsername: e.target.value }))}
                  className="text-sm bg-white dark:bg-white/10 border dk-border rounded-lg px-2 py-1 flex-1"
                >
                  <option value="">选择...</option>
                  {(sel.memoryIsGroup ? sortedGroups : sortedContacts).map((c) => (
                    <option key={c.username} value={c.username}>
                      {(('remark' in c ? c.remark : '') || ('nickname' in c ? c.nickname : '') || ('name' in c ? c.name : '') || c.username)}
                    </option>
                  ))}
                </select>
              </FilterRow>
              <p className="text-[11px] text-gray-400 mt-1">需先在 AI 页「构建记忆」才有内容</p>
            </ContentCard>
          </div>
        </Step>

        {/* ─── Step 2 · 选目标 ─── */}
        <Step num={2} title="选择导出目标" hint="发到哪里" done={step2Done} dimmed={!step1Done}>
          <div className="space-y-4">
            <div>
              <GroupLabel icon={<HardDrive size={12} />}>本地下载</GroupLabel>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <TargetCard target="markdown" selected={target === 'markdown'} onSelect={setTarget} />
              </div>
            </div>
            <div>
              <GroupLabel icon={<Cloud size={12} />}>云端同步</GroupLabel>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {cloudTargets.map(t => (
                  <TargetCard key={t} target={t} selected={target === t} onSelect={setTarget} />
                ))}
              </div>
            </div>
          </div>

          {/* 内联配置表单 */}
          {target !== 'markdown' && configLoaded && (
            <div className="mt-4">
              <InlineConfig
                target={target}
                config={config}
                setConfig={setConfig}
                savingConfig={savingConfig}
                onSave={handleSaveConfig}
              />
            </div>
          )}
        </Step>

        {/* ─── Step 3 · 操作 ─── */}
        <Step num={3} title="预览 / 下载" hint="" done={false} dimmed={!step1Done}>
          <div className="bg-white dark:bg-white/5 dk-border border rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500">
                已选 <span className="font-bold text-[#07c160]">{itemCount}</span> 项内容
                <span className="mx-2 text-gray-300">→</span>
                <span className="font-semibold">{TARGET_META[target].emoji} {TARGET_META[target].label}</span>
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                onClick={handlePreview}
                disabled={previewing || itemCount === 0}
                className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-sm font-semibold transition disabled:opacity-40"
              >
                {previewing ? <Loader2 size={15} className="animate-spin" /> : <Eye size={15} />}
                预览 Markdown
              </button>
              <button
                onClick={handleExport}
                disabled={exporting || itemCount === 0}
                className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#07c160] hover:bg-[#06ad55] text-white text-sm font-semibold transition disabled:opacity-40"
              >
                {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                {actionLabel}
              </button>
            </div>
            {error && (
              <div className="text-xs text-red-500 bg-red-50 dark:bg-red-500/10 rounded-lg p-2 break-all">{error}</div>
            )}
          </div>
        </Step>

        {/* 结果 */}
        {results && (
          <div className="bg-white dark:bg-white/5 dk-border border rounded-2xl p-4">
            <h3 className="text-sm font-semibold mb-3">导出结果</h3>
            <ul className="space-y-2">
              {results.map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  {r.ok ? <Check size={16} className="text-[#07c160] mt-0.5 flex-shrink-0" /> : <X size={16} className="text-red-500 mt-0.5 flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{r.title}</div>
                    {r.url && (
                      <a href={r.url} target="_blank" rel="noreferrer" className="text-xs text-[#07c160] hover:underline inline-flex items-center gap-1">
                        <ExternalLink size={11} /> {r.url}
                      </a>
                    )}
                    {r.error && <div className="text-xs text-red-500 break-all">{r.error}</div>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 预览 */}
        {previewDocs && previewDocs.length > 0 && (
          <div className="bg-white dark:bg-white/5 dk-border border rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">预览（{previewIdx + 1} / {previewDocs.length}）</h3>
              <div className="flex items-center gap-1">
                {previewDocs.length > 1 && (
                  <>
                    <button onClick={() => setPreviewIdx((i) => Math.max(0, i - 1))} className="px-2 py-1 text-xs rounded bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20">上一份</button>
                    <button onClick={() => setPreviewIdx((i) => Math.min(previewDocs.length - 1, i + 1))} className="px-2 py-1 text-xs rounded bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20">下一份</button>
                  </>
                )}
                <button onClick={() => setPreviewDocs(null)} className="px-2 py-1 text-xs rounded bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20">关闭</button>
              </div>
            </div>
            <div className="text-xs text-gray-500 mb-2">{previewDocs[previewIdx].filename}</div>
            <pre className="bg-gray-50 dark:bg-black/40 rounded-lg p-3 text-xs overflow-x-auto max-h-[500px] whitespace-pre-wrap font-mono">{previewDocs[previewIdx].markdown}</pre>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── 向导 Section ─────────────────────────────────────────────────────────

const Step: React.FC<{
  num: number; title: string; hint: string; done: boolean; dimmed?: boolean; children: React.ReactNode;
}> = ({ num, title, hint, done, dimmed, children }) => (
  <section className={dimmed ? 'opacity-60' : ''}>
    <div className="flex items-center gap-3 mb-3">
      <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-black ${
        done ? 'bg-[#07c160] text-white' : 'bg-gray-200 dark:bg-white/10 text-gray-500 dk-text'
      }`}>
        {done ? <Check size={14} /> : num}
      </div>
      <div>
        <h2 className="text-base font-bold">{title}</h2>
        {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      </div>
    </div>
    <div className={dimmed ? 'pointer-events-none' : ''}>{children}</div>
  </section>
);

const GroupLabel: React.FC<{ icon?: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
  <div className="flex items-center gap-1.5 text-[11px] font-black text-gray-400 uppercase tracking-widest mb-2">
    {icon}{children}
  </div>
);

// ─── ContentCard ─────────────────────────────────────────────────────────

const ContentCard: React.FC<{
  icon: React.ReactNode;
  title: string;
  desc: string;
  checked: boolean;
  onToggle: (v: boolean) => void;
  children?: React.ReactNode;
}> = ({ icon, title, desc, checked, onToggle, children }) => (
  <div className={`bg-white dark:bg-white/5 border-2 rounded-2xl transition-all ${
    checked ? 'border-[#07c160] shadow-sm shadow-[#07c160]/10' : 'dk-border hover:border-gray-300 dark:hover:border-white/20'
  }`}>
    <button
      type="button"
      onClick={() => onToggle(!checked)}
      className="w-full p-4 flex items-start gap-3 text-left"
    >
      <div className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${
        checked ? 'bg-[#07c160] text-white' : 'bg-gray-100 dark:bg-white/10 text-gray-500'
      }`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold text-[#1d1d1f] dk-text">{title}</div>
        <div className="text-xs text-gray-500 mt-0.5">{desc}</div>
      </div>
      <div className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition ${
        checked ? 'border-[#07c160] bg-[#07c160]' : 'border-gray-300 dark:border-white/20'
      }`}>
        {checked && <Check size={12} className="text-white" />}
      </div>
    </button>
    {checked && children && (
      <div className="px-4 pb-4 pt-0 border-t border-gray-100 dark:border-white/5 mt-1">
        <div className="pt-3 space-y-2">{children}</div>
      </div>
    )}
  </div>
);

const FilterRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-center gap-2 flex-wrap">
    <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider flex-shrink-0 w-12">{label}</span>
    {children}
  </div>
);

// ─── TargetCard ──────────────────────────────────────────────────────────

const TargetCard: React.FC<{
  target: ExportTarget;
  selected: boolean;
  onSelect: (t: ExportTarget) => void;
}> = ({ target, selected, onSelect }) => {
  const meta = TARGET_META[target];
  return (
    <button
      type="button"
      onClick={() => onSelect(target)}
      className={`relative p-3 rounded-xl border-2 text-left transition-all ${
        selected
          ? 'border-[#07c160] bg-[#f0faf4] dark:bg-[#07c160]/10 shadow-sm shadow-[#07c160]/10'
          : 'dk-border bg-white dark:bg-white/5 hover:border-gray-300 dark:hover:border-white/20'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="text-xl flex-shrink-0">{meta.emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-[#1d1d1f] dk-text truncate">{meta.label}</div>
          <div className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{meta.hint}</div>
        </div>
      </div>
      {selected && (
        <div className="absolute top-2 right-2 w-4 h-4 rounded-full bg-[#07c160] flex items-center justify-center">
          <Check size={10} className="text-white" />
        </div>
      )}
    </button>
  );
};

// ─── InlineConfig ────────────────────────────────────────────────────────

const InlineConfig: React.FC<{
  target: ExportTarget;
  config: ExportConfigDTO;
  setConfig: React.Dispatch<React.SetStateAction<ExportConfigDTO>>;
  savingConfig: boolean;
  onSave: () => void;
}> = ({ target, config, setConfig, savingConfig, onSave }) => (
  <div className="bg-gray-50 dark:bg-white/5 border dk-border rounded-2xl p-4">
    <h3 className="text-sm font-bold mb-3">{TARGET_META[target].emoji} {TARGET_META[target].label} · 配置</h3>

    {target === 'notion' && (
      <div className="space-y-2">
        <FormField label="Integration Token">
          <input type="password"
            value={config.notion_token === HAS_KEY_PLACEHOLDER ? '' : config.notion_token}
            placeholder={config.notion_token === HAS_KEY_PLACEHOLDER ? '已保存（留空保留）' : 'secret_xxx'}
            onChange={(e) => setConfig((c) => ({ ...c, notion_token: e.target.value }))}
            className="w-full text-sm bg-white dark:bg-white/10 border dk-border rounded-lg px-2 py-1" />
        </FormField>
        <FormField label="父 Page ID 或 URL">
          <input type="text" value={config.notion_parent_page} placeholder="可粘贴整条 Page URL"
            onChange={(e) => setConfig((c) => ({ ...c, notion_parent_page: e.target.value }))}
            className="w-full text-sm bg-white dark:bg-white/10 border dk-border rounded-lg px-2 py-1" />
        </FormField>
        <p className="text-[11px] text-gray-400">Notion 创建 Internal Integration → 目标 Page 的 ··· → Connections 加上它。</p>
        <SaveBtn loading={savingConfig} onClick={onSave} />
      </div>
    )}

    {target === 'feishu' && (
      <div className="space-y-2">
        <FormField label="App ID">
          <input type="text" value={config.feishu_app_id} placeholder="cli_xxxxx"
            onChange={(e) => setConfig((c) => ({ ...c, feishu_app_id: e.target.value }))}
            className="w-full text-sm bg-white dark:bg-white/10 border dk-border rounded-lg px-2 py-1" />
        </FormField>
        <FormField label="App Secret">
          <input type="password"
            value={config.feishu_app_secret === HAS_KEY_PLACEHOLDER ? '' : config.feishu_app_secret}
            placeholder={config.feishu_app_secret === HAS_KEY_PLACEHOLDER ? '已保存（留空保留）' : ''}
            onChange={(e) => setConfig((c) => ({ ...c, feishu_app_secret: e.target.value }))}
            className="w-full text-sm bg-white dark:bg-white/10 border dk-border rounded-lg px-2 py-1" />
        </FormField>
        <FormField label="目标文件夹 Token（可选）">
          <input type="text" value={config.feishu_folder_token} placeholder="留空 = 我的空间根目录"
            onChange={(e) => setConfig((c) => ({ ...c, feishu_folder_token: e.target.value }))}
            className="w-full text-sm bg-white dark:bg-white/10 border dk-border rounded-lg px-2 py-1" />
        </FormField>
        <p className="text-[11px] text-gray-400">自建应用，启用「云文档 · 上传/导入」权限。</p>
        <SaveBtn loading={savingConfig} onClick={onSave} />
      </div>
    )}

    {target === 'webdav' && (
      <div className="space-y-2">
        <FormField label="服务器 URL">
          <input type="text" value={config.webdav_url} placeholder="https://dav.jianguoyun.com/dav/"
            onChange={(e) => setConfig((c) => ({ ...c, webdav_url: e.target.value }))}
            className="w-full text-sm bg-white dark:bg-white/10 border dk-border rounded-lg px-2 py-1" />
        </FormField>
        <FormField label="用户名">
          <input type="text" value={config.webdav_username}
            onChange={(e) => setConfig((c) => ({ ...c, webdav_username: e.target.value }))}
            className="w-full text-sm bg-white dark:bg-white/10 border dk-border rounded-lg px-2 py-1" />
        </FormField>
        <FormField label="应用密码">
          <input type="password"
            value={config.webdav_password === HAS_KEY_PLACEHOLDER ? '' : config.webdav_password}
            placeholder={config.webdav_password === HAS_KEY_PLACEHOLDER ? '已保存（留空保留）' : ''}
            onChange={(e) => setConfig((c) => ({ ...c, webdav_password: e.target.value }))}
            className="w-full text-sm bg-white dark:bg-white/10 border dk-border rounded-lg px-2 py-1" />
        </FormField>
        <FormField label="上传路径前缀（可选）">
          <input type="text" value={config.webdav_path} placeholder="WeLink-Export/"
            onChange={(e) => setConfig((c) => ({ ...c, webdav_path: e.target.value }))}
            className="w-full text-sm bg-white dark:bg-white/10 border dk-border rounded-lg px-2 py-1" />
        </FormField>
        <p className="text-[11px] text-gray-400">坚果云「账户信息 → 安全选项」生成应用密码；Nextcloud 用 App Password。</p>
        <SaveBtn loading={savingConfig} onClick={onSave} />
      </div>
    )}

    {target === 's3' && (
      <div className="space-y-2">
        <FormField label="Endpoint（留空=AWS）">
          <input type="text" value={config.s3_endpoint}
            placeholder="s3.amazonaws.com / oss-cn-hangzhou.aliyuncs.com / cos.ap-guangzhou.myqcloud.com"
            onChange={(e) => setConfig((c) => ({ ...c, s3_endpoint: e.target.value }))}
            className="w-full text-sm bg-white dark:bg-white/10 border dk-border rounded-lg px-2 py-1" />
        </FormField>
        <div className="grid grid-cols-2 gap-2">
          <FormField label="Region">
            <input type="text" value={config.s3_region} placeholder="us-east-1 / auto"
              onChange={(e) => setConfig((c) => ({ ...c, s3_region: e.target.value }))}
              className="w-full text-sm bg-white dark:bg-white/10 border dk-border rounded-lg px-2 py-1" />
          </FormField>
          <FormField label="Bucket">
            <input type="text" value={config.s3_bucket}
              onChange={(e) => setConfig((c) => ({ ...c, s3_bucket: e.target.value }))}
              className="w-full text-sm bg-white dark:bg-white/10 border dk-border rounded-lg px-2 py-1" />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <FormField label="Access Key">
            <input type="text" value={config.s3_access_key}
              onChange={(e) => setConfig((c) => ({ ...c, s3_access_key: e.target.value }))}
              className="w-full text-sm bg-white dark:bg-white/10 border dk-border rounded-lg px-2 py-1" />
          </FormField>
          <FormField label="Secret Key">
            <input type="password"
              value={config.s3_secret_key === HAS_KEY_PLACEHOLDER ? '' : config.s3_secret_key}
              placeholder={config.s3_secret_key === HAS_KEY_PLACEHOLDER ? '已保存（留空保留）' : ''}
              onChange={(e) => setConfig((c) => ({ ...c, s3_secret_key: e.target.value }))}
              className="w-full text-sm bg-white dark:bg-white/10 border dk-border rounded-lg px-2 py-1" />
          </FormField>
        </div>
        <FormField label="路径前缀（可选）">
          <input type="text" value={config.s3_path_prefix} placeholder="welink-export/"
            onChange={(e) => setConfig((c) => ({ ...c, s3_path_prefix: e.target.value }))}
            className="w-full text-sm bg-white dark:bg-white/10 border dk-border rounded-lg px-2 py-1" />
        </FormField>
        <label className="flex items-center gap-2 text-xs text-gray-500 mt-1">
          <input type="checkbox" checked={config.s3_use_path_style}
            onChange={(e) => setConfig((c) => ({ ...c, s3_use_path_style: e.target.checked }))} />
          使用 Path-style URL（MinIO / R2 / 七牛建议勾选）
        </label>
        <SaveBtn loading={savingConfig} onClick={onSave} />
      </div>
    )}

    {target === 'dropbox' && (
      <div className="space-y-2">
        <FormField label="Access Token">
          <input type="password"
            value={config.dropbox_token === HAS_KEY_PLACEHOLDER ? '' : config.dropbox_token}
            placeholder={config.dropbox_token === HAS_KEY_PLACEHOLDER ? '已保存（留空保留）' : 'sl.xxx'}
            onChange={(e) => setConfig((c) => ({ ...c, dropbox_token: e.target.value }))}
            className="w-full text-sm bg-white dark:bg-white/10 border dk-border rounded-lg px-2 py-1" />
        </FormField>
        <FormField label="上传路径（可选）">
          <input type="text" value={config.dropbox_path} placeholder="/Apps/WeLink/"
            onChange={(e) => setConfig((c) => ({ ...c, dropbox_path: e.target.value }))}
            className="w-full text-sm bg-white dark:bg-white/10 border dk-border rounded-lg px-2 py-1" />
        </FormField>
        <p className="text-[11px] text-gray-400">Dropbox App Console → Create app → 生成长期 access token。</p>
        <SaveBtn loading={savingConfig} onClick={onSave} />
      </div>
    )}

    {target === 'gdrive' && (
      <div className="space-y-2">
        <FormField label="OAuth Client ID">
          <input type="text" value={config.gdrive_client_id} placeholder="xxxxx.apps.googleusercontent.com"
            onChange={(e) => setConfig((c) => ({ ...c, gdrive_client_id: e.target.value }))}
            className="w-full text-sm bg-white dark:bg-white/10 border dk-border rounded-lg px-2 py-1" />
        </FormField>
        <FormField label="OAuth Client Secret">
          <input type="password"
            value={config.gdrive_client_secret === HAS_KEY_PLACEHOLDER ? '' : config.gdrive_client_secret}
            placeholder={config.gdrive_client_secret === HAS_KEY_PLACEHOLDER ? '已保存（留空保留）' : ''}
            onChange={(e) => setConfig((c) => ({ ...c, gdrive_client_secret: e.target.value }))}
            className="w-full text-sm bg-white dark:bg-white/10 border dk-border rounded-lg px-2 py-1" />
        </FormField>
        <FormField label="目标文件夹 ID（可选）">
          <input type="text" value={config.gdrive_folder_id} placeholder="留空=根目录"
            onChange={(e) => setConfig((c) => ({ ...c, gdrive_folder_id: e.target.value }))}
            className="w-full text-sm bg-white dark:bg-white/10 border dk-border rounded-lg px-2 py-1" />
        </FormField>
        <p className="text-[11px] text-gray-400">Google Cloud Console 创建 OAuth 2.0，redirect URI 填 <code className="text-[10px] bg-white/50 dark:bg-black/30 px-1 rounded">http://127.0.0.1:&lt;PORT&gt;/api/export/oauth/gdrive/callback</code>（本地）或 <code className="text-[10px] bg-white/50 dark:bg-black/30 px-1 rounded">https://&lt;你的域名&gt;/api/export/oauth/gdrive/callback</code>（反代，需设 <code className="text-[10px] bg-white/50 dark:bg-black/30 px-1 rounded">WELINK_PUBLIC_URL</code>）。保存后点「授权」。</p>
        <div className="flex gap-2">
          <SaveBtn loading={savingConfig} onClick={onSave} />
          <a href="/api/export/oauth/gdrive/start" target="_blank" rel="noopener noreferrer"
            className={`flex-1 text-center text-xs py-1.5 rounded-lg font-semibold transition ${
              config.gdrive_connected ? 'bg-[#07c160]/10 text-[#07c160] hover:bg-[#07c160]/20' : 'bg-[#576b95] text-white hover:bg-[#3d5a8f]'
            }`}>
            {config.gdrive_connected ? '✓ 已授权 · 重新授权' : '授权'}
          </a>
        </div>
      </div>
    )}

    {target === 'onedrive' && (
      <div className="space-y-2">
        <FormField label="Client ID">
          <input type="text" value={config.onedrive_client_id} placeholder="Azure App Registration 的 Application (client) ID"
            onChange={(e) => setConfig((c) => ({ ...c, onedrive_client_id: e.target.value }))}
            className="w-full text-sm bg-white dark:bg-white/10 border dk-border rounded-lg px-2 py-1" />
        </FormField>
        <FormField label="Client Secret（个人账号可留空）">
          <input type="password"
            value={config.onedrive_client_secret === HAS_KEY_PLACEHOLDER ? '' : config.onedrive_client_secret}
            placeholder={config.onedrive_client_secret === HAS_KEY_PLACEHOLDER ? '已保存（留空保留）' : ''}
            onChange={(e) => setConfig((c) => ({ ...c, onedrive_client_secret: e.target.value }))}
            className="w-full text-sm bg-white dark:bg-white/10 border dk-border rounded-lg px-2 py-1" />
        </FormField>
        <div className="grid grid-cols-2 gap-2">
          <FormField label="Tenant">
            <input type="text" value={config.onedrive_tenant} placeholder="common / consumers"
              onChange={(e) => setConfig((c) => ({ ...c, onedrive_tenant: e.target.value }))}
              className="w-full text-sm bg-white dark:bg-white/10 border dk-border rounded-lg px-2 py-1" />
          </FormField>
          <FormField label="文件夹路径">
            <input type="text" value={config.onedrive_folder_path} placeholder="WeLink-Export"
              onChange={(e) => setConfig((c) => ({ ...c, onedrive_folder_path: e.target.value }))}
              className="w-full text-sm bg-white dark:bg-white/10 border dk-border rounded-lg px-2 py-1" />
          </FormField>
        </div>
        <p className="text-[11px] text-gray-400">Azure Portal → App registrations → 新建应用，Redirect URI <code className="text-[10px] bg-white/50 dark:bg-black/30 px-1 rounded">http://127.0.0.1:&lt;PORT&gt;/api/export/oauth/onedrive/callback</code>（本地）或 <code className="text-[10px] bg-white/50 dark:bg-black/30 px-1 rounded">https://&lt;你的域名&gt;/api/export/oauth/onedrive/callback</code>（反代，需设 <code className="text-[10px] bg-white/50 dark:bg-black/30 px-1 rounded">WELINK_PUBLIC_URL</code>）。权限勾 Files.ReadWrite（delegated）。</p>
        <div className="flex gap-2">
          <SaveBtn loading={savingConfig} onClick={onSave} />
          <a href="/api/export/oauth/onedrive/start" target="_blank" rel="noopener noreferrer"
            className={`flex-1 text-center text-xs py-1.5 rounded-lg font-semibold transition ${
              config.onedrive_connected ? 'bg-[#07c160]/10 text-[#07c160] hover:bg-[#07c160]/20' : 'bg-[#576b95] text-white hover:bg-[#3d5a8f]'
            }`}>
            {config.onedrive_connected ? '✓ 已授权 · 重新授权' : '授权'}
          </a>
        </div>
      </div>
    )}
  </div>
);

const FormField: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label className="block text-xs text-gray-500 mb-1">{label}</label>
    {children}
  </div>
);

const SaveBtn: React.FC<{ loading: boolean; onClick: () => void }> = ({ loading, onClick }) => (
  <button
    onClick={onClick}
    disabled={loading}
    className="flex-1 flex items-center justify-center gap-2 py-1.5 rounded-lg bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-xs font-semibold transition disabled:opacity-50"
  >
    {loading ? <Loader2 size={12} className="animate-spin" /> : null}
    保存配置
  </button>
);
