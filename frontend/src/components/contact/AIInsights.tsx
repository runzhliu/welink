/**
 * AI 洞察 — 关系报告 / 风格画像卡 / AI 日记 / 关系剧本
 * 使用低 token 摘要数据（统计特征 + 采样消息）生成 AI 分析
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { FileText, User, BookOpen, Loader2, Share2, Check, Sparkles, Film } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';
import { generateShareImage } from '../../utils/shareImage';
import { RevealLink } from '../common/RevealLink';
import { TTSButton } from '../common/TTSButton';
import { getPrompt, loadCustomPrompts } from '../../utils/promptTemplates';

interface Props {
  username: string;
  displayName: string;
  avatarUrl?: string;
  onOpenSettings?: () => void;
}

type InsightType = 'report' | 'profile' | 'diary' | 'story';

const INSIGHT_TABS: { key: InsightType; label: string; icon: React.ReactNode; desc: string }[] = [
  { key: 'report', label: '关系报告', icon: <FileText size={14} />, desc: 'AI 分析你们关系的发展阶段、转折点和沟通特点' },
  { key: 'profile', label: '风格画像', icon: <User size={14} />, desc: 'AI 提炼 TA 的性格标签、口头禅和聊天习惯' },
  { key: 'story', label: '关系剧本', icon: <Film size={14} />, desc: 'AI 把这段关系提炼成 3-5 个剧情节点的时间线' },
  { key: 'diary', label: 'AI 日记', icon: <BookOpen size={14} />, desc: '选择一天，AI 根据当天聊天记录生成日记' },
];

const INSIGHT_PROMPT_IDS: Record<InsightType, string> = {
  report: 'insight_report',
  profile: 'insight_profile',
  diary: 'insight_diary',
  story: 'insight_story',
};

export const AIInsights: React.FC<Props> = ({ username, displayName, avatarUrl, onOpenSettings }) => {
  const { privacyMode } = usePrivacyMode();
  const [type, setType] = useState<InsightType>('report');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState('');
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [error, setError] = useState('');
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [diaryDate, setDiaryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [profileId, setProfileId] = useState('');
  const [profiles, setProfiles] = useState<{ id: string; provider: string; model?: string }[]>([]);
  const [customPrompts, setCustomPrompts] = useState<Record<string, string>>({});
  const [showPrompt, setShowPrompt] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  // 加载 LLM profiles + 自定义 prompts
  useEffect(() => {
    fetch('/api/preferences').then(r => r.json()).then(d => {
      const ps = d?.llm_profiles ?? [];
      setProfiles(ps);
      if (ps.length > 0 && !profileId) setProfileId(ps[0].id);
      if (d?.prompt_templates) setCustomPrompts(d.prompt_templates);
    }).catch(() => {});
  }, []);

  // 预加载摘要数据
  useEffect(() => {
    setSummaryLoading(true);
    fetch(`/api/contacts/ai-summary?username=${encodeURIComponent(username)}`)
      .then(r => r.json())
      .then(d => setSummary(d))
      .catch(() => {})
      .finally(() => setSummaryLoading(false));
  }, [username]);

  // 持久化 key
  const storageKey = type === 'diary'
    ? `insight:${type}:${username}:${diaryDate}`
    : `insight:${type}:${username}`;

  // 加载已保存的结果
  useEffect(() => {
    setResult('');
    setError('');
    fetch(`/api/ai/conversations?key=${encodeURIComponent(storageKey)}`)
      .then(r => r.json())
      .then(d => {
        if (d?.messages?.length) {
          // 取最后一条 assistant 消息作为保存的结果
          const last = [...d.messages].reverse().find((m: { role: string; content: string }) => m.role === 'assistant');
          if (last) setResult(last.content);
        }
      })
      .catch(() => {});
  }, [storageKey]);

  const generate = useCallback(async () => {
    if (!summary || loading) return;
    setLoading(true);
    setResult('');
    setError('');

    // 构造 prompt
    const name = privacyMode ? '联系人' : displayName;
    const systemPrompt = getPrompt(INSIGHT_PROMPT_IDS[type], customPrompts, { name });

    // 统计数据摘要
    let dataContext = `【统计数据】\n`;
    dataContext += `认识天数：${summary.days_known}天\n`;
    dataContext += `消息总数：${summary.total_messages}条（对方${summary.their_messages}条，我${summary.my_messages}条）\n`;
    dataContext += `对方字数：${summary.their_chars}字，我的字数：${summary.my_chars}字\n`;
    dataContext += `均消息长度：${(summary.avg_msg_len as number)?.toFixed(1) ?? '?'}字\n`;
    dataContext += `峰值月：${summary.peak_period}（${summary.peak_monthly}条/月）\n`;
    dataContext += `近一月：${summary.recent_monthly}条\n`;
    dataContext += `主动发起对话：${summary.initiation_pct}%\n`;
    dataContext += `深夜消息占比：${summary.late_night_pct}%\n`;
    dataContext += `红包/转账：${summary.money_count}次\n`;
    dataContext += `撤回：${summary.recall_count}次\n`;
    dataContext += `表情消息：${summary.emoji_count}次\n`;
    dataContext += `第一条消息日期：${summary.first_message}\n`;
    dataContext += `第一条消息内容：${summary.first_msg ?? '(无)'}\n`;

    // 月度趋势
    const monthly = summary.monthly as { month: string; their: number; mine: number; total: number; samples: { date: string; content: string; is_mine: boolean }[] }[];
    if (monthly?.length) {
      dataContext += `\n【月度消息趋势】\n`;
      for (const m of monthly) {
        dataContext += `${m.month}: 总${m.total}条（对方${m.their} / 我${m.mine}）\n`;
      }

      // 采样消息
      dataContext += `\n【聊天采样（每月代表性消息）】\n`;
      for (const m of monthly) {
        if (m.samples?.length) {
          for (const s of m.samples) {
            const who = s.is_mine ? '我' : name;
            dataContext += `[${s.date}] ${who}：${s.content}\n`;
          }
        }
      }
    }

    // 日记模式：如果选了特定日期，加载那天的消息
    if (type === 'diary') {
      try {
        const resp = await fetch(`/api/contacts/messages?username=${encodeURIComponent(username)}&date=${diaryDate}`);
        const dayMsgs = await resp.json() as { time: string; content: string; is_mine: boolean; type: number }[];
        if (dayMsgs?.length) {
          dataContext += `\n【${diaryDate} 当天完整聊天记录】\n`;
          for (const m of dayMsgs.slice(0, 50)) { // 限制 50 条
            if (m.type !== 1 || !m.content) continue;
            const who = m.is_mine ? '我' : name;
            dataContext += `[${m.time}] ${who}：${m.content}\n`;
          }
        } else {
          dataContext += `\n（${diaryDate} 当天无聊天记录）\n`;
        }
      } catch {}
    }

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: dataContext },
    ];

    // 流式调用 LLM
    abortRef.current = new AbortController();
    try {
      const resp = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username, is_group: false, from: 0, to: 0,
          messages,
          profile_id: profileId,
        }),
        signal: abortRef.current.signal,
      });

      const reader = resp.body?.getReader();
      if (!reader) throw new Error('无法读取响应');
      const decoder = new TextDecoder();
      let buf = '';
      let full = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const chunk = JSON.parse(line.slice(6)) as { delta?: string; done?: boolean; error?: string };
            if (chunk.error) { setError(chunk.error); break; }
            if (chunk.delta) {
              full += chunk.delta;
              setResult(full);
              resultRef.current?.scrollTo({ top: resultRef.current.scrollHeight });
            }
          } catch {}
        }
      }
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') {
        setError((e as Error).message || '生成失败');
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [summary, loading, type, displayName, username, profileId, privacyMode, diaryDate, storageKey]);

  // 生成完成后自动保存
  useEffect(() => {
    if (!result || loading) return;
    fetch('/api/ai/conversations', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: storageKey,
        messages: [{ role: 'assistant', content: result }],
      }),
    }).catch(() => {});
  }, [result, loading, storageKey]);

  const handleShare = useCallback(async () => {
    if (!result || sharing) return;
    setSharing(true);
    try {
      const p = await generateShareImage({
        question: INSIGHT_TABS.find(t => t.key === type)?.label + ` — ${displayName}`,
        answer: result,
        contactName: displayName,
        avatarUrl,
      });
      setSavedPath(p);
      setShared(true);
      setTimeout(() => { setShared(false); setSavedPath(null); }, 6000);
    } catch (e) { console.error(e); }
    finally { setSharing(false); }
  }, [result, sharing, type, displayName, avatarUrl]);

  const tokenEst = summary ? (summary.token_estimate as number ?? 0) : 0;

  return (
    <div className="space-y-4">
      {/* 功能选择 */}
      <div className="flex gap-2">
        {INSIGHT_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => { setType(tab.key); setResult(''); setError(''); }}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
              type === tab.key
                ? 'bg-[#07c160] text-white shadow-sm'
                : 'bg-gray-100 dark:bg-white/5 text-gray-500 hover:bg-gray-200'
            }`}
          >
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      {/* 描述 + 配置 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-xs text-gray-400">{INSIGHT_TABS.find(t => t.key === type)?.desc}</p>
          <button
            onClick={() => setShowPrompt(v => !v)}
            className="text-[10px] text-gray-300 hover:text-[#07c160] transition-colors underline"
          >
            {showPrompt ? '隐藏 Prompt' : '查看 Prompt'}
          </button>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {type === 'diary' && (
            <input
              type="date"
              value={diaryDate}
              onChange={e => setDiaryDate(e.target.value)}
              className="text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 dk-input"
            />
          )}
          {profiles.length > 1 && (
            <select
              value={profileId}
              onChange={e => setProfileId(e.target.value)}
              className="text-[10px] text-[#576b95] bg-[#576b95]/10 px-2 py-1 rounded-full font-semibold border-0 outline-none cursor-pointer"
            >
              {profiles.map(p => (
                <option key={p.id} value={p.id}>{p.provider}{p.model ? ` · ${p.model}` : ''}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Prompt 查看 */}
      {showPrompt && (
        <div className="bg-gray-50 dark:bg-white/5 rounded-xl p-3 border border-gray-100 dark:border-gray-800">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold text-gray-400 uppercase">System Prompt</span>
            <span className="text-[10px] text-gray-300">可在设置 → Prompt 模板中自定义</span>
          </div>
          <pre className="text-[11px] text-gray-500 dark:text-gray-400 whitespace-pre-wrap max-h-40 overflow-y-auto font-mono leading-relaxed">
            {getPrompt(INSIGHT_PROMPT_IDS[type], customPrompts, { name: privacyMode ? '联系人' : displayName })}
          </pre>
        </div>
      )}

      {/* Token 预估 */}
      {summaryLoading ? (
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Loader2 size={12} className="animate-spin" /> 加载数据摘要...
        </div>
      ) : summary && tokenEst > 0 && (
        <p className="text-[10px] text-gray-400">
          预估消耗 ~{(tokenEst / 1000).toFixed(1)}k token（已优化：使用统计摘要 + 采样，非全量消息）
        </p>
      )}

      {/* 生成 / 重新生成按钮 */}
      {!loading && (
        <button
          onClick={() => { setResult(''); setTimeout(generate, 50); }}
          disabled={!summary || summaryLoading || !profileId}
          className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-[#07c160] to-[#10aeff] text-white rounded-xl font-bold text-sm shadow-lg hover:shadow-xl transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40 disabled:hover:scale-100"
        >
          <Sparkles size={16} />
          {result ? '重新生成' : '生成'}{INSIGHT_TABS.find(t => t.key === type)?.label}
        </button>
      )}

      {/* 结果区域 */}
      {(result || loading) && (
        <div className="relative">
          {result && !loading && (
            <div className="absolute top-2 right-2 flex gap-1 items-center">
              {shared && savedPath && <RevealLink path={savedPath} className="text-[10px] text-[#07c160]" />}
              <div className="p-1.5 rounded-lg bg-white/80 dark:bg-black/30">
                <TTSButton text={result} title="朗读整段" />
              </div>
              <button
                onClick={handleShare}
                disabled={sharing}
                className="p-1.5 rounded-lg bg-white/80 dark:bg-black/30 text-gray-400 hover:text-[#07c160] transition-colors"
                title="保存为图片"
              >
                {sharing ? <Loader2 size={14} className="animate-spin" /> : shared ? <Check size={14} className="text-[#07c160]" /> : <Share2 size={14} />}
              </button>
            </div>
          )}
          <div
            ref={resultRef}
            className="bg-[#f8f9fb] dark:bg-white/5 rounded-2xl p-5 max-h-[50vh] overflow-y-auto prose prose-sm dark:prose-invert max-w-none
              prose-headings:text-[#1d1d1f] prose-headings:dark:text-white prose-strong:text-[#07c160]"
          >
            {result ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{result}</ReactMarkdown>
            ) : (
              <div className="flex items-center gap-2 text-gray-400 text-sm">
                <Loader2 size={16} className="animate-spin text-[#07c160]" />
                正在生成{INSIGHT_TABS.find(t => t.key === type)?.label}...
              </div>
            )}
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}

      {onOpenSettings && !profileId && (
        <p className="text-[10px] text-gray-400">
          需要先在 <button onClick={onOpenSettings} className="text-[#07c160] underline">设置</button> 中配置 AI 接口
        </p>
      )}
    </div>
  );
};
