/**
 * 关系星图 —— 我的微信宇宙
 *
 * 后端 GET /api/me/relation-graph 返回节点+边；前端用迷你力导向布局画 SVG。
 * 节点大小 = 消息量，边粗细 = 共同群数。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Network, Loader2, RefreshCw, Share2, Check } from 'lucide-react';
import { toPng } from 'html-to-image';

interface Node {
  id: string;
  display_name: string;
  avatar?: string;
  messages: number;
  peak_hour: number;
  period: string;
  group_count: number;
}
interface Edge {
  source: string;
  target: string;
  weight: number;
}
interface GraphResp {
  nodes: Node[];
  edges: Edge[];
  total_contacts: number;
}

interface SimNode extends Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number; // 显示半径
}

const SVG_W = 720;
const SVG_H = 540;

export const RelationGraph: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [data, setData] = useState<GraphResp | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const fetchData = async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await axios.get<GraphResp>('/api/me/relation-graph?limit=80');
      setData(r.data);
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } }; message?: string })
        ?.response?.data?.error || (e as Error).message || '加载失败';
      setErr(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  // 计算稳态布局（一次性同步算）
  const layout = useMemo(() => {
    if (!data || data.nodes.length === 0) return null;
    const maxMsg = Math.max(...data.nodes.map(n => n.messages));
    const nodes: SimNode[] = data.nodes.map((n, i) => ({
      ...n,
      x: SVG_W / 2 + Math.cos(i * 2 * Math.PI / data.nodes.length) * 200,
      y: SVG_H / 2 + Math.sin(i * 2 * Math.PI / data.nodes.length) * 200,
      vx: 0,
      vy: 0,
      r: 8 + Math.sqrt(n.messages / Math.max(maxMsg, 1)) * 22,
    }));
    const idx: Record<string, number> = {};
    nodes.forEach((n, i) => { idx[n.id] = i; });
    const edges = data.edges
      .map(e => ({ s: idx[e.source], t: idx[e.target], w: e.weight }))
      .filter(e => e.s !== undefined && e.t !== undefined);

    // 物理参数
    const ITERS = 250;
    const REPULSION = 1500;        // 排斥
    const SPRING_K = 0.025;        // 弹簧常数
    const TARGET_LEN = 90;         // 弹簧自然长度
    const CENTER_PULL = 0.005;     // 向中心拉
    const DAMPING = 0.85;
    const cx = SVG_W / 2, cy = SVG_H / 2;

    for (let it = 0; it < ITERS; it++) {
      // 排斥
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) d2 = 1;
          const f = REPULSION / d2;
          const d = Math.sqrt(d2);
          const fx = (dx / d) * f;
          const fy = (dy / d) * f;
          nodes[i].vx += fx; nodes[i].vy += fy;
          nodes[j].vx -= fx; nodes[j].vy -= fy;
        }
      }
      // 弹簧
      for (const e of edges) {
        const a = nodes[e.s], b = nodes[e.t];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const len = TARGET_LEN / Math.max(1, Math.log2(e.w + 1)); // 共同群越多越近
        const f = (d - len) * SPRING_K * Math.min(e.w, 5);
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }
      // 中心引力
      for (const n of nodes) {
        n.vx += (cx - n.x) * CENTER_PULL;
        n.vy += (cy - n.y) * CENTER_PULL;
      }
      // 应用 + 阻尼
      for (const n of nodes) {
        n.vx *= DAMPING; n.vy *= DAMPING;
        n.x += n.vx; n.y += n.vy;
        // clip 到边界（带 padding）
        n.x = Math.max(n.r + 4, Math.min(SVG_W - n.r - 4, n.x));
        n.y = Math.max(n.r + 4, Math.min(SVG_H - n.r - 4, n.y));
      }
    }
    return { nodes, edges };
  }, [data]);

  const periodColor = (p: string) => {
    switch (p) {
      case 'morning': return '#f59e0b';
      case 'day': return '#10b981';
      case 'evening': return '#06b6d4';
      case 'night': return '#8b5cf6';
      default: return '#6366f1';
    }
  };

  const exportPng = async () => {
    if (!data || !cardRef.current || exporting) return;
    setExporting(true);
    try {
      const node = cardRef.current.cloneNode(true) as HTMLElement;
      const wrapper = document.createElement('div');
      wrapper.style.cssText = `
        width: 760px; background: #0a0a14; padding: 20px;
        font-family: system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
        position: fixed; left: -10000px; top: 0; z-index: -1;
      `;
      wrapper.appendChild(node);
      const footer = document.createElement('div');
      footer.style.cssText = 'padding:14px 4px 4px; color:#666; font-size:11px; text-align:center;';
      footer.innerHTML = `WeLink · 我的关系星图 · ${new Date().toLocaleDateString('zh-CN')}`;
      wrapper.appendChild(footer);
      document.body.appendChild(wrapper);
      const url = await toPng(wrapper, { pixelRatio: 2, cacheBust: true });
      document.body.removeChild(wrapper);
      const a = document.createElement('a');
      a.href = url;
      a.download = `welink-relation-graph-${Date.now()}.png`;
      a.click();
      setExported(true);
      setTimeout(() => setExported(false), 3000);
    } catch (e) {
      alert('导出失败：' + ((e as Error).message || '未知错误'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-4 mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Network size={16} className="text-indigo-500" />
            <div className="text-sm font-bold text-[#1d1d1f] dark:text-gray-100">关系星图 · 我的微信宇宙</div>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            把私聊最多的 80 位联系人画成一张星图。共同在某个群的人会被画在一起 —— 越聚集说明圈子越紧密。
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={fetchData}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-indigo-500 to-violet-500 disabled:opacity-50"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {loading ? '布局中…' : '重新布局'}
          </button>
          {data && (
            <button
              onClick={exportPng}
              disabled={exporting}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 disabled:opacity-50"
            >
              {exporting ? <Loader2 size={12} className="animate-spin" /> : exported ? <Check size={12} className="text-[#07c160]" /> : <Share2 size={12} />}
              {exporting ? '生成图片…' : exported ? '已下载' : '导出'}
            </button>
          )}
        </div>
      </div>

      {err && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/30 p-3 mb-4 text-xs text-red-700 dark:text-red-300">{err}</div>
      )}

      {loading && !data && (
        <div className="text-center py-16 text-gray-400 text-sm">扫描群成员关系中…</div>
      )}

      {data && layout && (
        <>
          <div ref={cardRef} className="rounded-2xl bg-[#0a0a14] overflow-hidden">
            <div className="px-6 pt-5 pb-2 flex items-baseline justify-between">
              <div>
                <div className="text-xs uppercase tracking-widest text-indigo-300 font-bold">Relation Constellation</div>
                <div className="text-xl font-black text-white">我的微信宇宙</div>
              </div>
              <div className="text-[11px] text-white/50">
                {data.nodes.length} 颗星 · {data.edges.length} 条连线
              </div>
            </div>
            <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
              {/* 边 */}
              {layout.edges.map((e, i) => {
                const a = layout.nodes[e.s];
                const b = layout.nodes[e.t];
                const isHi = hovered && (a.id === hovered || b.id === hovered);
                return (
                  <line
                    key={i}
                    x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    stroke={isHi ? '#a78bfa' : '#4338ca'}
                    strokeOpacity={isHi ? 0.7 : 0.18}
                    strokeWidth={Math.min(0.4 + e.w * 0.4, 3)}
                  />
                );
              })}
              {/* 节点 */}
              {layout.nodes.map(n => {
                const isHi = hovered === n.id;
                return (
                  <g key={n.id} onMouseEnter={() => setHovered(n.id)} onMouseLeave={() => setHovered(null)} style={{ cursor: 'pointer' }}>
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={n.r}
                      fill={periodColor(n.period)}
                      fillOpacity={isHi ? 0.95 : 0.7}
                      stroke={isHi ? '#fff' : 'rgba(255,255,255,0.2)'}
                      strokeWidth={isHi ? 2 : 1}
                    />
                    {(n.r > 16 || isHi) && (
                      <text
                        x={n.x}
                        y={n.y + n.r + 11}
                        textAnchor="middle"
                        fontSize={10}
                        fill="rgba(255,255,255,0.85)"
                        style={{ pointerEvents: 'none', fontWeight: 600 }}
                      >
                        {n.display_name.length > 10 ? n.display_name.slice(0, 10) + '…' : n.display_name}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
            {/* 图例 */}
            <div className="px-6 pb-4 flex flex-wrap gap-3 text-[10px] text-white/60">
              <Legend color="#f59e0b" label="清晨型 (06-11)" />
              <Legend color="#10b981" label="白天型 (11-17)" />
              <Legend color="#06b6d4" label="傍晚型 (17-23)" />
              <Legend color="#8b5cf6" label="深夜型 (23-06)" />
              <span className="ml-auto opacity-60">气泡大小 = 消息量 · 连线 = 共同群</span>
            </div>
          </div>
          {hovered && (
            <div className="mt-3 rounded-xl border border-indigo-200 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-500/10 p-3 text-xs text-indigo-900 dark:text-indigo-200">
              {(() => {
                const n = layout.nodes.find(x => x.id === hovered);
                if (!n) return null;
                return (
                  <>
                    <strong>{n.display_name}</strong> · {n.messages.toLocaleString()} 条消息 · 在 {n.group_count} 个共同群里
                  </>
                );
              })()}
            </div>
          )}
        </>
      )}
    </div>
  );
};

const Legend: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <span className="inline-flex items-center gap-1.5">
    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: color }} />
    {label}
  </span>
);

export default RelationGraph;
