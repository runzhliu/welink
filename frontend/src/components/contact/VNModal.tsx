/**
 * VNModal — 视觉小说 / 互动小说全屏 Modal
 *
 * 三个阶段：
 *   1. lobby   开局：选模式（free / quest）、看 facts 预览、可读档历史存档
 *   2. playing 游戏中：渲染当前章节 narration + 选项；可读档
 *   3. ending  通关：结局徽章 + 简易回顾（Phase 3 升级成 Wrapped）
 */

import React, { useCallback, useEffect, useState } from 'react';
import { X, BookOpen, Loader2, Sparkles, Heart, Skull, Star, Trophy, EyeOff, RotateCcw, ChevronRight, Trash2 } from 'lucide-react';
import { vnApi } from '../../services/api';
import type { VNChapterDTO, VNStateDTO, VNStoryDTO, VNStartResponse, VNEndingDTO } from '../../services/api';
import { useVNStream } from '../../hooks/useVNStream';
import { VNEndingPage } from './VNEndingPage';

interface Props {
  username: string;
  displayName: string;
  onClose: () => void;
}

type Stage = 'lobby' | 'loading' | 'playing' | 'ending';
type Mode = 'free' | 'quest' | 'memory';

export const VNModal: React.FC<Props> = ({ username, displayName, onClose }) => {
  const [stage, setStage] = useState<Stage>('lobby');
  const [story, setStory] = useState<VNStoryDTO | null>(null);
  const [chapters, setChapters] = useState<VNChapterDTO[]>([]);
  const [state, setState] = useState<VNStateDTO | null>(null);
  const [ending, setEnding] = useState<VNEndingDTO | null>(null);
  const [history, setHistory] = useState<VNStoryDTO[]>([]);
  const [error, setError] = useState('');

  // 开局表单
  const [mode, setMode] = useState<Mode>('free');
  const [quest, setQuest] = useState('');
  const [memoryDate, setMemoryDate] = useState('');
  const [maxChapters, setMaxChapters] = useState(6);
  const [startInfo, setStartInfo] = useState<VNStartResponse | null>(null);

  // 文生图开关：与设置页 image_enabled 联动
  const [imageEnabled, setImageEnabled] = useState(false);
  useEffect(() => {
    void fetch('/api/preferences').then(r => r.json()).then((p: { image_enabled?: boolean }) => {
      setImageEnabled(Boolean(p.image_enabled));
    }).catch(() => {});
  }, []);

  const vn = useVNStream();

  // ESC 关闭（仅在 lobby 阶段；playing 时避免误关）
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stage === 'lobby') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [stage, onClose]);

  // 拉历史存档
  const loadHistory = useCallback(async () => {
    try {
      const r = await vnApi.listStories(username);
      setHistory(r.stories || []);
    } catch {
      // 静默
    }
  }, [username]);
  useEffect(() => { void loadHistory(); }, [loadHistory]);

  // 拉一章
  const fetchNextChapter = useCallback(async (storyId: number) => {
    setError('');
    await vn.start(storyId);
  }, [vn]);

  // useVNStream done → 把章节并入本地列表 + 切状态
  useEffect(() => {
    if (vn.status !== 'done') return;
    if (vn.chapter) {
      setChapters(prev => {
        const exists = prev.some(c => c.chapter_idx === vn.chapter!.chapter_idx);
        if (exists) return prev;
        return [...prev, vn.chapter as VNChapterDTO];
      });
    }
    if (vn.state) setState(vn.state);
    if (vn.ending) {
      setEnding(vn.ending);
      setStage('ending');
    }
    if ((vn.title || vn.synopsis) && story) {
      setStory({ ...story, title: vn.title ?? story.title, synopsis: vn.synopsis ?? story.synopsis });
    }
  }, [vn.status, vn.chapter, vn.state, vn.ending, vn.title, vn.synopsis, story]);

  // 开新档
  const handleStart = async () => {
    setError('');
    setStage('loading');
    try {
      const r = await vnApi.start({
        username,
        mode,
        quest: mode === 'quest' ? quest : '',
        memory_date: mode === 'memory' ? memoryDate : '',
        max_chapters: maxChapters,
      });
      setStartInfo(r);
      const full = await vnApi.getStory(r.story_id);
      setStory(full.story);
      setChapters(full.chapters || []);
      setState(full.story.state);
      setStage('playing');
      await fetchNextChapter(r.story_id);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? '开局失败';
      setError(msg);
      setStage('lobby');
    }
  };

  // 读档
  const handleLoad = async (storyId: number) => {
    setError('');
    setStage('loading');
    try {
      const full = await vnApi.getStory(storyId);
      setStory(full.story);
      setChapters(full.chapters || []);
      setState(full.story.state);
      setEnding(full.story.ending ?? null);
      // 已结束 → 直接 ending；进行中 → playing
      if (full.story.status === 'ended') {
        setStage('ending');
      } else {
        setStage('playing');
        // 看末章是否已选；未选不用拉新；已选则继续拉下一章
        const last = full.chapters[full.chapters.length - 1];
        if (last && last.chosen_idx >= 0 && full.chapters.length < full.story.max_chapters) {
          await fetchNextChapter(storyId);
        }
      }
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? '读档失败';
      setError(msg);
      setStage('lobby');
    }
  };

  // 选选项
  const handleChoose = async (chapterIdx: number, optionIdx: number) => {
    if (!story) return;
    setError('');
    try {
      const r = await vnApi.choose(story.id, chapterIdx, optionIdx);
      setState(r.state);
      // 更新本地章节
      setChapters(prev => prev.map(c =>
        c.chapter_idx === chapterIdx ? { ...c, chosen_idx: optionIdx, state_after: r.state } : c
      ));
      // 触发下一章
      if (r.can_continue) {
        await fetchNextChapter(story.id);
      } else if (story && chapters.length < story.max_chapters) {
        // 即便 can_continue=false（dealbreaker），也让 LLM 写最后一章 + ending
        await fetchNextChapter(story.id);
      }
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? '提交选项失败';
      setError(msg);
    }
  };

  // 删档
  const handleDelete = async (storyId: number) => {
    if (!confirm('删除这条剧情存档？')) return;
    try {
      await vnApi.deleteStory(storyId);
      await loadHistory();
    } catch (e) {
      console.error(e);
    }
  };

  // 读档回滚到某章
  const handleRewind = async (toChapter: number) => {
    if (!story) return;
    if (!confirm(`回滚到第 ${toChapter + 1} 章？之后的剧情将丢失。`)) return;
    try {
      const r = await vnApi.rewind(story.id, toChapter);
      setState(r.state);
      setChapters(prev => prev.filter(c => c.chapter_idx <= toChapter).map(c =>
        c.chapter_idx === toChapter ? { ...c, chosen_idx: -1, state_after: undefined } : c
      ));
      setEnding(null);
      if (story.status === 'ended') {
        setStory({ ...story, status: 'running', ending_type: '', ending: undefined });
      }
      setStage('playing');
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? '回滚失败';
      setError(msg);
    }
  };

  const currentChapter = chapters.length > 0 ? chapters[chapters.length - 1] : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-0 md:p-4" onClick={() => stage === 'lobby' && onClose()}>
      <div
        className="bg-white dark:bg-[#1d1d1f] w-full h-full md:rounded-3xl md:max-w-4xl md:h-[88vh] shadow-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-white/10">
          <div className="flex items-center gap-2 min-w-0">
            <BookOpen size={18} className="text-[#a78bfa] flex-shrink-0" />
            <span className="text-base font-bold text-[#1d1d1f] dk-text truncate">
              {stage === 'lobby' ? `互动小说 · ${displayName}` : (story?.title || `互动小说 · ${displayName}`)}
            </span>
            {state && stage !== 'lobby' && (
              <div className="hidden sm:flex items-center gap-1.5 ml-3 text-xs text-gray-400">
                <Heart size={12} className="text-pink-400" />
                <span className="font-mono tabular-nums">{state.affinity}/100</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {stage === 'playing' && story && (
              <span className="hidden sm:inline text-xs text-gray-400 font-mono tabular-nums">
                {chapters.length}/{story.max_chapters}
              </span>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* 进度条（playing 阶段） */}
        {stage === 'playing' && story && (
          <div className="h-1 bg-gray-100 dark:bg-white/10">
            <div
              className="h-full bg-gradient-to-r from-[#a78bfa] to-[#fb7185] transition-all duration-500"
              style={{ width: `${(chapters.length / story.max_chapters) * 100}%` }}
            />
          </div>
        )}

        {/* 主体 */}
        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="mx-5 mt-4 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-500/10 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          {stage === 'lobby' && (
            <LobbyView
              displayName={displayName}
              mode={mode}
              setMode={setMode}
              quest={quest}
              setQuest={setQuest}
              memoryDate={memoryDate}
              setMemoryDate={setMemoryDate}
              maxChapters={maxChapters}
              setMaxChapters={setMaxChapters}
              onStart={handleStart}
              history={history}
              onLoad={handleLoad}
              onDelete={handleDelete}
            />
          )}

          {stage === 'loading' && (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400 gap-2">
              <Loader2 size={28} className="animate-spin text-[#a78bfa]" />
              <div className="text-sm">导演正在准备剧本…</div>
            </div>
          )}

          {stage === 'playing' && (
            <PlayingView
              storyId={story?.id ?? null}
              chapters={chapters}
              currentChapter={currentChapter}
              streaming={vn.status === 'streaming'}
              streamingNarration={vn.narration}
              streamingIdx={vn.chapterIdx}
              imageEnabled={imageEnabled}
              onChoose={handleChoose}
              onRewind={handleRewind}
              onChapterImageReady={(idx, hash) => {
                setChapters(prev => prev.map(c => c.chapter_idx === idx ? { ...c, image_hash: hash } : c));
              }}
              startInfo={startInfo}
            />
          )}

          {stage === 'ending' && ending && story && (
            <VNEndingPage
              ending={ending}
              story={story}
              chapters={chapters}
              displayName={displayName}
              onRewind={handleRewind}
              onRestart={() => { setStage('lobby'); setStory(null); setChapters([]); setEnding(null); setState(null); vn.reset(); void loadHistory(); }}
            />
          )}
        </div>
      </div>
    </div>
  );
};

