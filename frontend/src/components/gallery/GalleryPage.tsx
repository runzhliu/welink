/**
 * GalleryPage — AI 画廊
 *
 * - 列表：grid 缩略图，懒加载（lazy）
 * - 过滤：搜索 prompt+tags / scene / provider / 仅 starred
 * - 操作：⭐ 收藏 / 删除（软删）/ 「基于此重新生成」modal
 * - 大图查看：ImageDetailModal 展示元信息 + used_in 引用
 */

import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { Image as ImageIcon, Search, Star, X, Trash2, RefreshCw, Loader2, Download, Sparkles } from 'lucide-react';
import { useImageTask } from '../../hooks/useImageTask';

interface UsedInEntry {
  kind: string;
  ref?: string;
  at?: number;
}

interface ImageRec {
  hash: string;
  prompt: string;
  scene: string;
  provider: string;
  model: string;
  size: string;
  task_id?: string;
  parent_hash?: string;
  starred: boolean;
  tags?: string[];
  used_in?: UsedInEntry[];
  created_at: number;
  deleted_at?: number;
  url: string;
}

const SCENE_LABELS: Record<string, string> = {
  '': '其它',
  avatar: '联系人头像',
  highlight: '高光瞬间',
  group_year_review_cover: '群年报封面',
  year_review: '年报',
  test: '测试',
  generate: '直接生成',
  playground: '试玩',
};

const SCENE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '全部场景' },
  { value: 'avatar', label: '联系人头像' },
  { value: 'highlight', label: '高光瞬间' },
  { value: 'group_year_review_cover', label: '群年报封面' },
  { value: 'generate', label: '直接生成' },
  { value: 'test', label: '测试' },
];

export const GalleryPage: React.FC = () => {
  const [images, setImages] = useState<ImageRec[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 过滤参数
  const [q, setQ] = useState('');
  const [scene, setScene] = useState('');
  const [starredOnly, setStarredOnly] = useState(false);

  // 弹窗
  const [detail, setDetail] = useState<ImageRec | null>(null);
  const [regenSrc, setRegenSrc] = useState<ImageRec | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params: Record<string, string> = { limit: '120' };
      if (q.trim()) params.q = q.trim();
      if (scene) params.scene = scene;
      if (starredOnly) params.starred = '1';
      const r = await axios.get<{ images: ImageRec[]; total: number }>('/api/images', { params });
      setImages(r.data.images || []);
      setTotal(r.data.total || 0);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? '加载失败';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [q, scene, starredOnly]);

  useEffect(() => { void load(); }, [load]);

  const toggleStar = async (img: ImageRec) => {
    setImages(prev => prev.map(i => i.hash === img.hash ? { ...i, starred: !i.starred } : i));
    try {
      await axios.patch(`/api/images/${img.hash}`, { starred: !img.starred });
    } catch {
      // 出错时回滚
      setImages(prev => prev.map(i => i.hash === img.hash ? { ...i, starred: img.starred } : i));
    }
  };

  const softDelete = async (img: ImageRec) => {
    if (!confirm('删除这张图？(可在 30 天内通过画廊恢复)')) return;
    setImages(prev => prev.filter(i => i.hash !== img.hash));
    try {
      await axios.delete(`/api/images/${img.hash}`);
    } catch {
      void load(); // 失败时重拉
    }
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <ImageIcon size={24} className="text-[#a78bfa]" />
        <h1 className="text-2xl font-black text-[#1d1d1f] dk-text">AI 画廊</h1>
        <span className="text-sm text-gray-400">共 {total} 张</span>
      </div>

      {/* 过滤栏 */}
      <div className="bg-white dk-card rounded-2xl border border-gray-100 dk-border p-4 mb-6 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="搜索 prompt / 标签…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-white/10 rounded-xl focus:outline-none focus:border-[#a78bfa] bg-[#f8f9fb] dk-input"
          />
        </div>
        <select
          value={scene}
          onChange={e => setScene(e.target.value)}
          className="text-sm border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 focus:outline-none focus:border-[#a78bfa] bg-white dk-input"
        >
          {SCENE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-gray-600 dark:text-gray-300">
          <input type="checkbox" checked={starredOnly} onChange={e => setStarredOnly(e.target.checked)} className="w-4 h-4 accent-[#fb923c]" />
          仅收藏
        </label>
      </div>

      {/* 列表 */}
      {error && <div className="text-sm text-red-500 mb-4">{error}</div>}
      {loading && images.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 size={20} className="animate-spin mr-2" /> 加载中…
        </div>
      ) : images.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <ImageIcon size={48} className="mb-3 opacity-40" />
          <div className="text-sm">画廊还空着。去高光瞬间 / 群年报封面 / 联系人头像 生第一张图吧。</div>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {images.map(img => (
            <GalleryCard
              key={img.hash}
              img={img}
              onOpen={() => setDetail(img)}
              onStar={() => void toggleStar(img)}
              onDelete={() => void softDelete(img)}
              onRegen={() => setRegenSrc(img)}
            />
          ))}
        </div>
      )}

      {detail && <ImageDetailModal img={detail} onClose={() => setDetail(null)} onRegen={() => { setRegenSrc(detail); setDetail(null); }} />}
      {regenSrc && (
        <RegenerateModal
          src={regenSrc}
          onClose={() => setRegenSrc(null)}
          onDone={() => { setRegenSrc(null); void load(); }}
        />
      )}
    </div>
  );
};

