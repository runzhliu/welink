/**
 * 这句话谁说过 / Echo Search
 *
 * 输入一句话，跨全库向量索引找到最相似的历史消息，
 * 按"说话人"聚合返回——告诉你"这句话最像 X、Y、Z 说过的话"。
 *
 * GET /api/me/echo?q=...&topK=20&include_groups=0&include_self=0&days=365&min_msgs=50
 */

import React, { useState } from 'react';
import axios from 'axios';
import {
  Search, Loader2, ChevronDown, ChevronRight, Users2, MessageSquare, Settings2,
} from 'lucide-react';
import { avatarSrc } from '../../utils/avatar';
import { useToast } from '../common/Toast';

interface EchoHit {
  datetime: string;
  sender: string;
  content: string;
  similarity: number;
}

interface EchoGroup {
  key: string;
  display_name: string;
  avatar?: string;
  is_group: boolean;
  hit_count: number;
  top_sim: number;
  hits: EchoHit[];
}

interface EchoResp {
  query: string;
  total_hits: number;
  keys_scanned: number;
  keys_skipped: number;
  elapsed_ms: number;
  groups: EchoGroup[];
}

const SAMPLES = [
  '我们去吃火锅吧',
  '最近在忙什么',
  '生日快乐',
  '我可能要辞职了',
  '今晚有空吗',
];

const fmtSim = (s: number) => `${(s * 100).toFixed(0)}%`;
const fmtDate = (s: string) => {
  // "2024-08-15 21:33:04" → "2024-08-15"
  if (!s) return '';
  return s.split(' ')[0];
};

