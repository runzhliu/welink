import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Bot, Copy, Loader2, ShieldCheck } from 'lucide-react';
import type { ContactStats, GroupInfo } from '../../../types';
import { agentAccessApi, type AgentAccessStatus } from '../../../services/agentAccessApi';
import { sftApi } from '../../../services/sftApi';
import { Dialog } from '../../common/Dialog';

interface Props { contacts: ContactStats[]; groups: GroupInfo[]; demo: boolean; privacyMode: boolean }

export const AgentAccessSection: React.FC<Props> = ({ contacts, groups, demo, privacyMode }) => {
  const [status, setStatus] = useState<AgentAccessStatus | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [allowDay, setAllowDay] = useState(false);
  const [allowSearch, setAllowSearch] = useState(false);
  const [hours, setHours] = useState(168);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState<'create' | 'revoke' | null>(null);
  const [secret, setSecret] = useState('');
  const [locked, setLocked] = useState(false);
  const [pin, setPin] = useState('');
  const options = useMemo(() => {
    const all = [
      ...contacts.filter(c => c.username).map(c => ({ id: c.username, label: c.remark || c.nickname || c.username, kind: '私聊' })),
      ...groups.filter(g => g.username).map(g => ({ id: g.username, label: g.name || g.username, kind: '群聊' })),
    ];
    return Array.from(new Map(all.map(item => [item.id, item])).values());
  }, [contacts, groups]);
  const matches = options.filter(item => `${item.label} ${item.id}`.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 30);
  const actions = ['dates', ...(allowDay ? ['day'] : []), ...(allowSearch ? ['search'] : [])];

  const handleError = useCallback((e: unknown) => {
    if (axios.isAxiosError(e) && e.response?.status === 423) { setLocked(true); return; }
    setError(axios.isAxiosError(e) ? e.response?.data?.error || '无法连接授权服务' : e instanceof Error ? e.message : '操作失败');
  }, []);
  const refresh = useCallback(async () => { setStatus(await agentAccessApi.status()); }, []);
  useEffect(() => { if (!demo) void refresh().catch(handleError); }, [demo, refresh, handleError]);

  const create = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await agentAccessApi.create(selected, actions, hours);
      // Retain the one-time credential even if the subsequent status refresh fails.
      setSecret(result.token);
      setStatus({ state: 'active', conversations: selected, actions, expires_at: result.expires_at });
      setConfirm(null);
    } catch (e) { setConfirm(null); handleError(e); }
    finally { setBusy(false); }
  };
  const revoke = async () => {
    setBusy(true); setError(''); setNotice('');
    try { await agentAccessApi.revoke(); setSecret(''); setStatus({ state: 'none' }); setConfirm(null); setNotice('授权已撤销，旧凭据无法继续查询。'); }
    catch (e) { setConfirm(null); handleError(e); }
    finally { setBusy(false); }
  };
  const unlock = async () => {
    setBusy(true); setError('');
    try { await sftApi.unlock(pin); setPin(''); setLocked(false); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : '解锁失败'); }
    finally { setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(secret); setNotice('凭据已复制，请保存到 DSH 的受保护文件。'); }
    catch { setError('无法复制，请手动保存凭据。'); }
  };
  const stateText: Record<AgentAccessStatus['state'], string> = {
    none: '尚未授权', active: '授权有效', expired: '授权已过期', legacy: '旧版授权未绑定当前账号', invalid: '授权文件无法读取', other_account: '授权属于其他数据账号',
  };
  const actionNames: Record<string, string> = { dates: '查看日期', day: '读取当天消息', search: '搜索消息' };

  return <section className="mb-8" data-section-id="agent" data-settings-tags="DSH Agent 授权 只读 插件">
    <div className="flex items-center gap-2 mb-3"><Bot size={18} className="text-[var(--accent-text)]" /><h3 className="text-base font-semibold dk-text">连接 AI Agent</h3></div>
    <p className="text-sm text-[var(--text-secondary)] mb-4">为 DSH 等工具创建单个、限时的只读授权。聊天原文默认不开放。</p>
    <div className="dk-card dk-border border rounded-xl p-5 space-y-4">
      {demo ? <p className="text-sm text-[var(--text-secondary)]">公开演示仅展示功能，不支持创建 Agent 授权。</p> : <>
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {notice && <p role="status" className="text-sm text-[var(--accent-text)]">{notice}</p>}
        {!status && !locked && (error ? <button type="button" className="ui-button ui-button-secondary" onClick={() => { setError(''); void refresh().catch(handleError); }}>重试</button> : <p className="text-sm text-[var(--text-secondary)]">正在读取授权状态…</p>)}
        {status && <div className="flex flex-wrap items-center gap-3 text-sm"><ShieldCheck size={16} /><strong>{stateText[status.state]}</strong>{status.expires_at && <span className="text-[var(--text-secondary)]">到期：{new Date(status.expires_at).toLocaleString()}</span>}</div>}
        {status && status.state !== 'none' && <>
          {status.state !== 'other_account' && status.state !== 'invalid' && <p className="text-sm text-[var(--text-secondary)]">已授权 {status.conversations?.length || 0} 个会话；权限：{(status.actions || []).map(a => actionNames[a] || '未知操作').join('、') || '未知'}。</p>}
          {status.state === 'active' && <><p className="text-xs text-[var(--text-secondary)]">授权有效不代表 DSH 已连接。还需在 DSH 插件配置中填写同一会话白名单和 WeLink 服务地址；容器内的 127.0.0.1 指向容器自身。</p><label className="block text-xs font-semibold" htmlFor="agent-allowed-conversations">DSH 会话白名单（JSON）</label><input id="agent-allowed-conversations" className={`dk-input w-full ${privacyMode ? 'privacy-blur' : ''}`} readOnly value={JSON.stringify(status.conversations || [])} /><p className="text-xs text-[var(--text-secondary)]">将以上 JSON 配置为 allowedConversations（或 WELINK_ALLOWED_CONVERSATIONS）；需要访问原文时还需启用 allowMessages。</p></>}
          {status.state === 'legacy' && <p className="text-sm text-amber-600">旧授权不会自动绑定账号；撤销后重新创建可启用账号隔离。</p>}
          <button type="button" className="ui-button ui-button-secondary" disabled={busy} onClick={() => setConfirm('revoke')}>撤销当前授权</button>
        </>}
        {status?.state === 'none' && <>
          <label className="block text-sm font-semibold" htmlFor="agent-conversation-search">选择会话</label>
          <input id="agent-conversation-search" className="dk-input w-full" value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索联系人或群聊" />
          <p className="text-xs text-[var(--text-secondary)]">已选择 {selected.length} 个，最多 50 个；列表最多显示前 30 项，可搜索更多。</p>
          <div className="max-h-48 overflow-y-auto border dk-border rounded-lg p-2 space-y-1">
            {matches.map(item => <label key={item.id} className="flex items-center gap-2 text-sm p-1"><input type="checkbox" checked={selected.includes(item.id)} disabled={!selected.includes(item.id) && selected.length >= 50} onChange={e => setSelected(current => e.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} /><span className={privacyMode ? 'privacy-blur' : ''}>{item.label}</span><span className="text-xs text-[var(--text-muted)]">{item.kind}</span></label>)}
            {!matches.length && <p className="text-xs text-[var(--text-secondary)] p-1">没有匹配的会话，请先完成索引或调整搜索词。</p>}
          </div>
          <fieldset className="space-y-2 text-sm"><legend className="font-semibold mb-2">允许的操作</legend><p>✓ 查看有聊天记录的日期</p><label className="flex gap-2"><input type="checkbox" checked={allowDay} onChange={e => setAllowDay(e.target.checked)} />读取指定日期的消息原文</label><label className="flex gap-2"><input type="checkbox" checked={allowSearch} onChange={e => setAllowSearch(e.target.checked)} />按关键词搜索消息原文</label></fieldset>
          <label className="block text-sm font-semibold" htmlFor="agent-expiry">授权有效期</label>
          <select id="agent-expiry" className="dk-input" value={hours} onChange={e => setHours(Number(e.target.value))}><option value={24}>1 天</option><option value={168}>7 天</option><option value={720}>30 天</option></select>
          <p className="text-xs text-[var(--text-secondary)]">DSH 可能保存查询结果；使用远程模型时，返回的内容可能发送给所选服务。</p>
          <button type="button" className="ui-button ui-button-primary" disabled={!selected.length || busy} onClick={() => setConfirm('create')}>检查并创建授权</button>
        </>}
        {secret && <div className="border dk-border rounded-lg p-4 space-y-3"><strong className="text-sm">一次性凭据</strong><p className="text-xs text-[var(--text-secondary)]">只显示这一次。请保存到 DSH 运行环境中仅本人可读的文件，再设置 WELINK_TOKEN_FILE 为该文件的绝对路径。不要粘贴到聊天或分享截图。</p><input aria-label="一次性 Agent 凭据" type="password" readOnly value={secret} className="dk-input w-full" /><div className="flex flex-wrap gap-2"><button type="button" className="ui-button ui-button-secondary" onClick={() => void copy()}><Copy size={14} />复制凭据</button><button type="button" className="ui-button ui-button-secondary" onClick={() => setSecret('')}>我已保存，关闭</button></div></div>}
        <p className="text-xs text-[var(--text-secondary)]">当前仅支持一个授权；重新授权前须撤销旧授权。撤销只阻止后续查询，无法删除 DSH 或模型服务已经保存的数据。<a className="ml-1 text-[var(--accent-text)] underline" href="https://github.com/runzhliu/welink/tree/main/plugins/dsh-welink" target="_blank" rel="noopener noreferrer">查看 DSH 连接指南</a></p>
      </>}
    </div>
    <Dialog open={confirm === 'create'} title="确认 Agent 授权" onClose={() => !busy && setConfirm(null)}><div className="space-y-4 text-sm"><p>将授权 {selected.length} 个会话，有效期 {hours === 24 ? '1 天' : hours === 168 ? '7 天' : '30 天'}。</p><ul aria-label="已选会话" className={`max-h-32 overflow-y-auto list-disc pl-5 ${privacyMode ? 'privacy-blur' : ''}`}>{selected.map(id => <li key={id}>{options.find(item => item.id === id)?.label || id}</li>)}</ul><p>允许查看日期{allowDay ? '、读取当天消息' : ''}{allowSearch ? '、搜索消息' : ''}。请确认 DSH 和所选模型服务的数据保存方式。</p><button type="button" className="ui-button ui-button-primary" disabled={busy} onClick={() => void create()}>{busy ? <Loader2 size={14} className="animate-spin" /> : null}确认创建</button></div></Dialog>
    <Dialog open={confirm === 'revoke'} title="撤销 Agent 授权" onClose={() => !busy && setConfirm(null)}><div className="space-y-4 text-sm"><p>撤销后，使用当前凭据的 DSH 将无法继续查询。已经保存或发送的数据不会被自动删除。</p><button type="button" className="ui-button ui-button-primary" disabled={busy} onClick={() => void revoke()}>确认撤销</button></div></Dialog>
    <Dialog open={locked} title="验证 WeLink PIN" onClose={() => { setLocked(false); setPin(''); }}><div className="space-y-4 text-sm"><label htmlFor="agent-pin">请输入 WeLink PIN 后管理授权</label><input id="agent-pin" type="password" autoComplete="current-password" maxLength={32} value={pin} onChange={e => setPin(e.target.value)} className="dk-input w-full" />{error && <p role="alert" className="text-red-600">{error}</p>}<button type="button" className="ui-button ui-button-primary" disabled={busy || pin.length < 4} onClick={() => void unlock()}>验证</button></div></Dialog>
  </section>;
};