export default GalleryPage;

// ─── 单张卡片 ────────────────────────────────────────────────────────────────

const GalleryCard: React.FC<{
  img: ImageRec;
  onOpen: () => void;
  onStar: () => void;
  onDelete: () => void;
  onRegen: () => void;
}> = ({ img, onOpen, onStar, onDelete, onRegen }) => {
  return (
    <div className="relative group rounded-xl overflow-hidden border border-gray-100 dark:border-white/10 bg-gray-50 dark:bg-white/5 aspect-square">
      <img
        src={img.url}
        alt={img.prompt}
        loading="lazy"
        onClick={onOpen}
        className="w-full h-full object-cover cursor-zoom-in"
      />

      {/* 顶部 chip */}
      <div className="absolute top-2 left-2 flex items-center gap-1.5">
        {img.starred && <Star size={14} className="text-[#fb923c] fill-[#fb923c]" />}
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-black/50 text-white backdrop-blur-sm">
          {SCENE_LABELS[img.scene] ?? img.scene}
        </span>
      </div>

      {/* 悬浮操作条 */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-end gap-1">
        <button onClick={(e) => { e.stopPropagation(); onStar(); }} title="收藏" className="p-1.5 rounded-lg bg-white/15 hover:bg-white/30 text-white">
          <Star size={12} className={img.starred ? 'fill-[#fb923c] text-[#fb923c]' : ''} />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onRegen(); }} title="基于此重新生成" className="p-1.5 rounded-lg bg-white/15 hover:bg-white/30 text-white">
          <RefreshCw size={12} />
        </button>
        <a href={img.url} download={`${img.hash.slice(0, 8)}.png`} onClick={(e) => e.stopPropagation()} title="下载" className="p-1.5 rounded-lg bg-white/15 hover:bg-white/30 text-white">
          <Download size={12} />
        </a>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} title="删除" className="p-1.5 rounded-lg bg-red-500/30 hover:bg-red-500/60 text-white">
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
};

// ─── 大图 Modal ──────────────────────────────────────────────────────────────

