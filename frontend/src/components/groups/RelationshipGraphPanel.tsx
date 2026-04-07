/**
 * 群聊人物关系力导向图
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Loader2, Users, Info } from 'lucide-react';
import type { RelationshipGraph, RelationshipEdge } from '../../types';
import { groupsApi } from '../../services/api';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';

interface Props {
  username: string;
}

interface SimNode {
  id: string;
  name: string;
  messages: number;
  community: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  pinned: boolean; // 被拖动时固定
}

const COLORS = ['#07c160', '#10aeff', '#ff9500', '#fa5151', '#576b95', '#40c463', '#8b5cf6', '#ec4899', '#f59e0b', '#06b6d4'];

function initSimulation(nodes: SimNode[], width: number, height: number) {
  const cx = width / 2, cy = height / 2;
  const initRadius = Math.min(width, height) * 0.35;
  nodes.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / nodes.length;
    n.x = cx + initRadius * Math.cos(angle);
    n.y = cy + initRadius * Math.sin(angle);
    n.vx = 0;
    n.vy = 0;
  });
}

function tickSimulation(nodes: SimNode[], edges: RelationshipEdge[], width: number, height: number, alpha: number) {
  const cx = width / 2, cy = height / 2;
  const nodeMap = new Map<string, SimNode>();
  nodes.forEach(n => nodeMap.set(n.id, n));
  const maxWeight = Math.max(1, ...edges.map(e => e.weight));

  // Repulsion
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[j].x - nodes[i].x;
      const dy = nodes[j].y - nodes[i].y;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const force = 800 / (dist * dist);
      const fx = (dx / dist) * force * alpha;
      const fy = (dy / dist) * force * alpha;
      if (!nodes[i].pinned) { nodes[i].vx -= fx; nodes[i].vy -= fy; }
      if (!nodes[j].pinned) { nodes[j].vx += fx; nodes[j].vy += fy; }
    }
  }

  // Attraction along edges
  for (const e of edges) {
    const s = nodeMap.get(e.source);
    const t = nodeMap.get(e.target);
    if (!s || !t) continue;
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const strength = 0.02 * (e.weight / maxWeight);
    const fx = dx * strength * alpha;
    const fy = dy * strength * alpha;
    if (!s.pinned) { s.vx += fx; s.vy += fy; }
    if (!t.pinned) { t.vx -= fx; t.vy -= fy; }
  }

  // Centering force
  for (const n of nodes) {
    if (n.pinned) continue;
    n.vx += (cx - n.x) * 0.005 * alpha;
    n.vy += (cy - n.y) * 0.005 * alpha;
  }

  // Apply velocity
  for (const n of nodes) {
    if (n.pinned) { n.vx = 0; n.vy = 0; continue; }
    n.vx *= 0.6;
    n.vy *= 0.6;
    n.x += n.vx;
    n.y += n.vy;
    n.x = Math.max(n.radius + 10, Math.min(width - n.radius - 10, n.x));
    n.y = Math.max(n.radius + 10, Math.min(height - n.radius - 10, n.y));
  }
}

export const RelationshipGraphPanel: React.FC<Props> = ({ username }) => {
  const { privacyMode } = usePrivacyMode();
  const [graph, setGraph] = useState<RelationshipGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: SimNode; partners: { name: string; weight: number }[] } | null>(null);
  const simNodesRef = useRef<SimNode[]>([]);
  const edgesRef = useRef<RelationshipEdge[]>([]);
  const animRef = useRef<number>(0);
  const dragRef = useRef<{ node: SimNode; offsetX: number; offsetY: number } | null>(null);
  const [showRules, setShowRules] = useState(false);

  // Poll until data is ready
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      while (!cancelled) {
        try {
          const resp = await groupsApi.getRelationships(username);
          if (resp && resp.nodes && resp.nodes.length > 0) {
            setGraph(resp);
            setLoading(false);
            return;
          }
        } catch { /* ignore */ }
        await new Promise(r => setTimeout(r, 1000));
      }
    };
    setLoading(true);
    setGraph(null);
    poll();
    return () => { cancelled = true; };
  }, [username]);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const nodes = simNodesRef.current;
    const edges = edgesRef.current;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = rect.width;
    const height = rect.height;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const nodeMap = new Map<string, SimNode>();
    nodes.forEach(n => nodeMap.set(n.id, n));
    const maxWeight = Math.max(1, ...edges.map(e => e.weight));
    const hoveredId = hovered;

    // Draw edges
    for (const e of edges) {
      const s = nodeMap.get(e.source);
      const t = nodeMap.get(e.target);
      if (!s || !t) continue;
      const isHighlighted = hoveredId && (e.source === hoveredId || e.target === hoveredId);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.strokeStyle = isHighlighted
        ? 'rgba(7, 193, 96, 0.6)'
        : `rgba(200, 200, 200, ${0.1 + (e.weight / maxWeight) * 0.4})`;
      ctx.lineWidth = isHighlighted
        ? 1 + Math.log2(e.weight + 1) * 1.5
        : 0.5 + Math.log2(e.weight + 1) * 0.8;
      ctx.stroke();
    }

    // Draw nodes (colored by community)
    nodes.forEach((n) => {
      const isHighlighted = hoveredId === n.id;
      const isConnected = hoveredId && edges.some(
        e => (e.source === hoveredId && e.target === n.id) || (e.target === hoveredId && e.source === n.id)
      );
      const dimmed = hoveredId && !isHighlighted && !isConnected;

      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius, 0, 2 * Math.PI);
      const color = COLORS[n.community % COLORS.length];
      ctx.fillStyle = dimmed ? 'rgba(200, 200, 200, 0.3)' : color;
      ctx.fill();

      if (isHighlighted) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      const displayName = privacyMode ? '***' : (n.name.length > 6 ? n.name.slice(0, 6) + '…' : n.name);
      ctx.font = `${isHighlighted ? 'bold ' : ''}11px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = dimmed ? 'rgba(160, 160, 160, 0.4)' : 'rgba(80, 80, 80, 0.9)';
      ctx.fillText(displayName, n.x, n.y + n.radius + 14);
    });
  }, [hovered, privacyMode]);

  // Initialize simulation and start animation loop
  useEffect(() => {
    if (!graph || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    const maxMsgs = Math.max(1, ...graph.nodes.map(n => n.messages));
    const simNodes: SimNode[] = graph.nodes.map(n => ({
      ...n,
      community: n.community ?? 0,
      x: 0, y: 0, vx: 0, vy: 0,
      radius: 6 + Math.sqrt(n.messages / maxMsgs) * 20,
      pinned: false,
    }));

    initSimulation(simNodes, width, height);
    // Run initial stabilization
    for (let i = 0; i < 150; i++) {
      tickSimulation(simNodes, graph.edges, width, height, 0.3 * (1 - i / 150));
    }
    simNodesRef.current = simNodes;
    edgesRef.current = graph.edges;

    let alpha = 0.05; // low alpha for gentle continued simulation
    const animate = () => {
      tickSimulation(simNodesRef.current, edgesRef.current, width, height, alpha);
      alpha *= 0.998; // slowly cool down
      if (alpha < 0.001) alpha = 0.001;
      // If dragging, keep alpha warm
      if (dragRef.current) alpha = 0.05;
      render();
      animRef.current = requestAnimationFrame(animate);
    };
    animRef.current = requestAnimationFrame(animate);

    return () => { cancelAnimationFrame(animRef.current); };
  }, [graph, render]);

  // Re-render when hovered changes (via the animation loop it'll pick it up)

  const findNodeAt = useCallback((mx: number, my: number): SimNode | null => {
    for (const n of simNodesRef.current) {
      const dx = mx - n.x;
      const dy = my - n.y;
      if (dx * dx + dy * dy < (n.radius + 4) * (n.radius + 4)) return n;
    }
    return null;
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const node = findNodeAt(mx, my);
    if (node) {
      dragRef.current = { node, offsetX: mx - node.x, offsetY: my - node.y };
      node.pinned = true;
      canvas.style.cursor = 'grabbing';
    }
  }, [findNodeAt]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Dragging
    if (dragRef.current) {
      const { node, offsetX, offsetY } = dragRef.current;
      node.x = mx - offsetX;
      node.y = my - offsetY;
      canvas.style.cursor = 'grabbing';
      return;
    }

    // Hover detection
    const found = findNodeAt(mx, my);
    if (found) {
      setHovered(found.id);
      const partners: { name: string; weight: number }[] = [];
      for (const edge of edgesRef.current) {
        if (edge.source === found.id) partners.push({ name: edge.target, weight: edge.weight });
        else if (edge.target === found.id) partners.push({ name: edge.source, weight: edge.weight });
      }
      partners.sort((a, b) => b.weight - a.weight);
      setTooltip({ x: mx, y: my, node: found, partners: partners.slice(0, 5) });
      canvas.style.cursor = 'grab';
    } else {
      setHovered(null);
      setTooltip(null);
      canvas.style.cursor = 'default';
    }
  }, [findNodeAt]);

  const handleMouseUp = useCallback(() => {
    if (dragRef.current) {
      dragRef.current.node.pinned = false;
      dragRef.current = null;
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (dragRef.current) {
      dragRef.current.node.pinned = false;
      dragRef.current = null;
    }
    setHovered(null);
    setTooltip(null);
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Loader2 size={32} className="text-[#07c160] animate-spin" />
        <div className="text-center">
          <span className="text-sm text-gray-400">正在分析群聊人物关系…</span>
          <p className="text-[10px] text-gray-300 mt-1">需要遍历所有消息计算互动关系，大群请耐心等待</p>
        </div>
      </div>
    );
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="text-center text-gray-300 py-12">暂无足够的互动数据</div>
    );
  }

  const totalInteractions = graph.edges.reduce((s, e) => s + e.weight, 0);
  const topPair = graph.edges[0];
  const communities = graph.communities ?? [];
  const multiMemberCommunities = communities.filter(c => c.size >= 2);

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-[#f8f9fb] dark:bg-white/5 rounded-xl px-4 py-3 text-center">
          <div className="text-lg font-black text-[#1d1d1f] dk-text">{graph.nodes.length}</div>
          <div className="text-[10px] text-gray-400">活跃成员</div>
        </div>
        <div className="bg-[#f8f9fb] dark:bg-white/5 rounded-xl px-4 py-3 text-center">
          <div className="text-lg font-black text-[#1d1d1f] dk-text">{graph.edges.length}</div>
          <div className="text-[10px] text-gray-400">互动关系</div>
        </div>
        <div className="bg-[#f8f9fb] dark:bg-white/5 rounded-xl px-4 py-3 text-center">
          <div className="text-lg font-black text-[#1d1d1f] dk-text">{totalInteractions.toLocaleString()}</div>
          <div className="text-[10px] text-gray-400">互动总次数</div>
        </div>
        <div className="bg-[#f8f9fb] dark:bg-white/5 rounded-xl px-4 py-3 text-center">
          <div className="text-lg font-black text-[#1d1d1f] dk-text">{multiMemberCommunities.length}</div>
          <div className="text-[10px] text-gray-400">小团体</div>
        </div>
      </div>

      {/* Top pair highlight */}
      {topPair && (
        <div className="bg-gradient-to-r from-[#07c16010] to-[#10aeff10] rounded-xl px-4 py-3 flex items-center gap-2">
          <Users size={14} className="text-[#07c160]" />
          <span className="text-xs text-gray-500">最强互动：</span>
          <span className={`text-sm font-bold text-[#1d1d1f] dk-text${privacyMode ? ' privacy-blur' : ''}`}>
            {topPair.source}
          </span>
          <span className="text-xs text-gray-400">↔</span>
          <span className={`text-sm font-bold text-[#1d1d1f] dk-text${privacyMode ? ' privacy-blur' : ''}`}>
            {topPair.target}
          </span>
          <span className="text-xs text-gray-400 ml-auto">{topPair.weight} 次互动</span>
        </div>
      )}

      {/* Force graph canvas */}
      <div className="relative bg-[#f8f9fb] dark:bg-white/5 rounded-xl overflow-hidden" style={{ height: 420 }}>
        <canvas
          ref={canvasRef}
          className="w-full h-full"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        />
        {/* Tooltip - hide during drag */}
        {tooltip && !dragRef.current && (
          <div
            className="absolute pointer-events-none bg-white dark:bg-[#2d2d2f] shadow-xl rounded-xl px-3 py-2 z-10 border border-gray-100 dark:border-white/10"
            style={{
              left: Math.min(tooltip.x + 12, (canvasRef.current?.getBoundingClientRect().width || 400) - 180),
              top: tooltip.y + 12,
              maxWidth: 200,
            }}
          >
            <div className={`text-sm font-bold text-[#1d1d1f] dk-text${privacyMode ? ' privacy-blur' : ''}`}>
              {tooltip.node.name}
            </div>
            <div className="text-[10px] text-gray-400 mb-1">{tooltip.node.messages.toLocaleString()} 条消息</div>
            {tooltip.partners.length > 0 && (
              <div className="border-t border-gray-100 dark:border-white/10 pt-1 mt-1">
                <div className="text-[10px] text-gray-400 mb-0.5">密切互动：</div>
                {tooltip.partners.map(p => (
                  <div key={p.name} className="flex items-center justify-between text-[10px]">
                    <span className={`text-gray-600 dk-text truncate${privacyMode ? ' privacy-blur' : ''}`}>{p.name}</span>
                    <span className="text-gray-400 ml-2 flex-shrink-0">{p.weight}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Legend + rules toggle */}
      <div className="flex items-center justify-center gap-3">
        <span className="text-[10px] text-gray-300">
          节点大小 = 发言量 · 连线粗细 = 互动强度 · 拖动节点可调整布局
        </span>
        <button
          onClick={() => setShowRules(!showRules)}
          className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-[#07c160] transition-colors"
        >
          <Info size={11} />
          {showRules ? '收起' : '计算规则'}
        </button>
      </div>

      {/* Rules explanation */}
      {showRules && (
        <div className="bg-[#f8f9fb] dark:bg-white/5 rounded-xl px-5 py-4 text-xs text-gray-500 dk-text space-y-2">
          <div className="font-bold text-[#1d1d1f] dk-text text-sm mb-2">互动关系计算规则</div>
          <div className="space-y-1.5">
            <div className="flex gap-2">
              <span className="text-[#07c160] font-bold flex-shrink-0">连续回复</span>
              <span>两个不同成员在 <b>2 分钟内</b>先后发言，视为一次互动回复。这是最主要的互动信号。</span>
            </div>
            <div className="flex gap-2">
              <span className="text-[#10aeff] font-bold flex-shrink-0">@提及</span>
              <span>消息中 <b>@某成员</b> 计为一次定向互动，权重为回复的 2 倍。</span>
            </div>
            <div className="flex gap-2">
              <span className="text-[#ff9500] font-bold flex-shrink-0">过滤阈值</span>
              <span>互动总权重 &lt; 3 的弱关系会被过滤，避免噪声干扰。最多展示 200 条关系。</span>
            </div>
            <div className="flex gap-2">
              <span className="text-[#576b95] font-bold flex-shrink-0">节点大小</span>
              <span>与该成员在群内的 <b>总发言数</b> 成正比（开方缩放）。</span>
            </div>
            <div className="flex gap-2">
              <span className="text-[#fa5151] font-bold flex-shrink-0">连线粗细</span>
              <span>与两人之间的互动权重成正比（对数缩放），颜色深浅同理。</span>
            </div>
          </div>
        </div>
      )}

      {/* Community detection results */}
      {multiMemberCommunities.length > 0 && (
        <div className="space-y-3">
          <div className="text-sm font-bold text-[#1d1d1f] dk-text">小团体检测</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {multiMemberCommunities.map((c) => (
              <div
                key={c.id}
                className="bg-[#f8f9fb] dark:bg-white/5 rounded-xl px-4 py-3"
              >
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: COLORS[c.id % COLORS.length] }}
                  />
                  <span className="text-xs font-bold text-[#1d1d1f] dk-text">
                    圈子 {c.id + 1}
                  </span>
                  <span className="text-[10px] text-gray-400 ml-auto">{c.size} 人</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {c.members.map((m) => (
                    <span
                      key={m}
                      className={`inline-block text-[10px] px-2 py-0.5 rounded-full bg-white dark:bg-white/10 text-gray-600 dk-text${privacyMode ? ' privacy-blur' : ''}`}
                    >
                      {m}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
