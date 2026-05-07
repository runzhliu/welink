/**
 * 聊天地图 / Chat Geography
 *
 * GET /api/me/chat-geography → 词典 NER 抽取地名 → bubble cloud + Top 列表
 *
 * 零 LLM、零外部地图 API、零新增依赖。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Globe2, Loader2, RefreshCw, Share2, Check, MapPin } from 'lucide-react';
import html2canvas from 'html2canvas';
import { avatarSrc } from '../../utils/avatar';
import { prepareForCapture } from '../../utils/exportPng';
import { useToast } from '../common/Toast';

type Tier =
  | 'china_metro' | 'china_city' | 'china_scenic'
  | 'abroad_city' | 'abroad_country' | 'region';

interface ContactRef {
  username: string;
  display_name: string;
  avatar?: string;
  count: number;
}

interface Place {
  name: string;
  tier: Tier;
  mentions: number;
  contacts: number;
  top_with?: ContactRef[];
}

interface Resp {
  places: Place[];
  total_mentions: number;
  unique_places: number;
  contacts_scanned: number;
  messages_scanned: number;
  generated_at: number;
}

const fmtNum = (n: number) => n.toLocaleString('zh-CN');

const TIER_META: Record<Tier, { label: string; icon: string; color: string; ring: string }> = {
  china_metro:    { label: '一线 / 直辖市', icon: '🏙️', color: '#07c160', ring: '#07c160' },
  china_city:     { label: '中国城市',       icon: '🏘️', color: '#10aeff', ring: '#10aeff' },
  china_scenic:   { label: '国内景点',       icon: '🏞️', color: '#ff9500', ring: '#ff9500' },
  abroad_city:    { label: '海外城市',       icon: '🌍', color: '#a259ff', ring: '#a259ff' },
  abroad_country: { label: '国家 / 大区',    icon: '🌐', color: '#576b95', ring: '#576b95' },
  region:         { label: '港 / 澳 / 台',    icon: '🏝️', color: '#ff5e62', ring: '#ff5e62' },
};

type Tab = 'all' | Tier;

const TIER_TABS: { key: Tab; label: string }[] = [
  { key: 'all',             label: '全部' },
  { key: 'china_metro',     label: '一线' },
  { key: 'china_city',      label: '城市' },
  { key: 'china_scenic',    label: '景点' },
  { key: 'abroad_city',     label: '海外' },
  { key: 'abroad_country',  label: '国家' },
];

export const ChatGeography: React.FC = () => {
  const toast = useToast();
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const fetchData = async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setErr('');
    try {
      const r = await axios.get<Resp>('/api/me/chat-geography', {
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

  const visible = useMemo(() => {
    if (!data) return [];
    if (tab === 'all') return data.places;
    return data.places.filter(p => p.tier === tab);
  }, [data, tab]);

  // bubble 大小映射（log 压缩）
  const sizeOf = (mentions: number, max: number) => {
    const minPx = 40;
    const maxPx = 110;
    const t = Math.log(1 + mentions) / Math.log(1 + max);
    return Math.max(minPx, Math.min(maxPx, minPx + (maxPx - minPx) * t));
  };

  const maxMentions = data ? Math.max(...data.places.map(p => p.mentions), 1) : 1;
  const today = new Date().toLocaleDateString('zh-CN');

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
      const footer = document.createElement('div');
      footer.style.cssText =
        'padding:14px 28px; background:#f7f8fa; color:#8a94a6; font-size:11px; text-align:center; border-top:1px solid #eef1f7;';
      footer.innerHTML = `WeLink · 聊天地图 · welink.click · ${today}`;
      wrapper.appendChild(footer);
      document.body.appendChild(wrapper);
      await prepareForCapture(wrapper);
      const canvas = await html2canvas(wrapper, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      });
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `welink-chat-geography-${Date.now()}.png`;
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
      {/* 顶部 */}
      <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-4 mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Globe2 size={16} className="text-[#07c160]" />
            <div className="text-sm font-bold text-[#1d1d1f] dark:text-gray-100">聊天地图</div>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            从所有私聊里抽出地名（中国城市 / 景点 / 海外城市 / 国家），看你聊起最多的地方是哪些。
            子串匹配 + 同消息内同名只计一次。零 LLM、内置词典约 200 条。
          </div>
        </div>
        <div className="shrink-0 flex gap-2">
          <button
            onClick={() => fetchData(true)}
            disabled={loading || refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 disabled:opacity-50"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? '重算中…' : '重算'}
          </button>
          {data && data.places.length > 0 && (
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

      {data && data.places.length === 0 && !loading && (
        <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-8 text-center text-sm text-gray-500">
          没有匹配到任何地名。可能你聊的话题不太涉及地理 ✨
        </div>
      )}

      {data && data.places.length > 0 && (
        <>
          {/* 数字总览 */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <BigStat label="提到的地方" value={fmtNum(data.unique_places)} unit="个" />
            <BigStat label="被提及次数" value={fmtNum(data.total_mentions)} unit="次" />
            <BigStat label="扫描消息"   value={fmtNum(data.messages_scanned)} unit="条" />
          </div>

          {/* tier 筛选 */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            {TIER_TABS.map(t => {
              const sel = tab === t.key;
              const cnt = t.key === 'all'
                ? data.places.length
                : data.places.filter(p => p.tier === t.key).length;
              if (t.key !== 'all' && cnt === 0) return null;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                    sel
                      ? 'bg-[#07c160] text-white'
                      : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10'
                  }`}
                >
                  {t.label}
                  <span className={`text-[10px] ${sel ? 'opacity-80' : 'text-gray-400'}`}>{cnt}</span>
                </button>
              );
            })}
          </div>

          {/* bubble cloud */}
          <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-4 mb-4">
            <div className="text-[11px] text-gray-400 uppercase tracking-widest font-bold mb-2">
              气泡按提及次数大小
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 py-3 min-h-[180px]">
              {visible.slice(0, 40).map(p => {
                const meta = TIER_META[p.tier];
                const size = sizeOf(p.mentions, maxMentions);
                return (
                  <div
                    key={p.name}
                    className="rounded-full flex items-center justify-center text-white shadow-sm transition-transform hover:scale-105"
                    style={{
                      width: size, height: size,
                      background: `linear-gradient(135deg, ${meta.color}, ${meta.color}dd)`,
                      fontSize: Math.max(10, size / 6),
                    }}
                    title={`${p.name} · 被提到 ${p.mentions} 次 · ${p.contacts} 人聊起`}
                  >
                    <div className="text-center leading-tight">
                      <div className="font-bold">{p.name}</div>
                      <div className="text-[9px] opacity-80">{p.mentions}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Top 列表 */}
          <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] overflow-hidden">
            {visible.map((p, i) => (
              <PlaceRow key={p.name} place={p} rank={i + 1} max={maxMentions} />
            ))}
          </div>

          {/* 隐藏导出卡 */}
          <div className="absolute -left-[99999px] -top-[99999px] pointer-events-none" aria-hidden>
            <div ref={cardRef} className="bg-white" style={{ width: 720 }}>
              <ShareCard data={data} today={today} sizeOf={sizeOf} maxMentions={maxMentions} />
            </div>
          </div>
        </>
      )}
    </div>
  );
};

const BigStat: React.FC<{ label: string; value: string; unit: string }> = ({ label, value, unit }) => (
  <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-3">
    <div className="text-[10px] text-gray-500 dark:text-gray-400">{label}</div>
    <div className="flex items-baseline gap-1 mt-0.5">
      <span className="text-2xl font-black text-[#07c160] tabular-nums">{value}</span>
      <span className="text-[10px] text-gray-400">{unit}</span>
    </div>
  </div>
);

const PlaceRow: React.FC<{ place: Place; rank: number; max: number }> = ({ place: p, rank, max }) => {
  const meta = TIER_META[p.tier];
  const pct = (p.mentions / max) * 100;
  return (
    <div className="px-4 py-3 border-b border-gray-50 dark:border-white/5 last:border-b-0">
      <div className="flex items-center gap-3">
        <div className="text-xs text-gray-400 w-6 text-center">{rank}</div>
        <div
          className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-xl"
          style={{ background: meta.color + '15' }}
          title={meta.label}
        >
          {meta.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <div className="text-sm font-bold text-gray-800 dark:text-gray-100">{p.name}</div>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: meta.color + '15', color: meta.color }}>
              {meta.label}
            </span>
          </div>
          <div className="h-1 rounded-full bg-gray-100 dark:bg-white/10 overflow-hidden">
            <div className="h-full" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${meta.color}, ${meta.color}aa)` }} />
          </div>
          {p.top_with && p.top_with.length > 0 && (
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <MapPin size={10} className="text-gray-400" />
              <span className="text-[11px] text-gray-400">最常和</span>
              {p.top_with.map((c, i) => (
                <span key={i} className="inline-flex items-center gap-1 text-[11px] text-gray-700 dark:text-gray-300">
                  {c.avatar ? (
                    <img src={avatarSrc(c.avatar) || ''} className="w-3.5 h-3.5 rounded-full object-cover" alt="" />
                  ) : null}
                  <span className="truncate max-w-[7em]">{c.display_name}</span>
                  <span className="text-gray-400">×{c.count}</span>
                </span>
              ))}
              <span className="text-[10px] text-gray-400">聊起</span>
            </div>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-2xl font-black tabular-nums leading-none" style={{ color: meta.color }}>{p.mentions}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">提及</div>
        </div>
      </div>
    </div>
  );
};

// ---------- 分享卡 ----------------------------------------------------------

const ShareCard: React.FC<{
  data: Resp;
  today: string;
  sizeOf: (m: number, max: number) => number;
  maxMentions: number;
}> = ({ data, today, sizeOf, maxMentions }) => {
  const top = data.places.slice(0, 20);
  return (
    <div className="font-sans">
      <div style={{ background: 'linear-gradient(135deg,#07c160,#10aeff)', padding: '28px' }}>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 6 }}>
          CHAT GEOGRAPHY · 聊天地图
        </div>
        <div style={{ fontSize: 24, fontWeight: 900, color: '#fff', lineHeight: 1.2, marginBottom: 4 }}>
          我的世界里聊起 {data.unique_places} 个地方
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', display: 'flex', gap: 14 }}>
          <span><strong style={{ color: '#fff' }}>{fmtNum(data.total_mentions)}</strong> 次提及</span>
          <span>扫了 <strong style={{ color: '#fff' }}>{fmtNum(data.messages_scanned)}</strong> 条消息</span>
          <span>{today}</span>
        </div>
      </div>

      {/* bubble cloud */}
      <div style={{
        background: '#fff', padding: '22px 28px',
        display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 8,
        minHeight: 260,
      }}>
        {top.map(p => {
          const meta = TIER_META[p.tier];
          const size = sizeOf(p.mentions, maxMentions);
          return (
            <div
              key={p.name}
              style={{
                width: size, height: size, borderRadius: '50%',
                background: `linear-gradient(135deg, ${meta.color}, ${meta.color}dd)`,
                color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                textAlign: 'center', fontSize: Math.max(10, size / 6), fontWeight: 700,
                boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
              }}
            >
              <div style={{ lineHeight: 1.1 }}>
                {p.name}
                <div style={{ fontSize: 9, opacity: 0.85, fontWeight: 400 }}>{p.mentions}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Top 10 列表 */}
      <div style={{ background: '#f7f8fa', padding: '20px 28px' }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: '#07c160', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10 }}>
          TOP 10
        </div>
        {top.slice(0, 10).map((p, i) => {
          const meta = TIER_META[p.tier];
          return (
            <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #eef1f7' }}>
              <div style={{ width: 24, fontSize: 13, fontWeight: 800, color: meta.color, textAlign: 'center' }}>{i + 1}</div>
              <div style={{ width: 32, height: 32, borderRadius: 10, background: meta.color + '15', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
                {meta.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1d1d1f' }}>{p.name}</div>
                {p.top_with && p.top_with.length > 0 && (
                  <div style={{ fontSize: 11, color: '#8a94a6', marginTop: 2, lineHeight: 1.5, wordBreak: 'break-word' }}>
                    最常和 {p.top_with.map(c => `${c.display_name}×${c.count}`).join(' / ')} 聊起
                  </div>
                )}
              </div>
              <div style={{ fontSize: 18, fontWeight: 900, color: meta.color, fontVariantNumeric: 'tabular-nums' }}>{p.mentions}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ChatGeography;