export const EchoSearch: React.FC = () => {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [data, setData] = useState<EchoResp | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showOpts, setShowOpts] = useState(false);

  // 选项：默认 私聊 + 只别人 + 近一年 + ≥50 条
  const [includeGroups, setIncludeGroups] = useState(false);
  const [includeSelf, setIncludeSelf] = useState(false);
  const [days, setDays] = useState(365);
  const [minMsgs, setMinMsgs] = useState(50);

  const runSearch = async (q: string) => {
    const text = q.trim();
    if (!text) return;
    setLoading(true);
    setErr('');
    setExpanded({});
    try {
      const r = await axios.get<EchoResp>('/api/me/echo', {
        params: {
          q: text,
          topK: 30,
          include_groups: includeGroups ? 1 : 0,
          include_self: includeSelf ? 1 : 0,
          days,
          min_msgs: minMsgs,
        },
      });
      setData(r.data);
      // 默认展开第一个匹配
      if (r.data.groups.length > 0) {
        setExpanded({ [r.data.groups[0].key]: true });
      }
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } }; message?: string })
        ?.response?.data?.error || (e as Error).message || '搜索失败';
      setErr(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runSearch(query);
  };

  const toggle = (key: string) => {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="space-y-4">
      {/* 顶部：标题 + 介绍 */}
      <div className="rounded-2xl bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#07c160] to-[#10aeff] flex items-center justify-center shrink-0">
            <Search size={20} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-black text-[#1d1d1f] dark:text-gray-100">这句话谁说过</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
              输入一句话，跨全部联系人的向量索引语义反查 ——「这句话最像谁说过」。
              基于已建好的 RAG embedding，没建索引的联系人不会出现在结果里。
            </p>
          </div>
        </div>

        {/* 搜索框 */}
        <form onSubmit={onSubmit} className="mt-4 flex gap-2">
          <div className="flex-1 relative">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="例如：我可能要辞职了 / 今晚有空吗"
              maxLength={200}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 text-sm text-[#1d1d1f] dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:border-[#07c160]"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#07c160] to-[#10aeff] text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            搜索
          </button>
          <button
            type="button"
            onClick={() => setShowOpts(v => !v)}
            className="px-3 py-2.5 rounded-xl bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10"
            title="高级选项"
          >
            <Settings2 size={14} />
          </button>
        </form>

        {/* 范例 */}
        <div className="flex flex-wrap gap-1.5 mt-3">
          {SAMPLES.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => { setQuery(s); runSearch(s); }}
              disabled={loading}
              className="px-2.5 py-1 rounded-lg bg-gray-50 dark:bg-white/5 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>

        {/* 高级选项 */}
        {showOpts && (
          <div className="mt-3 pt-3 border-t border-gray-100 dark:border-white/10 space-y-2 text-xs">
            <div className="flex flex-wrap items-center gap-4">
              <label className="inline-flex items-center gap-1.5 text-gray-600 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={includeGroups}
                  onChange={e => setIncludeGroups(e.target.checked)}
                  className="accent-[#07c160]"
                />
                包含群聊
              </label>
              <label className="inline-flex items-center gap-1.5 text-gray-600 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={includeSelf}
                  onChange={e => setIncludeSelf(e.target.checked)}
                  className="accent-[#07c160]"
                />
                包含我自己说过的
              </label>
              <label className="inline-flex items-center gap-1.5 text-gray-600 dark:text-gray-300">
                时间范围
                <select
                  value={days}
                  onChange={e => setDays(parseInt(e.target.value))}
                  className="px-1.5 py-1 rounded bg-white dark:bg-black/20 border border-gray-200 dark:border-white/10"
                >
                  <option value={90}>近 3 个月</option>
                  <option value={365}>近 1 年</option>
                  <option value={1095}>近 3 年</option>
                  <option value={0}>不限</option>
                </select>
              </label>
              <label className="inline-flex items-center gap-1.5 text-gray-600 dark:text-gray-300">
                联系人门槛
                <select
                  value={minMsgs}
                  onChange={e => setMinMsgs(parseInt(e.target.value))}
                  className="px-1.5 py-1 rounded bg-white dark:bg-black/20 border border-gray-200 dark:border-white/10"
                >
                  <option value={20}>≥ 20 条</option>
                  <option value={50}>≥ 50 条</option>
                  <option value={200}>≥ 200 条</option>
                  <option value={1}>不限</option>
                </select>
              </label>
            </div>
          </div>
        )}
      </div>

      {/* 结果 */}
      {err && !loading && (
        <div className="rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-3 text-xs text-red-600 dark:text-red-400">
          {err}
        </div>
      )}

      {loading && (
        <div className="rounded-2xl bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 p-8 text-center text-sm text-gray-500 dark:text-gray-400">
          <Loader2 size={20} className="animate-spin mx-auto mb-2" />
          正在跨全库语义搜索…首次扫描可能较慢
        </div>
      )}

      {data && !loading && (
        <>
          {/* 摘要条 */}
          <div className="rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 px-3 py-2 text-xs text-gray-600 dark:text-gray-400 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>
              扫了 <strong className="text-[#1d1d1f] dark:text-gray-100">{data.keys_scanned}</strong> 个联系人
              {data.keys_skipped > 0 && <span className="text-gray-400">（跳过 {data.keys_skipped} 个）</span>}
            </span>
            <span>
              命中 <strong className="text-[#1d1d1f] dark:text-gray-100">{data.total_hits}</strong> 条 · 涉及 <strong className="text-[#1d1d1f] dark:text-gray-100">{data.groups.length}</strong> 个对象
            </span>
            <span className="text-gray-400">耗时 {data.elapsed_ms}ms</span>
          </div>

          {data.groups.length === 0 && (
            <div className="rounded-2xl bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 p-8 text-center text-sm text-gray-500 dark:text-gray-400">
              <MessageSquare size={20} className="mx-auto mb-2 opacity-40" />
              没找到语义相近的消息。试试换个说法，或者放宽时间范围 / 包含群聊。
            </div>
          )}

          {data.groups.map((g, idx) => {
            const open = expanded[g.key];
            return (
              <div
                key={g.key}
                className="rounded-2xl bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 overflow-hidden"
              >
                <button
                  onClick={() => toggle(g.key)}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-white/5 text-left"
                >
                  {/* 排名 */}
                  <div className="w-6 h-6 rounded-full bg-gray-100 dark:bg-white/10 flex items-center justify-center text-[10px] font-bold text-gray-500 shrink-0">
                    {idx + 1}
                  </div>
                  {/* 头像 */}
                  {g.avatar ? (
                    <img
                      src={avatarSrc(g.avatar)}
                      alt=""
                      className="w-9 h-9 rounded-lg object-cover shrink-0 bg-gray-100 dark:bg-white/10"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#07c160] to-[#10aeff] flex items-center justify-center text-white text-sm font-bold shrink-0">
                      {g.is_group ? <Users2 size={16} /> : g.display_name.charAt(0)}
                    </div>
                  )}
                  {/* 名字 + 元信息 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-[#1d1d1f] dark:text-gray-100 truncate">
                        {g.display_name}
                      </span>
                      {g.is_group && (
                        <span className="px-1.5 py-0.5 rounded bg-[#10aeff]/10 text-[#10aeff] text-[10px] font-bold">
                          群
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {g.hit_count} 条相似 · 最高 {fmtSim(g.top_sim)}
                    </div>
                  </div>
                  {/* 相似度条（按 top_sim） */}
                  <div className="hidden sm:block w-20 h-1.5 bg-gray-100 dark:bg-white/10 rounded-full overflow-hidden shrink-0">
                    <div
                      className="h-full bg-gradient-to-r from-[#07c160] to-[#10aeff]"
                      style={{ width: `${Math.min(100, g.top_sim * 100)}%` }}
                    />
                  </div>
                  {open ? <ChevronDown size={16} className="text-gray-400 shrink-0" /> : <ChevronRight size={16} className="text-gray-400 shrink-0" />}
                </button>

                {open && (
                  <div className="px-4 pb-3 space-y-2">
                    {g.hits.map((h, i) => (
                      <div
                        key={i}
                        className="rounded-xl bg-gray-50 dark:bg-black/20 border border-gray-100 dark:border-white/5 p-3"
                      >
                        <div className="flex items-center gap-2 mb-1.5 text-xs">
                          <span className="px-1.5 py-0.5 rounded bg-[#07c160]/10 text-[#07c160] font-bold">
                            {fmtSim(h.similarity)}
                          </span>
                          <span className="text-gray-400">{h.sender}</span>
                          <span className="text-gray-400">·</span>
                          <span className="text-gray-400">{fmtDate(h.datetime)}</span>
                        </div>
                        <div className="text-sm text-[#1d1d1f] dark:text-gray-100 leading-relaxed whitespace-pre-wrap break-words">
                          {h.content}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {!data && !loading && !err && (
        <div className="rounded-2xl bg-white dark:bg-white/5 border border-dashed border-gray-200 dark:border-white/10 p-8 text-center text-sm text-gray-500 dark:text-gray-400">
          <Search size={20} className="mx-auto mb-2 opacity-40" />
          输入一句话，看看你的微信里谁说过最像的话
        </div>
      )}
    </div>
  );
};

export default EchoSearch;