const ImageDetailModal: React.FC<{
  img: ImageRec;
  onClose: () => void;
  onRegen: () => void;
}> = ({ img, onClose, onRegen }) => {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white dark:bg-[#1d1d1f] rounded-3xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col md:flex-row" onClick={e => e.stopPropagation()}>
        <div className="md:w-2/3 bg-black flex items-center justify-center min-h-[300px]">
          <img src={img.url} alt={img.prompt} className="max-w-full max-h-[90vh] object-contain" />
        </div>
        <div className="md:w-1/3 flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/10">
            <span className="text-sm font-bold text-[#1d1d1f] dk-text">图片详情</span>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700">
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 text-sm">
            <Meta label="场景" value={SCENE_LABELS[img.scene] ?? img.scene} />
            <Meta label="Provider" value={`${img.provider} · ${img.model}`} />
            <Meta label="尺寸" value={img.size} />
            <Meta label="生成时间" value={new Date(img.created_at * 1000).toLocaleString()} />
            {img.parent_hash && <Meta label="源图" value={img.parent_hash.slice(0, 12) + '…'} />}
            <div>
              <div className="text-xs font-bold text-gray-400 mb-1 uppercase tracking-wide">Prompt</div>
              <div className="text-xs leading-relaxed text-gray-700 dark:text-gray-300 whitespace-pre-wrap bg-gray-50 dark:bg-white/5 p-3 rounded-lg">{img.prompt}</div>
            </div>
            {img.used_in && img.used_in.length > 0 && (
              <div>
                <div className="text-xs font-bold text-gray-400 mb-1 uppercase tracking-wide">用在哪</div>
                <div className="space-y-1">
                  {img.used_in.map((u, i) => (
                    <div key={i} className="text-xs text-gray-600 dark:text-gray-400">
                      <span className="font-bold text-[#a78bfa]">{u.kind}</span>
                      {u.ref && <span className="ml-1 font-mono">· {u.ref}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 px-5 py-3 border-t border-gray-100 dark:border-white/10">
            <button onClick={onRegen} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-gradient-to-r from-[#a78bfa] to-[#fb7185] text-white text-sm font-bold rounded-xl shadow-sm hover:shadow-md">
              <Sparkles size={14} /> 基于此重生成
            </button>
            <a href={img.url} download={`${img.hash.slice(0, 8)}.png`} className="px-3 py-2 border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 text-sm font-bold rounded-xl hover:border-[#07c160] hover:text-[#07c160]">
              <Download size={14} />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

const Meta: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <div className="text-xs font-bold text-gray-400 mb-0.5 uppercase tracking-wide">{label}</div>
    <div className="text-sm text-gray-700 dark:text-gray-300">{value}</div>
  </div>
);

// ─── 重新生成 Modal ──────────────────────────────────────────────────────────

const RegenerateModal: React.FC<{
  src: ImageRec;
  onClose: () => void;
  onDone: () => void;
}> = ({ src, onClose, onDone }) => {
  const [prompt, setPrompt] = useState(src.prompt);
  const [size, setSize] = useState(src.size);
  const task = useImageTask();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && task.status !== 'running') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, task.status]);

  const start = () => {
    // 走画廊专属的 regenerate 接口（自动带 scene + parent_hash），由 hook 处理轮询
    void task.submitTo(`/api/images/${src.hash}/regenerate`, {
      prompt: prompt.trim(),
      size,
    });
  };

  const busy = task.status === 'queued' || task.status === 'running';
  const finished = task.status === 'done';

  // 完成时通知父级刷新画廊
  useEffect(() => {
    if (finished) {
      const t = setTimeout(onDone, 800);
      return () => clearTimeout(t);
    }
  }, [finished, onDone]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" onClick={() => { if (!busy) onClose(); }}>
      <div className="bg-white dark:bg-[#1d1d1f] rounded-3xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col md:flex-row" onClick={e => e.stopPropagation()}>
        <div className="md:w-1/2 bg-black flex items-center justify-center min-h-[280px]">
          <img src={task.url ?? src.url} alt="原图" className="max-w-full max-h-[80vh] object-contain" />
        </div>
        <div className="md:w-1/2 flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/10">
            <span className="text-sm font-bold text-[#1d1d1f] dk-text">基于此重新生成</span>
            <button onClick={() => { if (!busy) onClose(); }} className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-50" disabled={busy}>
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            <div>
              <div className="text-xs font-bold text-gray-400 mb-1 uppercase tracking-wide">Prompt（可修改）</div>
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                rows={6}
                disabled={busy}
                className="w-full text-sm border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 focus:outline-none focus:border-[#a78bfa] bg-[#f8f9fb] dk-input"
              />
            </div>
            <div>
              <div className="text-xs font-bold text-gray-400 mb-1 uppercase tracking-wide">尺寸</div>
              <select value={size} onChange={e => setSize(e.target.value)} disabled={busy}
                className="w-full text-sm border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 focus:outline-none focus:border-[#a78bfa] bg-white dk-input">
                <option value="1024x1024">1024×1024 方形</option>
                <option value="1024x1792">1024×1792 竖版</option>
                <option value="1792x1024">1792×1024 横版</option>
              </select>
            </div>

            {busy && (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin text-[#a78bfa]" />
                  <div className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-white/10 overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-[#a78bfa] to-[#fb7185] transition-[width] duration-500" style={{ width: `${Math.max(task.progress, 5)}%` }} />
                  </div>
                  <span className="text-[10px] text-gray-400 font-mono tabular-nums">{task.progress}%</span>
                </div>
                <button onClick={() => void task.cancel()} className="text-xs text-gray-400 hover:text-red-500">取消</button>
              </div>
            )}
            {task.status === 'failed' && (
              <div className="text-xs text-red-500">{task.error}</div>
            )}
            {finished && (
              <div className="text-xs text-[#07c160]">✓ 生成完成，画廊列表正在刷新…</div>
            )}
          </div>
          <div className="flex items-center gap-2 px-5 py-3 border-t border-gray-100 dark:border-white/10">
            <button
              onClick={() => { if (finished) task.reset(); start(); }}
              disabled={busy || !prompt.trim()}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-gradient-to-r from-[#a78bfa] to-[#fb7185] text-white text-sm font-bold rounded-xl shadow-sm hover:shadow-md disabled:opacity-50"
            >
              <Sparkles size={14} /> {finished ? '再来一张' : '开始生成'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
