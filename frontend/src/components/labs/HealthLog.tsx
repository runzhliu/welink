/**
 * 健康日记 Lab —— 双向扫聊天记录里的"生病"提及，7 天合并成一次发作。
 *
 * GET /api/labs/health-log
 *   - summary：我 / TA 们 全年生病次数
 *   - top_contacts：按双向总次数排序的联系人榜
 *   - monthly：月度发作柱状图
 *   - timeline：最近 30 条片段
 *
 * 纯关键词扫描，零 LLM，秒出。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { HeartPulse, Loader2, Share2, Check, RefreshCw, User as UserIcon, Users } from 'lucide-react';
import html2canvas from 'html2canvas';
import { prepareForCapture } from '../../utils/exportPng';
import { avatarSrc } from '../../utils/avatar';
import { useToast } from '../common/Toast';
import { welinkBrandHTML, WelinkBrand } from './_shared';

interface ContactRow {
  username: string;
  display_name: string;
  avatar_url: string;
  my_episodes: number;
  their_episodes: number;
  last_episode_date: string;
  last_episode_who: 'me' | 'them' | '';
}

interface TimelineItem {
  date: string;
  username: string;
  display_name: string;
  who: 'me' | 'them';
  snippet: string;
}

interface MonthBucket {
  month: string;
  my_episodes: number;
  their_episodes: number;
}

interface Resp {
  total_my_episodes: number;
  total_their_episodes: number;
  contacts_with_hits: number;
  top_contacts: ContactRow[];
  my_earliest_date?: string;
  timeline: TimelineItem[];
  monthly: MonthBucket[];
  scanned_contacts: number;
  generated_at: number;
}

const fmtDate = (d: string) => {
  if (!d || d.length < 10) return d;
  return `${d.slice(5, 7)}-${d.slice(8, 10)}`;
};

const fmtYear = (d: string) => (d && d.length >= 4 ? d.slice(0, 4) : '');

export const HealthLog: React.FC = () => {
  const toast = useToast();
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const fetchData = async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setErr('');
    try {
      const r = await axios.get<Resp>('/api/labs/health-log', {
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

  const today = new Date().toLocaleDateString('zh-CN');

  // 月度柱状图的 max 用于归一化高度
  const monthMax = useMemo(() => {
    if (!data) return 1;
    let m = 1;
    for (const b of data.monthly) {
      const v = b.my_episodes + b.their_episodes;
      if (v > m) m = v;
    }
    return m;
  }, [data]);

  // Top 10 联系人
  const top10 = useMemo(() => (data?.top_contacts ?? []).slice(0, 10), [data]);
  const topMax = useMemo(() => {
    if (!top10.length) return 1;
    let m = 1;
    for (const r of top10) {
      const v = r.my_episodes + r.their_episodes;
      if (v > m) m = v;
    }
    return m;
  }, [top10]);

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
      wrapper.insertAdjacentHTML('beforeend', welinkBrandHTML({
        label: '健康日记',
        date: today,
        variant: 'light',
      }));
      document.body.appendChild(wrapper);
      await prepareForCapture(wrapper);
      const canvas = await html2canvas(wrapper, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      });
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `welink-health-log-${Date.now()}.png`;
      a.click();
      setExported(true);
      setTimeout(() => setExported(false), 3000);
    } catch (e) {
      toast.error('导出失败：' + ((e as Error).message || '未知错误'));
    } finally {
      if (wrapper && wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
      setExporting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      {/* 顶部说明 + 操作 */}
      <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-4 mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <HeartPulse size={16} className="text-[#fa5151]" />
            <div className="text-sm font-bold text-[#1d1d1f] dark:text-gray-100">健康日记</div>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            扫所有私聊里的"感冒/发烧/头疼/医院/吃药……"等关键词，7 天内的连续提及合并为一次"发作"。
            分别统计「我」和「TA 们」的生病次数。纯关键词、零 LLM。
          </div>
        </div>
        <div className="shrink-0 flex gap-2">
          <button
            onClick={() => fetchData(true)}
            disabled={loading || refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 disabled:opacity-50"
            title="重算（绕过缓存）"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? '重算中…' : '重算'}
          </button>
          {data && (data.total_my_episodes + data.total_their_episodes) > 0 && (
            <button
              onClick={exportPng}
              disabled={exporting}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 disabled:opacity-50"
            >
              {exporting ? <Loader2 size={12} className="animate-spin" /> :
                exported ? <Check size={12} className="text-[#07c160]" /> :
                <Share2 size={12} />}
              {exporting ? '生成图片…' : exported ? '已下载' : '导出分享图'}
            </button>
          )}
        </div>
      </div>

      {err && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/30 p-3 mb-4 text-xs text-red-700 dark:text-red-300">
          {err}
        </div>
      )}

      {loading && (
        <div className="text-center py-16 text-gray-400 text-sm flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" />
          扫描你的所有聊天记录…
        </div>
      )}

      {data && (data.total_my_episodes + data.total_their_episodes) === 0 && !loading && (
        <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-8 text-center text-sm text-gray-500">
          没找到生病相关的提及——身体好得不行 🙌
          <div className="text-xs text-gray-400 mt-2">已扫描 {data.scanned_contacts} 个联系人</div>
        </div>
      )}

      {data && (data.total_my_episodes + data.total_their_episodes) > 0 && (
        <div ref={cardRef} className="rounded-2xl bg-white dark:bg-[#1c1c1e] overflow-hidden border border-gray-100 dark:border-white/10">
          {/* Hero */}
          <div className="px-7 py-6 bg-[#fa5151]/8 dark:bg-[#fa5151]/10 border-b border-[#fa5151]/15">
            <div className="text-xs uppercase tracking-widest text-[#fa5151] font-bold mb-1">
              Health Log · 健康日记
            </div>
            <div className="text-3xl font-black text-[#1d1d1f] dark:text-gray-100 mb-2">
              {data.my_earliest_date
                ? `从 ${fmtYear(data.my_earliest_date)} 年起，你和 TA 们聊过生病`
                : '你和 TA 们的健康记录'}
            </div>
            <div className="grid grid-cols-2 gap-3 mt-4">
              <div className="bg-white/60 dark:bg-white/5 rounded-2xl px-4 py-3">
                <div className="flex items-center gap-1.5 text-[11px] text-gray-500 font-bold uppercase tracking-wider mb-0.5">
                  <UserIcon size={11} /> 我提到过生病
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-black text-[#fa5151]">{data.total_my_episodes}</span>
                  <span className="text-xs text-gray-400">次</span>
                </div>
              </div>
              <div className="bg-white/60 dark:bg-white/5 rounded-2xl px-4 py-3">
                <div className="flex items-center gap-1.5 text-[11px] text-gray-500 font-bold uppercase tracking-wider mb-0.5">
                  <Users size={11} /> TA 们跟我说生病
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-black text-[#576b95]">{data.total_their_episodes}</span>
                  <span className="text-xs text-gray-400">次 · 来自 {data.contacts_with_hits} 个人</span>
                </div>
              </div>
            </div>
          </div>

          {/* 谁最常生病 / 跟我抱怨最多 */}
          {top10.length > 0 && (
            <div className="px-7 py-5 border-b border-gray-100 dark:border-white/5">
              <div className="text-sm font-bold text-[#1d1d1f] dark:text-gray-100 mb-3">
                谁最常和你提到生病
              </div>
              <div className="space-y-2.5">
                {top10.map((c) => {
                  const total = c.my_episodes + c.their_episodes;
                  const myW = (c.my_episodes / topMax) * 100;
                  const theirW = (c.their_episodes / topMax) * 100;
                  return (
                    <div key={c.username} className="">
                      <div className="flex items-center gap-2 mb-1">
                        {c.avatar_url ? (
                          <img
                            src={avatarSrc(c.avatar_url) || ''}
                            alt=""
                            className="w-5 h-5 rounded-full object-cover flex-shrink-0"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        ) : (
                          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#fa5151] to-[#fb7185] flex items-center justify-center text-[10px] text-white font-bold flex-shrink-0">
                            {c.display_name.charAt(0)}
                          </div>
                        )}
                        <div className="flex-1 min-w-0 text-xs font-semibold text-[#1d1d1f] dark:text-gray-200 truncate">
                          {c.display_name}
                        </div>
                        <div className="text-[11px] text-gray-400 font-mono">
                          {total} 次
                          {c.last_episode_date && (
                            <span className="ml-1 text-gray-300">· {c.last_episode_date}</span>
                          )}
                        </div>
                      </div>
                      {/* 双向条 */}
                      <div className="flex items-center gap-1 h-1.5">
                        <div className="flex-1 bg-gray-100 dark:bg-white/5 rounded-full overflow-hidden">
                          <div className="h-full bg-[#fa5151] rounded-full" style={{ width: `${myW}%` }} title={`我 ${c.my_episodes} 次`} />
                        </div>
                        <div className="flex-1 bg-gray-100 dark:bg-white/5 rounded-full overflow-hidden">
                          <div className="h-full bg-[#576b95] rounded-full" style={{ width: `${theirW}%` }} title={`TA ${c.their_episodes} 次`} />
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-gray-400 mt-0.5 px-0.5">
                        <span>我 {c.my_episodes}</span>
                        <span>TA {c.their_episodes}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 月度柱状图 */}
          {data.monthly.length > 0 && (
            <div className="px-7 py-5 border-b border-gray-100 dark:border-white/5">
              <div className="text-sm font-bold text-[#1d1d1f] dark:text-gray-100 mb-3">
                月度发作分布
                <span className="ml-2 text-[11px] font-normal text-gray-400">
                  红 = 我 · 蓝 = TA 们
                </span>
              </div>
              <div className="flex items-end gap-0.5 h-24 overflow-x-auto pb-1">
                {data.monthly.map((b) => {
                  const t = b.my_episodes + b.their_episodes;
                  const h = (t / monthMax) * 100;
                  const myFrac = t > 0 ? (b.my_episodes / t) * 100 : 0;
                  return (
                    <div key={b.month} className="flex-shrink-0 w-5 flex flex-col items-center group" title={`${b.month}  我 ${b.my_episodes} · TA ${b.their_episodes}`}>
                      <div className="w-full bg-gray-100 dark:bg-white/5 rounded-t" style={{ height: `${h}%` }}>
                        <div className="w-full bg-[#fa5151]" style={{ height: `${myFrac}%` }} />
                        <div className="w-full bg-[#576b95]" style={{ height: `${100 - myFrac}%` }} />
                      </div>
                      <div className="text-[8px] text-gray-400 mt-0.5">{b.month.slice(5)}</div>
                    </div>
                  );
                })}
              </div>
              <div className="text-[10px] text-gray-400 mt-2">
                {data.monthly[0]?.month} ~ {data.monthly[data.monthly.length - 1]?.month} · 共 {data.monthly.length} 月有记录
              </div>
            </div>
          )}

          {/* 最近时间线 */}
          {data.timeline.length > 0 && (
            <div className="px-7 py-5">
              <div className="text-sm font-bold text-[#1d1d1f] dark:text-gray-100 mb-3">
                最近的生病片段
              </div>
              <div className="space-y-2">
                {data.timeline.map((t, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <span className="font-mono text-[10px] text-gray-400 w-20 flex-shrink-0 mt-0.5">
                      {t.date}
                    </span>
                    <span className={`inline-block w-1 h-1 rounded-full mt-2 flex-shrink-0 ${t.who === 'me' ? 'bg-[#fa5151]' : 'bg-[#576b95]'}`} />
                    <div className="flex-1 min-w-0">
                      <span className={`text-[10px] font-bold uppercase tracking-wider mr-1.5 ${t.who === 'me' ? 'text-[#fa5151]' : 'text-[#576b95]'}`}>
                        {t.who === 'me' ? '我' : t.display_name}
                      </span>
                      <span className="text-gray-700 dark:text-gray-300 break-words">{t.snippet}</span>
                    </div>
                  </div>
                ))}
              </div>
              {data.timeline.length >= 30 && (
                <div className="text-[10px] text-gray-400 text-center mt-3">
                  只显示最近 30 条；想看完整记录请去对应联系人详情页
                </div>
              )}
            </div>
          )}

          <WelinkBrand
            label="健康日记"
            leftText={<>已扫描 {data.scanned_contacts} 个联系人 · 命中 {data.contacts_with_hits} 人</>}
          />
        </div>
      )}
    </div>
  );
};

export default HealthLog;