// ── Lobby ────────────────────────────────────────────────────────────────────

const LobbyView: React.FC<{
  displayName: string;
  mode: Mode;
  setMode: (m: Mode) => void;
  quest: string;
  setQuest: (s: string) => void;
  memoryDate: string;
  setMemoryDate: (s: string) => void;
  maxChapters: number;
  setMaxChapters: (n: number) => void;
  onStart: () => void;
  history: VNStoryDTO[];
  onLoad: (id: number) => void;
  onDelete: (id: number) => void;
}> = ({ displayName, mode, setMode, quest, setQuest, memoryDate, setMemoryDate, maxChapters, setMaxChapters, onStart, history, onLoad, onDelete }) => {
  return (
    <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
      {/* 介绍 */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#a78bfa]/10 text-[#a78bfa] text-xs font-bold">
          <Sparkles size={12} />
          实验中
        </div>
        <h2 className="text-xl font-black text-[#1d1d1f] dk-text">和 {displayName} 写一段故事</h2>
        <p className="text-xs text-gray-400 leading-relaxed">
          AI 用 {displayName} 的「分身画像」和真实事件素材，生成一段 5-8 章的互动剧情。<br />
          剧情仅在本地处理，所有选择只影响这一档存档。请尊重当事人。
        </p>
      </div>

      {/* 模式选择 */}
      <section>
        <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">选择模式</div>
        <div className="grid grid-cols-3 gap-3">
          <ModeCard
            active={mode === 'free'}
            onClick={() => setMode('free')}
            icon={<BookOpen size={16} />}
            title="自由探索"
            desc="无固定目标"
          />
          <ModeCard
            active={mode === 'quest'}
            onClick={() => setMode('quest')}
            icon={<Star size={16} />}
            title="带目标"
            desc="给一个目标推剧情"
          />
          <ModeCard
            active={mode === 'memory'}
            onClick={() => setMode('memory')}
            icon={<RotateCcw size={16} />}
            title="回忆改编"
            desc="基于真实某天"
          />
        </div>
        {mode === 'quest' && (
          <input
            type="text"
            value={quest}
            onChange={e => setQuest(e.target.value)}
            placeholder="例：让 TA 答应一起去日本"
            className="mt-3 w-full text-sm border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#a78bfa] bg-[#f8f9fb] dk-input"
          />
        )}
        {mode === 'memory' && (
          <div className="mt-3 space-y-2">
            <input
              type="date"
              value={memoryDate}
              onChange={e => setMemoryDate(e.target.value)}
              className="w-full text-sm border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#a78bfa] bg-[#f8f9fb] dk-input"
            />
            <p className="text-[11px] text-gray-400">
              挑一天你和 TA 真实聊过的日期 —— AI 会以那天的对话为起点，写「假如那天换种回应」的平行剧情。
            </p>
          </div>
        )}
      </section>

      {/* 章节数 */}
      <section>
        <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">章节数</div>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={3}
            max={10}
            step={1}
            value={maxChapters}
            onChange={e => setMaxChapters(parseInt(e.target.value, 10))}
            className="flex-1 accent-[#a78bfa]"
          />
          <span className="text-sm font-bold text-[#1d1d1f] dk-text font-mono w-10 text-center">{maxChapters}</span>
        </div>
      </section>

      <button
        onClick={onStart}
        disabled={(mode === 'quest' && !quest.trim()) || (mode === 'memory' && !memoryDate)}
        className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-gradient-to-r from-[#a78bfa] to-[#fb7185] text-white text-sm font-bold rounded-xl shadow-sm hover:shadow-md disabled:opacity-50"
      >
        <Sparkles size={14} /> 开启新剧情
      </button>

      {/* 存档 */}
      {history.length > 0 && (
        <section>
          <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">历史存档（{history.length}）</div>
          <div className="space-y-2">
            {history.slice(0, 8).map(s => (
              <SaveSlot key={s.id} story={s} onLoad={() => onLoad(s.id)} onDelete={() => onDelete(s.id)} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

const ModeCard: React.FC<{ active: boolean; onClick: () => void; icon: React.ReactNode; title: string; desc: string }> = ({ active, onClick, icon, title, desc }) => (
  <button
    onClick={onClick}
    className={`text-left p-3 rounded-xl border transition-all ${
      active
        ? 'border-[#a78bfa] bg-[#a78bfa]/10'
        : 'border-gray-200 dark:border-white/10 hover:border-[#a78bfa]/50'
    }`}
  >
    <div className={`flex items-center gap-2 font-bold text-sm mb-1 ${active ? 'text-[#a78bfa]' : 'text-[#1d1d1f] dk-text'}`}>
      {icon}{title}
    </div>
    <div className="text-xs text-gray-400 leading-relaxed">{desc}</div>
  </button>
);

const SaveSlot: React.FC<{ story: VNStoryDTO; onLoad: () => void; onDelete: () => void }> = ({ story, onLoad, onDelete }) => {
  const isEnded = story.status === 'ended';
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 dark:border-white/10 hover:border-[#a78bfa]/50 transition-colors group">
      <button onClick={onLoad} className="flex-1 text-left min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-bold text-[#1d1d1f] dk-text truncate">{story.title || '（未命名）'}</span>
          {isEnded && story.ending_type && <EndingBadge type={story.ending_type} size="sm" />}
        </div>
        <div className="text-xs text-gray-400 flex items-center gap-2">
          <span>{new Date(story.updated_at * 1000).toLocaleDateString()}</span>
          <span>·</span>
          <span>{story.mode === 'free' ? '自由' : story.mode === 'quest' ? '带目标' : '回忆改编'}</span>
          {!isEnded && <span>· 进行中</span>}
        </div>
      </button>
      <button onClick={onDelete} className="p-1.5 text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
        <Trash2 size={14} />
      </button>
    </div>
  );
};

// ── Playing ──────────────────────────────────────────────────────────────────

const PlayingView: React.FC<{
  storyId: number | null;
  chapters: VNChapterDTO[];
  currentChapter: VNChapterDTO | null;
  streaming: boolean;
  streamingNarration: string;
  streamingIdx: number | null;
  imageEnabled: boolean;
  onChoose: (chapterIdx: number, optionIdx: number) => void;
  onRewind: (toChapter: number) => void;
  onChapterImageReady: (chapterIdx: number, hash: string) => void;
  startInfo: VNStartResponse | null;
}> = ({ storyId, chapters, currentChapter, streaming, streamingNarration, streamingIdx, imageEnabled, onChoose, onRewind, onChapterImageReady, startInfo }) => {
  // 当前章节：如果正在流式，渲染流式累积；否则用末章
  const displayingStreaming = streaming && streamingIdx !== null && (!currentChapter || streamingIdx > currentChapter.chapter_idx);

  const [coverLoadingIdx, setCoverLoadingIdx] = useState<number | null>(null);
  const [coverError, setCoverError] = useState('');

  const handleGenerateCover = async (chapterIdx: number) => {
    if (!storyId) return;
    setCoverLoadingIdx(chapterIdx);
    setCoverError('');
    try {
      const r = await vnApi.generateCover(storyId, chapterIdx);
      onChapterImageReady(chapterIdx, r.hash);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? '生图失败';
      setCoverError(msg);
    } finally {
      setCoverLoadingIdx(null);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">
      {/* 前情提要（除当前章外的历史章节折叠卡片） */}
      {chapters.slice(0, -1).map(ch => (
        <HistoryChapterCard key={ch.chapter_idx} chapter={ch} onRewind={() => onRewind(ch.chapter_idx)} />
      ))}

      {/* 当前章节 */}
      {displayingStreaming ? (
        <div className="bg-white dark:bg-white/5 rounded-2xl p-5 border border-[#a78bfa]/30 shadow-sm">
          <div className="text-xs font-bold text-[#a78bfa] mb-2 flex items-center gap-1">
            <Loader2 size={12} className="animate-spin" />
            第 {(streamingIdx ?? 0) + 1} 章
          </div>
          <div className="text-[15px] leading-[1.9] text-[#1d1d1f] dark:text-gray-100 whitespace-pre-wrap">
            {streamingNarration}
            <span className="inline-block w-1.5 h-4 bg-[#a78bfa] ml-0.5 animate-pulse align-middle" />
          </div>
        </div>
      ) : currentChapter ? (
        <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
          {/* 封面图（如已生成） */}
          {currentChapter.image_hash && (
            <img
              src={`/api/image/cache/${currentChapter.image_hash}`}
              alt={`第 ${currentChapter.chapter_idx + 1} 章封面`}
              className="w-full h-auto block"
            />
          )}
          <div className="p-5">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-bold text-[#a78bfa]">第 {currentChapter.chapter_idx + 1} 章</div>
              {imageEnabled && !currentChapter.image_hash && (
                <button
                  onClick={() => void handleGenerateCover(currentChapter.chapter_idx)}
                  disabled={coverLoadingIdx === currentChapter.chapter_idx}
                  title="为本章生成场景封面图（约 10-30 秒）"
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold text-[#a78bfa] bg-[#a78bfa]/10 hover:bg-[#a78bfa]/20 disabled:opacity-50"
                >
                  {coverLoadingIdx === currentChapter.chapter_idx
                    ? <Loader2 size={10} className="animate-spin" />
                    : <Sparkles size={10} />}
                  {coverLoadingIdx === currentChapter.chapter_idx ? '出图中…' : '✨ 生封面'}
                </button>
              )}
            </div>
            {coverError && coverLoadingIdx === null && (
              <div className="mb-2 text-[11px] text-red-500">{coverError}</div>
            )}
            <div className="text-[15px] leading-[1.9] text-[#1d1d1f] dark:text-gray-100 whitespace-pre-wrap">
              {currentChapter.narration}
            </div>

            {/* 选项 */}
            {currentChapter.chosen_idx < 0 && currentChapter.choices.length > 0 && (
              <div className="mt-5 space-y-2">
                {currentChapter.choices.map((c, idx) => (
                  <button
                    key={idx}
                    onClick={() => onChoose(currentChapter.chapter_idx, idx)}
                    className="w-full text-left flex items-start gap-3 p-3 rounded-xl border border-gray-200 dark:border-white/10 hover:border-[#a78bfa] hover:bg-[#a78bfa]/5 transition-all group"
                  >
                    <ChevronRight size={16} className="text-gray-300 group-hover:text-[#a78bfa] mt-0.5 flex-shrink-0 transition-colors" />
                    <span className="text-sm font-medium text-[#1d1d1f] dark:text-gray-100 flex-1">{c.text}</span>
                    {c.tone && <span className="text-[10px] text-gray-300 font-mono uppercase tracking-wide">{c.tone}</span>}
                  </button>
                ))}
              </div>
            )}

            {currentChapter.chosen_idx >= 0 && (
              <div className="mt-4 text-xs text-gray-400 italic">
                你选了：「{currentChapter.choices[currentChapter.chosen_idx]?.text}」
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* 已知线索（仅开局首屏短暂展示） */}
      {startInfo && chapters.length === 0 && !streaming && startInfo.facts.length > 0 && (
        <div className="bg-gray-50 dark:bg-white/5 rounded-2xl p-4">
          <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">已知线索（来自记忆）</div>
          <ul className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
            {startInfo.facts.slice(0, 5).map((f, i) => (
              <li key={i}>· {f.fact}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

const HistoryChapterCard: React.FC<{ chapter: VNChapterDTO; onRewind: () => void }> = ({ chapter, onRewind }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="bg-gray-50 dark:bg-white/5 rounded-xl p-3 border border-gray-100 dark:border-white/10 text-xs">
      <div className="flex items-center justify-between mb-1">
        <span className="font-bold text-gray-500 dark:text-gray-400">第 {chapter.chapter_idx + 1} 章</span>
        <button onClick={onRewind} className="text-gray-300 hover:text-[#a78bfa]" title="回滚到此处">
          <RotateCcw size={12} />
        </button>
      </div>
      <div
        className={`text-gray-600 dark:text-gray-300 leading-relaxed cursor-pointer ${expanded ? '' : 'line-clamp-2'}`}
        onClick={() => setExpanded(v => !v)}
      >
        {chapter.narration}
      </div>
      {chapter.chosen_idx >= 0 && chapter.choices[chapter.chosen_idx] && (
        <div className="mt-1.5 text-gray-400 italic">→ {chapter.choices[chapter.chosen_idx].text}</div>
      )}
    </div>
  );
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const EndingBadge: React.FC<{ type: string; size?: 'sm' | 'lg' }> = ({ type, size = 'sm' }) => {
  const meta: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    true:   { label: 'TRUE',   color: 'text-amber-500 bg-amber-500/15',   icon: <Trophy size={size === 'lg' ? 28 : 12} /> },
    happy:  { label: 'HAPPY',  color: 'text-pink-500 bg-pink-500/15',     icon: <Heart size={size === 'lg' ? 28 : 12} /> },
    normal: { label: 'NORMAL', color: 'text-gray-500 bg-gray-200',         icon: <BookOpen size={size === 'lg' ? 28 : 12} /> },
    bad:    { label: 'BAD',    color: 'text-red-500 bg-red-500/15',       icon: <Skull size={size === 'lg' ? 28 : 12} /> },
    secret: { label: 'SECRET', color: 'text-violet-500 bg-violet-500/15', icon: <EyeOff size={size === 'lg' ? 28 : 12} /> },
  };
  const m = meta[type] ?? meta.normal;
  if (size === 'lg') {
    return (
      <div className={`inline-flex items-center gap-2 px-5 py-3 rounded-2xl font-black text-lg ${m.color}`}>
        {m.icon}{m.label} ENDING
      </div>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${m.color}`}>
      {m.icon}{m.label}
    </span>
  );
};

export default VNModal;
