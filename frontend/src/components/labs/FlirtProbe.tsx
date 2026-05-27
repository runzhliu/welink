/**
 * 暧昧探测 Lab —— 扫私聊里的暧昧痕迹（亲昵称呼/想念/深夜亲密/暧昧动作/暧昧 emoji）。
 *
 * GET /api/labs/flirt-probe
 *   - top_contacts: 按命中数 desc 的联系人榜（含类别分布 / 双向度 / Top 3 高光语录）
 *   - timeline: 最近 50 条命中
 *   - 排除名单: 通过 PUT /api/preferences/flirt-excluded 管理
 *
 * 零 LLM，纯关键词 + 否定语境过滤，秒出。免责声明：仅供娱乐回顾，不是关系结论。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Flame, Loader2, RefreshCw, Share2, Check, X, EyeOff, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
import html2canvas from 'html2canvas';
import { prepareForCapture } from '../../utils/exportPng';
import { avatarSrc } from '../../utils/avatar';
import { useToast } from '../common/Toast';
import { WelinkBrand } from './_shared';

interface FLQuote {
  date: string;
  who: 'me' | 'them';
  snippet: string;
}

interface ContactRow {
  username: string;
  display_name: string;
  avatar_url: string;
  total_hits: number;
  my_hits: number;
  their_hits: number;
  categories: Record<string, number>;
  first_date: string;
  last_date: string;
  top_quotes: FLQuote[];
  mutual_score: number;
}

interface TimelineItem {
  date: string;
  username: string;
  display_name: string;
  who: 'me' | 'them';
  snippet: string;
  categories: string[];
}

interface Resp {
  total_contacts_with_hits: number;
  total_hits: number;
  mutual_pairs: number;
  top_contacts: ContactRow[];
  timeline: TimelineItem[];
  scanned_contacts: number;
  excluded_usernames: string[];
  generated_at: number;
}

// 5 类信号的展示色 + 中文名。
// 用实色 100 系列背景 + 700 系列文字（不用 /20 透明，html2canvas 截图更稳）。
const CAT_META: Record<string, { label: string; color: string; bg: string }> = {
  endearment: { label: '亲昵称呼', color: 'text-pink-700',   bg: 'bg-pink-100' },
  longing:    { label: '想念',     color: 'text-red-700',    bg: 'bg-red-100' },
  late_night: { label: '深夜亲密', color: 'text-purple-700', bg: 'bg-purple-100' },
  action:     { label: '暧昧动作', color: 'text-orange-700', bg: 'bg-orange-100' },
  emoji:      { label: '暧昧表情', color: 'text-amber-700',  bg: 'bg-amber-100' },
};

const fmtMD = (d: string) => (d && d.length >= 10 ? `${d.slice(5, 7)}-${d.slice(8, 10)}` : d);
const fmtYM = (d: string) => (d && d.length >= 7 ? d.slice(0, 7) : '');

export const FlirtProbe: React.FC = () => {
  const toast = useToast();
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [excludeBusy, setExcludeBusy] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const fetchData = async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setErr('');
    try {
      const r = await axios.get<Resp>('/api/labs/flirt-probe', {
        params: refresh ? { refresh: 1 } : {},
      });
      setData(r.data);
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } }; message?: string })
        ?.response?.data?.error || (e as Error).message || '加载失败';
      setErr(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchData(false); }, []);

  // 添加到排除名单：把这位联系人移出榜单（标记为伴侣/家人/客户等）
  const handleExclude = async (username: string, displayName: string) => {
    if (!data) return;
    if (!confirm(`把「${displayName}」从暧昧探测里排除？\n\n该联系人将不再出现在榜单上。可以随时在底部「排除名单」区移回来。`)) return;
    setExcludeBusy(username);
    try {
      const next = [...(data.excluded_usernames ?? []), username];
      await axios.put('/api/preferences/flirt-excluded', { flirt_excluded: next });
      toast.success(`已排除「${displayName}」`);
      await fetchData(true); // 强制刷新缓存
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } }; message?: string })
        ?.response?.data?.error || (e as Error).message || '操作失败';
      toast.error(msg);
    } finally {
      setExcludeBusy(null);
    }
  };

  const handleUnexclude = async (username: string) => {
    if (!data) return;
    setExcludeBusy(username);
    try {
      const next = (data.excluded_usernames ?? []).filter(u => u !== username);
      await axios.put('/api/preferences/flirt-excluded', { flirt_excluded: next });
      toast.success('已从排除名单移出');
      await fetchData(true);
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } }; message?: string })
        ?.response?.data?.error || (e as Error).message || '操作失败';
      toast.error(msg);
    } finally {
      setExcludeBusy(null);
    }
  };

  const top10 = useMemo(() => (data?.top_contacts ?? []).slice(0, 10), [data]);
  const topHitsMax = useMemo(() => {
    if (!top10.length) return 1;
    return Math.max(...top10.map(c => c.total_hits));
  }, [top10]);

  const today = new Date().toLocaleDateString('zh-CN');

  // 截图导出（跟其他 lab 一致的实现）
  const exportPng = async () => {
    if (!data || !cardRef.current || exporting) return;
    setExporting(true);
    let wrapper: HTMLElement | null = null;
    try {
      const node = cardRef.current.cloneNode(true) as HTMLElement;
      wrapper = document.createElement('div');
      wrapper.style.cssText = `
        width: 720px; background: #ffffff; padding: 0;
        font-family: system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
        position: fixed; left: -10000px; top: 0; z-index: -1;
      `;
      wrapper.appendChild(node);
      document.body.appendChild(wrapper);
      prepareForCapture(wrapper);
      await new Promise(r => setTimeout(r, 50));
      const canvas = await html2canvas(wrapper, {
        backgroundColor: '#ffffff', scale: 2, useCORS: true, logging: false,
      });
      canvas.toBlob((blob) => {
        if (!blob) { toast.error('生成图片失败'); return; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `flirt-probe-${today.replace(/\//g, '-')}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setExported(true);
        setTimeout(() => setExported(false), 2000);
      }, 'image/png');
    } catch (e) {
      toast.error('截图失败：' + (e as Error).message);
    } finally {
      if (wrapper && wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
      setExporting(false);
    }
  };

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-3 gap-2">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          扫所有私聊里的 5 类暧昧痕迹（亲昵称呼 / 想念 / 深夜亲密 / 暧昧动作 / 暧昧表情）。零 LLM，秒出。
        </p>
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={() => fetchData(true)}
            disabled={refreshing || loading}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/15 disabled:opacity-50 transition-colors"
            title="跳过缓存重新扫描"
          >
            {refreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            刷新
          </button>
          {data && (data.top_contacts?.length ?? 0) > 0 && (
            <button
              onClick={exportPng}
              disabled={exporting}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-gradient-to-r from-pink-500 to-rose-500 text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {exporting ? <Loader2 size={12} className="animate-spin" /> : exported ? <Check size={12} /> : <Share2 size={12} />}
              {exported ? '已下载' : '截图'}
            </button>
          )}
        </div>
      </div>

      {/* 免责声明 */}
      <div className="rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-3 mb-4 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
        <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
        <span>
          关键词匹配仅供娱乐回顾。<strong>不代表关系本质</strong>，更不代表对方的真实意图 ——
          很多日常对话里的"宝贝/想你"也可能是亲友间的玩笑。如果伴侣 / 家人 / 工作对象出现在榜上，可点右侧
          <EyeOff size={11} className="inline mx-0.5" /> 把 TA 排除。
        </span>
      </div>

      {err && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/30 p-3 mb-4 text-xs text-red-700 dark:text-red-300">
          {err}
        </div>
      )}

      {loading && (
        <div className="text-center py-16 text-gray-400 text-sm flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" />
          扫描你的所有私聊…
        </div>
      )}

      {data && data.total_contacts_with_hits === 0 && !loading && (
        <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-8 text-center text-sm text-gray-500">
          没探测到暧昧痕迹 —— 你这段时间很正经 😊
          <div className="text-xs text-gray-400 mt-2">已扫描 {data.scanned_contacts} 个私聊</div>
        </div>
      )}

      {data && data.total_contacts_with_hits > 0 && (
        <div ref={cardRef} className="rounded-2xl bg-white dark:bg-[#1c1c1e] overflow-hidden border border-gray-100 dark:border-white/10">
          {/* Hero —— 用实色而非 gradient，html2canvas 渲染稳 */}
          <div className="px-7 py-6 bg-pink-50 dark:bg-pink-500/10 border-b border-pink-200 dark:border-pink-500/20">
            <div className="text-xs uppercase tracking-widest text-pink-600 dark:text-pink-400 font-bold mb-1">
              Flirt Probe · 暧昧探测
            </div>
            <div className="text-3xl font-black text-[#1d1d1f] dark:text-gray-100 mb-2">
              探测到 {data.total_contacts_with_hits} 个人在你聊天里"有点意思"
            </div>
            <div className="grid grid-cols-3 gap-3 mt-4">
              <div className="bg-white/70 dark:bg-white/5 rounded-2xl px-4 py-3">
                <div className="text-[11px] text-gray-500 font-bold uppercase tracking-wider mb-0.5">命中联系人</div>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-black text-pink-600 dark:text-pink-400">{data.total_contacts_with_hits}</span>
                  <span className="text-xs text-gray-400">人</span>
                </div>
              </div>
              <div className="bg-white/70 dark:bg-white/5 rounded-2xl px-4 py-3">
                <div className="text-[11px] text-gray-500 font-bold uppercase tracking-wider mb-0.5">命中条数</div>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-black text-rose-600 dark:text-rose-400">{data.total_hits}</span>
                  <span className="text-xs text-gray-400">条</span>
                </div>
              </div>
              <div className="bg-white/70 dark:bg-white/5 rounded-2xl px-4 py-3">
                <div className="text-[11px] text-gray-500 font-bold uppercase tracking-wider mb-0.5">双向暧昧</div>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-black text-purple-600 dark:text-purple-400">{data.mutual_pairs}</span>
                  <span className="text-xs text-gray-400">对</span>
                </div>
              </div>
            </div>
          </div>

          {/* Top 联系人 */}
          {top10.length > 0 && (
            <div className="px-7 py-5 border-b border-gray-100 dark:border-white/5">
              <div className="text-sm font-bold text-[#1d1d1f] dark:text-gray-100 mb-3">
                Top {top10.length} —— 跟你聊得最有"暧昧浓度"的人
              </div>
              <div className="space-y-2">
                {top10.map((c, idx) => {
                  const widthPct = (c.total_hits / topHitsMax) * 100;
                  const myFrac = c.total_hits > 0 ? (c.my_hits / c.total_hits) * 100 : 0;
                  const isExpanded = expandedRow === c.username;
                  return (
                    <div key={c.username} className="rounded-xl border border-gray-100 dark:border-white/5 hover:border-pink-200 dark:hover:border-pink-500/30 transition-colors">
                      <div className="flex items-center gap-2 p-2.5">
                        <span className="text-[10px] font-mono text-gray-400 w-5 text-right">#{idx + 1}</span>
                        {c.avatar_url ? (
                          <img
                            src={avatarSrc(c.avatar_url) || ''}
                            alt=""
                            className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-400 to-rose-500 flex items-center justify-center text-xs text-white font-bold flex-shrink-0">
                            {c.display_name.charAt(0)}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <div className="text-sm font-semibold text-[#1d1d1f] dark:text-gray-200 truncate max-w-[160px]">{c.display_name}</div>
                            {Object.entries(c.categories ?? {})
                              .sort((a, b) => b[1] - a[1])
                              .slice(0, 3)
                              .map(([cat, cnt]) => {
                                const m = CAT_META[cat];
                                if (!m) return null;
                                return (
                                  <span key={cat} className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-bold whitespace-nowrap ${m.color} ${m.bg}`}>
                                    <span>{m.label}</span>
                                    <span className="font-mono opacity-70">{cnt}</span>
                                  </span>
                                );
                              })}
                          </div>
                          {/* 双向条：track 固定宽度 = 0%-100% 比例尺；内层 flex 按 me/them 分两色
                              小数量也至少 2% 宽，避免完全看不到 */}
                          <div className="h-1.5 w-full max-w-[260px] bg-gray-100 dark:bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full flex" style={{ width: `${Math.max(2, widthPct)}%` }}>
                              <div className="h-full bg-pink-500" style={{ width: `${myFrac}%` }} title={`我 ${c.my_hits} 次`} />
                              <div className="h-full bg-rose-400" style={{ width: `${100 - myFrac}%` }} title={`TA ${c.their_hits} 次`} />
                            </div>
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-gray-400 mt-0.5 max-w-[260px]">
                            <span>我 {c.my_hits}</span>
                            <span>共 {c.total_hits} 条 · {fmtYM(c.first_date)} → {fmtYM(c.last_date)}</span>
                            <span>TA {c.their_hits}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => setExpandedRow(isExpanded ? null : c.username)}
                          className="p-1.5 rounded text-gray-400 hover:text-pink-500 hover:bg-pink-50 dark:hover:bg-pink-500/10 transition-colors flex-shrink-0"
                          title={isExpanded ? '收起' : '看高光语录'}
                        >
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                        <button
                          onClick={() => handleExclude(c.username, c.display_name)}
                          disabled={excludeBusy === c.username}
                          className="p-1.5 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors flex-shrink-0 disabled:opacity-50"
                          title="把 TA 从榜单排除（如真伴侣 / 家人 / 客户）"
                        >
                          {excludeBusy === c.username ? <Loader2 size={13} className="animate-spin" /> : <EyeOff size={13} />}
                        </button>
                      </div>

                      {/* 展开：Top 高光语录 */}
                      {isExpanded && (c.top_quotes?.length ?? 0) > 0 && (
                        <div className="px-3 pb-3 pt-1 space-y-1.5 border-t border-gray-100 dark:border-white/5">
                          {c.top_quotes.map((q, i) => (
                            <div key={i} className="flex items-start gap-2 text-xs">
                              <span className="font-mono text-[10px] text-gray-400 w-12 flex-shrink-0 mt-0.5">{fmtMD(q.date)}</span>
                              <span className={`text-[10px] font-bold uppercase tracking-wider w-6 flex-shrink-0 mt-0.5 ${q.who === 'me' ? 'text-pink-500' : 'text-rose-400'}`}>
                                {q.who === 'me' ? '我' : 'TA'}
                              </span>
                              <span className="flex-1 text-gray-700 dark:text-gray-300 break-words italic">"{q.snippet}"</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {(data.top_contacts?.length ?? 0) > top10.length && (
                <div className="text-[10px] text-gray-400 text-center mt-3">
                  还有 {(data.top_contacts?.length ?? 0) - top10.length} 位榜上有名；想看完整可去对应联系人详情翻聊天记录
                </div>
              )}
            </div>
          )}

          {/* 时间线 */}
          {(data.timeline?.length ?? 0) > 0 && (
            <div className="px-7 py-5 border-b border-gray-100 dark:border-white/5">
              <div className="text-sm font-bold text-[#1d1d1f] dark:text-gray-100 mb-3">
                最近的暧昧片段
              </div>
              <div className="space-y-2">
                {data.timeline.slice(0, 15).map((t, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <span className="font-mono text-[10px] text-gray-400 w-20 flex-shrink-0 mt-0.5">{t.date}</span>
                    <span className={`inline-block w-1 h-1 rounded-full mt-2 flex-shrink-0 ${t.who === 'me' ? 'bg-pink-500' : 'bg-rose-400'}`} />
                    <div className="flex-1 min-w-0">
                      <div>
                        <span className={`text-[10px] font-bold uppercase tracking-wider mr-1.5 ${t.who === 'me' ? 'text-pink-500' : 'text-rose-400'}`}>
                          {t.who === 'me' ? '我' : t.display_name}
                        </span>
                        <span className="text-gray-700 dark:text-gray-300 break-words">{t.snippet}</span>
                      </div>
                      {(t.categories ?? []).length > 0 && (
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {(t.categories ?? []).slice(0, 2).map(cat => {
                            const m = CAT_META[cat];
                            if (!m) return null;
                            return (
                              <span key={cat} className={`text-[9px] px-1.5 py-0 rounded font-bold whitespace-nowrap ${m.bg} ${m.color}`}>
                                {m.label}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {data.timeline.length > 15 && (
                <div className="text-[10px] text-gray-400 text-center mt-2">
                  显示最近 15 条 · 服务端缓存了最近 {data.timeline.length} 条
                </div>
              )}
            </div>
          )}

          {/* 排除名单管理 */}
          {(data.excluded_usernames?.length ?? 0) > 0 && (
            <div className="px-7 py-4 border-b border-gray-100 dark:border-white/5">
              <div className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                <EyeOff size={11} />
                <span>已排除的联系人（{data.excluded_usernames.length}）—— 不参与统计</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {data.excluded_usernames.map(u => (
                  <span key={u} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-400 font-mono">
                    {u}
                    <button
                      onClick={() => handleUnexclude(u)}
                      disabled={excludeBusy === u}
                      className="text-gray-400 hover:text-red-500 disabled:opacity-50"
                      title="移出排除名单"
                    >
                      {excludeBusy === u ? <Loader2 size={9} className="animate-spin" /> : <X size={9} />}
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <WelinkBrand
            label="暧昧探测"
            leftText={
              <>
                已扫描 {data.scanned_contacts} 个私聊 · 命中 {data.total_contacts_with_hits} 人 · 双向 {data.mutual_pairs} 对
                <Flame size={9} className="inline ml-1 text-pink-400" />
              </>
            }
          />
        </div>
      )}
    </div>
  );
};
