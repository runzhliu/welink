/**
 * 我的语言进化史
 *
 * GET /api/me/language-evolution → 按年画"我"说话风格的 4 条变化曲线：
 *   - 句长（avg_chars）
 *   - emoji 使用率（emoji_per_100）
 *   - 英文夹杂率（english_pct）
 *   - 活跃日均（msgs_per_day）
 *
 * 加每年的"那一年的我"卡片：开场白 Top 1 + 最长一句 + 4 个数字。
 * 零 LLM。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { TrendingUp, Loader2, Share2, Check, RefreshCw } from 'lucide-react';
import html2canvas from 'html2canvas';
import { prepareForCapture } from '../../utils/exportPng';
import { useToast } from '../common/Toast';

interface Opener {
  text: string;
  count: number;
}

interface YearStat {
  year: number;
  my_messages: number;
  my_chars: number;
  avg_chars: number;
  emoji_count: number;
  emoji_per_100: number;
  english_msgs: number;
  english_pct: number;
  active_days: number;
  msgs_per_day: number;
  top_openers: Opener[];
  longest_message: string;
  longest_len: number;
}

interface Resp {
  years: YearStat[];
  total_my_messages: number;
  total_my_chars: number;
  first_year: number;
  last_year: number;
  contacts_scanned: number;
  generated_at: number;
}

const fmtNum = (n: number) => n.toLocaleString('zh-CN');
const fmtPct = (v: number) => (v * 100).toFixed(1) + '%';
const fmtFloat = (v: number, d = 1) => v.toFixed(d);

interface Metric {
  key: 'avg_chars' | 'emoji_per_100' | 'english_pct' | 'msgs_per_day';
  label: string;
  unit: string;
  format: (v: number) => string;
  desc: string;
}

const METRICS: Metric[] = [
  { key: 'avg_chars',     label: '句长', unit: '字',     format: (v) => fmtFloat(v, 1),  desc: '每条消息平均字数' },
  { key: 'emoji_per_100', label: 'emoji 浓度', unit: '/100', format: (v) => fmtFloat(v, 1), desc: '每 100 条消息的 emoji 数' },
  { key: 'english_pct',   label: '英文夹杂率', unit: '%', format: (v) => fmtPct(v),       desc: '含英文字母的消息占比' },
  { key: 'msgs_per_day',  label: '日均产量',  unit: '条', format: (v) => fmtFloat(v, 1),  desc: '活跃日的日均发言数' },
];

export const LanguageEvolution: React.FC = () => {
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
      const r = await axios.get<Resp>('/api/me/language-evolution', {
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
      footer.innerHTML = `WeLink · 语言进化史 · welink.click · ${today}`;
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
      a.download = `welink-language-evolution-${Date.now()}.png`;
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

  // 计算每个 metric 的最早 / 最晚值，给"演变结论"用
  const conclusions = useMemo(() => {
    if (!data || data.years.length < 2) return null;
    const first = data.years[0];
    const last = data.years[data.years.length - 1];
    const out: Array<{ key: Metric['key']; label: string; from: number; to: number; delta: number; verb: string }> = [];
    for (const m of METRICS) {
      const a = first[m.key];
      const b = last[m.key];
      if (a === 0 && b === 0) continue;
      const delta = b - a;
      const pct = a > 0 ? (delta / a) * 100 : 0;
      let verb = '保持稳定';
      if (Math.abs(pct) >= 30 || (Math.abs(pct) >= 10 && Math.abs(delta) > 0.5)) {
        verb = pct > 0 ? '上升' : '下降';
      }
      out.push({ key: m.key, label: m.label, from: a, to: b, delta, verb });
    }
    return out;
  }, [data]);

  return (
    <div className="max-w-3xl mx-auto">
      {/* 顶部说明 + 操作 */}
      <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-4 mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={16} className="text-[#07c160]" />
            <div className="text-sm font-bold text-[#1d1d1f] dark:text-gray-100">我的语言进化史</div>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            把"我"发的所有文本按年聚合，画 4 条说话风格的演变曲线：句长 / emoji 浓度 / 英文夹杂率 / 日均产量。
            纯统计、零 LLM。
          </div>
        </div>
        <div className="shrink-0 flex gap-2">
          <button
            onClick={() => fetchData(true)}
            disabled={loading || refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 disabled:opacity-50"
            title="重算（绕过 2h 缓存）"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? '重算中…' : '重算'}
          </button>
          {data && data.years.length > 0 && (
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

      {data && data.years.length === 0 && !loading && (
        <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-8 text-center text-sm text-gray-500">
          没有足够的数据 —— 每年至少要有 50 条文本消息才会出卡片。
        </div>
      )}

      {data && data.years.length > 0 && (
        <>
          {/* 总览数字 */}
          <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-4 mb-4">
            <div className="grid grid-cols-3 gap-2">
              <BigStat label="跨年" value={data.last_year - data.first_year + 1} unit="年" />
              <BigStat label="累计发言" value={fmtNum(data.total_my_messages)} unit="条" />
              <BigStat label="累计敲" value={fmtNum(data.total_my_chars)} unit="字" />
            </div>
            {conclusions && conclusions.some(c => c.verb !== '保持稳定') && (
              <div className="mt-3 pt-3 border-t border-gray-100 dark:border-white/10 flex flex-wrap gap-2">
                {conclusions.filter(c => c.verb !== '保持稳定').map(c => (
                  <span
                    key={c.key}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold ${
                      c.verb === '上升'
                        ? 'bg-[#07c160]/10 text-[#07c160]'
                        : 'bg-orange-50 text-[#ff9500] dark:bg-orange-500/10'
                    }`}
                  >
                    {c.label} {c.verb} ·
                    <span className="font-mono">
                      {c.key === 'english_pct' ? fmtPct(c.from) : fmtFloat(c.from, 1)}
                      &nbsp;→&nbsp;
                      {c.key === 'english_pct' ? fmtPct(c.to) : fmtFloat(c.to, 1)}
                    </span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 4 条曲线 */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            {METRICS.map(m => (
              <MetricChart key={m.key} metric={m} years={data.years} />
            ))}
          </div>

          {/* 每年的我 */}
          <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-4 mb-4">
            <div className="text-sm font-bold text-[#1d1d1f] dark:text-gray-100 mb-3">每一年的「我」</div>
            <div className="space-y-3">
              {data.years.map(y => (
                <YearCard key={y.year} y={y} />
              ))}
            </div>
          </div>

          {/* 隐藏导出卡 */}
          <div className="absolute -left-[99999px] -top-[99999px] pointer-events-none" aria-hidden>
            <div ref={cardRef} className="bg-white" style={{ width: 720 }}>
              <ShareCard data={data} today={today} />
            </div>
          </div>
        </>
      )}
    </div>
  );
};

const BigStat: React.FC<{ label: string; value: string | number; unit: string }> = ({ label, value, unit }) => (
  <div className="rounded-xl bg-gray-50 dark:bg-white/5 p-3">
    <div className="text-[10px] text-gray-500 dark:text-gray-400">{label}</div>
    <div className="flex items-baseline gap-1 mt-0.5">
      <span className="text-2xl font-black text-[#07c160] tabular-nums">{value}</span>
      <span className="text-[10px] text-gray-400">{unit}</span>
    </div>
  </div>
);

// ───── 折线图（小型 SVG，单 metric） ────────────────────────────────────
const MetricChart: React.FC<{ metric: Metric; years: YearStat[] }> = ({ metric, years }) => {
  const W = 320, H = 110, padL = 28, padR = 8, padT = 14, padB = 22;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const values = years.map(y => y[metric.key]);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;
  const points = years.map((y, i) => {
    const x = padL + (years.length === 1 ? innerW / 2 : (i / (years.length - 1)) * innerW);
    const yp = padT + innerH - ((y[metric.key] - minV) / range) * innerH;
    return { x, y: yp, val: y[metric.key], year: y.year };
  });
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  return (
    <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-3">
      <div className="flex items-baseline justify-between mb-1">
        <div className="text-xs font-bold text-[#1d1d1f] dark:text-gray-100">{metric.label}</div>
        <div className="text-[10px] text-gray-400">{metric.desc}</div>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        {/* y 轴标签：max / min */}
        <text x={padL - 4} y={padT + 4} textAnchor="end" fontSize="9" fill="#8a94a6">{metric.format(maxV)}</text>
        <text x={padL - 4} y={padT + innerH} textAnchor="end" fontSize="9" fill="#8a94a6">{metric.format(minV)}</text>
        {/* 折线 */}
        <path d={pathD} stroke="#07c160" strokeWidth="2" fill="none" />
        {/* 点 + 当年值 */}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="3" fill="#07c160" />
            <text x={p.x} y={H - 6} textAnchor="middle" fontSize="9" fill="#8a94a6">{p.year}</text>
          </g>
        ))}
      </svg>
    </div>
  );
};

const YearCard: React.FC<{ y: YearStat }> = ({ y }) => {
  const opener = y.top_openers[0];
  return (
    <div className="rounded-xl border border-gray-100 dark:border-white/10 bg-gray-50 dark:bg-white/5 p-3">
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-2xl font-black text-[#07c160] tabular-nums">{y.year}</span>
        <span className="text-[11px] text-gray-500 dark:text-gray-400">
          {fmtNum(y.my_messages)} 条 · {fmtNum(y.my_chars)} 字 · {y.active_days} 天活跃
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2 mb-2">
        <MiniStat label="句长"     value={fmtFloat(y.avg_chars, 1)} unit="字" />
        <MiniStat label="emoji"    value={fmtFloat(y.emoji_per_100, 1)} unit="/100" />
        <MiniStat label="英文"     value={fmtPct(y.english_pct)} />
        <MiniStat label="日均"     value={fmtFloat(y.msgs_per_day, 1)} unit="条" />
      </div>
      {opener && (
        <div className="text-[12px] text-gray-700 dark:text-gray-300 mb-1">
          <span className="text-gray-400">最常用开场白：</span>
          <span className="font-bold">「{opener.text}」</span>
          <span className="text-gray-400"> × {opener.count}</span>
        </div>
      )}
      {y.longest_message && (
        <div className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed min-w-0">
          <span className="text-gray-400">那年说过最长一句（{y.longest_len} 字）：</span>
          <span className="block mt-0.5 italic break-all whitespace-pre-wrap">「{y.longest_message}」</span>
        </div>
      )}
    </div>
  );
};

const MiniStat: React.FC<{ label: string; value: string; unit?: string }> = ({ label, value, unit }) => (
  <div className="rounded-lg bg-white dark:bg-white/10 p-1.5 text-center">
    <div className="text-[9px] text-gray-500 dark:text-gray-400">{label}</div>
    <div className="text-sm font-bold text-[#07c160] tabular-nums">
      {value}
      {unit && <span className="text-[9px] text-gray-400 ml-0.5 font-normal">{unit}</span>}
    </div>
  </div>
);

// ───── 分享卡 ─────────────────────────────────────────────────────────
const ShareCard: React.FC<{ data: Resp; today: string }> = ({ data, today }) => {
  const span = data.last_year - data.first_year + 1;
  return (
    <div className="font-sans">
      <div className="px-7 py-7" style={{ background: 'linear-gradient(135deg,#07c160,#10aeff)' }}>
        <div className="text-[11px] uppercase tracking-[0.2em] text-white/85 font-bold mb-2">
          LANGUAGE EVOLUTION · 我的语言进化史
        </div>
        <div className="text-2xl font-black text-white leading-snug mb-1">
          {span} 年的我，话变了 {span > 1 ? '吗？' : ''}
        </div>
        <div className="flex flex-wrap gap-3 text-[11px] text-white/85 mt-2">
          <span><strong className="text-white">{fmtNum(data.total_my_messages)}</strong> 条发言</span>
          <span><strong className="text-white">{fmtNum(data.total_my_chars)}</strong> 字</span>
          <span><strong className="text-white">{data.first_year}–{data.last_year}</strong></span>
        </div>
      </div>

      {/* 4 个 metric 表格 */}
      <div style={{ background: '#fff', padding: '20px 28px 8px' }}>
        {METRICS.map(m => (
          <ShareMetricRow key={m.key} metric={m} years={data.years} />
        ))}
      </div>

      {/* 每年开场白 + 最长 */}
      <div style={{ background: '#f7f8fa', padding: '16px 28px 22px' }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: '#07c160', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10 }}>
          每一年说过的话
        </div>
        {data.years.map(y => (
          <div key={y.year} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '8px 0', borderBottom: '1px solid #eef1f7' }}>
            <div style={{ width: 48, fontSize: 14, fontWeight: 900, color: '#07c160' }}>{y.year}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {y.top_openers[0] && (
                <div style={{ fontSize: 12, color: '#1d1d1f', marginBottom: 2 }}>
                  最常用开场：<strong>「{y.top_openers[0].text}」</strong>
                  <span style={{ color: '#8a94a6', marginLeft: 6 }}>× {y.top_openers[0].count}</span>
                </div>
              )}
              {y.longest_message && (
                <div style={{
                  fontSize: 11, color: '#576b95', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  paddingLeft: 8, borderLeft: '2px solid rgba(7,193,96,0.3)',
                }}>
                  「{y.longest_message}」
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const ShareMetricRow: React.FC<{ metric: Metric; years: YearStat[] }> = ({ metric, years }) => {
  const W = 600, H = 60, padL = 30, padR = 10, padT = 8, padB = 16;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const values = years.map(y => y[metric.key]);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;
  const points = years.map((y, i) => {
    const x = padL + (years.length === 1 ? innerW / 2 : (i / (years.length - 1)) * innerW);
    const yp = padT + innerH - ((y[metric.key] - minV) / range) * innerH;
    return { x, y: yp, val: y[metric.key], year: y.year };
  });
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: '#1d1d1f' }}>{metric.label}</span>
        <span style={{ fontSize: 10, color: '#8a94a6' }}>
          {metric.format(values[0])} → {metric.format(values[values.length - 1])}
        </span>
      </div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <text x={padL - 4} y={padT + 6} textAnchor="end" fontSize="9" fill="#8a94a6">{metric.format(maxV)}</text>
        <text x={padL - 4} y={padT + innerH} textAnchor="end" fontSize="9" fill="#8a94a6">{metric.format(minV)}</text>
        <path d={pathD} stroke="#07c160" strokeWidth="2" fill="none" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="2.5" fill="#07c160" />
            <text x={p.x} y={H - 4} textAnchor="middle" fontSize="9" fill="#8a94a6">{p.year}</text>
          </g>
        ))}
      </svg>
    </div>
  );
};

export default LanguageEvolution;
