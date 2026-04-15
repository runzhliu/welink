/**
 * Cmd+K 命令面板 — 全局快速跳转
 *
 * 数据源：
 *   - 联系人（按名称 / 备注模糊）
 *   - 群聊（按名称）
 *   - AI 对话（后端 /api/ai/conversations/search 子串搜索）
 *   - Tab 切换 + 常用动作
 *
 * 快捷键：Cmd+K / Ctrl+K 打开；↑↓ 选择；Enter 执行；Esc 关闭。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Hash, User, Users, Bot, Settings, Sparkles, Database, X } from 'lucide-react';
import axios from 'axios';
import type { ContactStats, GroupInfo, TabType } from '../../types';

interface Props {
  open: boolean;
  onClose: () => void;
  contacts: ContactStats[];
  groups: GroupInfo[];
  onContactClick: (c: ContactStats) => void;
  onGroupClick: (g: GroupInfo) => void;
  onTabChange: (t: TabType) => void;
  onReveal?: () => void; // 预留钩子；当前未接入特定入口
}

type ActionItem = {
  kind: 'contact' | 'group' | 'tab' | 'action' | 'ai-conv';
  id: string;            // 用于 key
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  onSelect: () => void;
};

type AIHit = { key: string; updated_at: number; msg_count: number; preview: string; snippets: string[] };

const TAB_ITEMS: { tab: TabType; label: string; keywords: string[] }[] = [
  { tab: 'dashboard',   label: 'AI 首页',     keywords: ['ai', 'home', '首页'] },
  { tab: 'stats',       label: '统计',         keywords: ['stats', '统计', '排行'] },
  { tab: 'contacts',    label: '联系人',       keywords: ['contacts', '联系人'] },
  { tab: 'groups',      label: '群聊',         keywords: ['groups', '群聊', '群'] },
  { tab: 'search',      label: '全局搜索',     keywords: ['search', '搜索'] },
  { tab: 'timeline',    label: '时间线',       keywords: ['timeline', '时间线'] },
  { tab: 'calendar',    label: '聊天日历',     keywords: ['calendar', '日历', '时光机'] },
  { tab: 'anniversary', label: '纪念日',       keywords: ['anniversary', '纪念日'] },
  { tab: 'urls',        label: '链接收藏',     keywords: ['urls', '链接'] },
  { tab: 'skills',      label: 'Skills',      keywords: ['skills'] },
  { tab: 'db',          label: '数据库',       keywords: ['db', '数据库'] },
  { tab: 'settings',    label: '设置',         keywords: ['settings', '设置'] },
];

export const CommandPalette: React.FC<Props> = ({
  open, onClose, contacts, groups, onContactClick, onGroupClick, onTabChange,
}) => {
  const [q, setQ] = useState('');
  const [aiHits, setAiHits] = useState<AIHit[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // 打开时自动 focus
  useEffect(() => {
    if (open) {
      setQ('');
      setAiHits([]);
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // AI 对话搜索（debounced）
  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setAiHits([]);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const { data } = await axios.get<{ hits: AIHit[] }>('/api/ai/conversations/search', {
          params: { q: q.trim(), limit: 10 },
        });
        setAiHits(data.hits || []);
      } catch {
        setAiHits([]);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [q, open]);

  // 所有项目的扁平列表（按类型分段渲染）
  const items = useMemo<ActionItem[]>(() => {
    const lower = q.trim().toLowerCase();
    const result: ActionItem[] = [];

    // 联系人（限制 6 条）
    if (lower) {
      const matched = contacts
        .filter(c => (c.remark + c.nickname + c.username).toLowerCase().includes(lower))
        .slice(0, 6);
      for (const c of matched) {
        result.push({
          kind: 'contact',
          id: 'contact:' + c.username,
          title: c.remark || c.nickname || c.username,
          subtitle: `联系人 · ${c.total_messages ?? 0} 条消息`,
          icon: <User size={14} className="text-[#07c160]" />,
          onSelect: () => { onContactClick(c); onClose(); },
        });
      }
    }

    // 群聊（限制 5 条）
    if (lower) {
      const matched = groups.filter(g => g.name.toLowerCase().includes(lower)).slice(0, 5);
      for (const g of matched) {
        result.push({
          kind: 'group',
          id: 'group:' + g.username,
          title: g.name,
          subtitle: '群聊',
          icon: <Users size={14} className="text-[#07c160]" />,
          onSelect: () => { onGroupClick(g); onClose(); },
        });
      }
    }

    // AI 对话片段（限制 6 条）
    for (const h of aiHits.slice(0, 6)) {
      // 从 key 里提取友好标签（如 "contact:wxid_xxx" → "对话：wxid_xxx"）
      const [kind, ...rest] = h.key.split(':');
      const who = rest.join(':');
      const title = kind === 'contact' ? `对话（${who}）`
        : kind === 'ai-home' ? 'AI 首页对话'
        : kind === 'calendar' ? `时光机（${who}）`
        : h.key;
      result.push({
        kind: 'ai-conv',
        id: 'ai:' + h.key,
        title,
        subtitle: h.snippets[0] || h.preview,
        icon: <Bot size={14} className="text-[#576b95]" />,
        onSelect: () => {
          // 目前没有跨 tab 的"跳到对话"入口，回落到对应 tab；把 key 复制到剪贴板辅助定位
          if (kind === 'contact') {
            const c = contacts.find(cc => cc.username === who);
            if (c) { onContactClick(c); onClose(); return; }
          }
          if (kind === 'ai-home') { onTabChange('dashboard'); onClose(); return; }
          if (kind === 'calendar') { onTabChange('calendar'); onClose(); return; }
          onClose();
        },
      });
    }

    // Tab 跳转
    const tabMatches = TAB_ITEMS.filter(t => {
      if (!lower) return true;
      if (t.label.toLowerCase().includes(lower)) return true;
      return t.keywords.some(k => k.toLowerCase().includes(lower));
    });
    for (const t of tabMatches) {
      result.push({
        kind: 'tab',
        id: 'tab:' + t.tab,
        title: '跳转 · ' + t.label,
        icon: <Hash size={14} className="text-gray-400" />,
        onSelect: () => { onTabChange(t.tab); onClose(); },
      });
    }

    // 常用动作（只在查询为空或匹配时显示）
    const actions: { label: string; keys: string[]; icon: React.ReactNode; fn: () => void }[] = [
      { label: '打开设置', keys: ['settings', '设置'], icon: <Settings size={14} className="text-gray-400" />,
        fn: () => { onTabChange('settings'); } },
      { label: '运行诊断', keys: ['diagnostics', '诊断'], icon: <Sparkles size={14} className="text-[#07c160]" />,
        fn: () => { onTabChange('settings'); /* 诊断在 settings 里 */ } },
      { label: '打开 Skills', keys: ['skills'], icon: <Database size={14} className="text-gray-400" />,
        fn: () => { onTabChange('skills'); } },
    ];
    for (const a of actions) {
      if (lower && !a.keys.some(k => k.toLowerCase().includes(lower)) && !a.label.toLowerCase().includes(lower)) continue;
      result.push({
        kind: 'action', id: 'action:' + a.label,
        title: a.label, icon: a.icon,
        onSelect: () => { a.fn(); onClose(); },
      });
    }

    return result;
  }, [q, aiHits, contacts, groups, onContactClick, onGroupClick, onTabChange, onClose]);

  // 每次 items 变化把 activeIdx 钳回
  useEffect(() => {
    setActiveIdx(0);
  }, [q, aiHits.length]);

  // 键盘导航
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx(i => Math.min(items.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx(i => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        items[activeIdx]?.onSelect();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, items, activeIdx, onClose]);

  // 让选中项始终可见
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] bg-black/30 flex items-start justify-center pt-[12vh]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white dark:bg-[#1d1d1f] rounded-2xl shadow-2xl overflow-hidden dk-border border border-gray-100"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-white/10">
          <Search size={16} className="text-gray-400" />
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="搜索联系人 / 群聊 / AI 对话，输入命令跳转…"
            className="flex-1 bg-transparent outline-none text-sm text-[#1d1d1f] dk-text placeholder:text-gray-400"
          />
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={14} />
          </button>
        </div>
        <div ref={listRef} className="max-h-[60vh] overflow-y-auto">
          {items.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-400">没有找到匹配项</div>
          ) : (
            <div>
              {items.map((it, i) => (
                <button
                  key={it.id}
                  data-idx={i}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={it.onSelect}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    i === activeIdx
                      ? 'bg-[#07c160]/10 text-[#1d1d1f] dk-text'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5'
                  }`}
                >
                  {it.icon}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{it.title}</div>
                    {it.subtitle && (
                      <div className="text-xs text-gray-400 truncate">{it.subtitle}</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 px-4 py-2 text-[10px] text-gray-400 border-t border-gray-100 dark:border-white/10">
          <span><kbd className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/10 font-mono">↑↓</kbd> 选择</span>
          <span><kbd className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/10 font-mono">Enter</kbd> 打开</span>
          <span><kbd className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/10 font-mono">Esc</kbd> 关闭</span>
          <span className="ml-auto">共 {items.length} 项</span>
        </div>
      </div>
    </div>
  );
};
