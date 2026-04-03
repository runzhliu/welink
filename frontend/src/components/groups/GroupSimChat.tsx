/**
 * AI 群聊模拟 — 配置面板 + 按成员发言比例和风格模拟群聊对话
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Play, Send, Loader2, Square, Users, Trash2, Sparkles, MessageSquare, Settings2, RotateCcw } from 'lucide-react';
import type { GroupInfo } from '../../types';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';
import { groupsApi } from '../../services/api';
import { avatarSrc } from '../../utils/avatar';

interface Props {
  group: GroupInfo;
  onOpenSettings?: () => void;
}

interface SimMessage {
  speaker: string;
  content: string;
  isUser?: boolean;
}

interface MemberOption {
  name: string;
  count: number;
  avatarUrl?: string;
}

const MSG_COUNT_OPTIONS = [
  { value: 500, label: '500 条' },
  { value: 1000, label: '1000 条' },
  { value: 2000, label: '2000 条' },
  { value: 3000, label: '3000 条' },
];

const ROUND_OPTIONS = [5, 10, 15, 20];

const MOOD_OPTIONS = [
  { value: '', label: '自然（跟随历史风格）' },
  { value: 'casual', label: '日常闲聊' },
  { value: 'heated', label: '激烈讨论' },
  { value: 'latenight', label: '深夜吐槽' },
  { value: 'funny', label: '搞笑段子' },
  { value: 'serious', label: '正经严肃' },
];

const SPEAKER_COLORS = [
  '#07c160', '#10aeff', '#ff9500', '#fa5151', '#576b95',
  '#8b5cf6', '#06b6d4', '#ec4899', '#f59e0b', '#14b8a6',
];

function speakerColor(name: string, colorMap: Map<string, string>): string {
  if (!colorMap.has(name)) {
    colorMap.set(name, SPEAKER_COLORS[colorMap.size % SPEAKER_COLORS.length]);
  }
  return colorMap.get(name)!;
}

export const GroupSimChat: React.FC<Props> = ({ group, onOpenSettings }) => {
  const { privacyMode } = usePrivacyMode();

  // ─── 配置状态 ─────────────────────────────────────────────────
  const [started, setStarted] = useState(false);
  const [msgCount, setMsgCount] = useState(1000);
  const [rounds, setRounds] = useState(10);
  const [topic, setTopic] = useState('');
  const [mood, setMood] = useState('');
  const [profileId, setProfileId] = useState('');
  const [profiles, setProfiles] = useState<{ id: string; provider: string; model?: string }[]>([]);
  const [memberOptions, setMemberOptions] = useState<MemberOption[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [membersLoading, setMembersLoading] = useState(false);

  // ─── 聊天状态 ─────────────────────────────────────────────────
  const [messages, setMessages] = useState<SimMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const colorMapRef = useRef(new Map<string, string>());

  // 加载 LLM profiles
  useEffect(() => {
    fetch('/api/preferences')
      .then(r => r.json())
      .then(data => {
        const ps = data?.llm_profiles ?? [];
        setProfiles(ps);
        if (ps.length > 0 && !profileId) setProfileId(ps[0].id);
      })
      .catch(() => {});
  }, []);

  // 加载群成员排行
  useEffect(() => {
    setMembersLoading(true);
    groupsApi.getDetail(group.username).then(detail => {
      if (detail?.member_rank) {
        const members = detail.member_rank.slice(0, 20).map(m => ({
          name: m.speaker,
          count: m.count,
        }));
        setMemberOptions(members);
        setSelectedMembers(new Set(members.slice(0, 10).map(m => m.name)));
      }
    }).catch(() => {}).finally(() => setMembersLoading(false));
  }, [group.username]);

  const toggleMember = useCallback((name: string) => {
    setSelectedMembers(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, 50);
  }, []);

  const runSimulation = useCallback(async (userMessage?: string) => {
    if (loading) return;
    setLoading(true);

    const history = messages.map(m => ({ speaker: m.speaker, content: m.content }));
    const body = {
      group_username: group.username,
      message_count: msgCount,
      profile_id: profileId,
      user_message: userMessage ?? '',
      history,
      rounds,
      topic: topic.trim(),
      mood,
      members: Array.from(selectedMembers),
    };

    abortRef.current = new AbortController();

    try {
      const resp = await fetch('/api/ai/group-sim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortRef.current.signal,
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        setMessages(prev => [...prev, { speaker: '系统', content: (err as { error?: string }).error || '请求失败' }]);
        setLoading(false);
        return;
      }

      const reader = resp.body?.getReader();
      if (!reader) { setLoading(false); return; }
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(trimmed.slice(6)) as { speaker?: string; content?: string; done?: boolean; error?: string };
            if (data.done) break;
            if (data.error) {
              setMessages(prev => [...prev, { speaker: '系统', content: data.error! }]);
              break;
            }
            if (data.speaker && data.content) {
              setMessages(prev => [...prev, { speaker: data.speaker!, content: data.content!, isUser: data.speaker === '我' }]);
              scrollToBottom();
            }
          } catch {}
        }
      }
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') {
        setMessages(prev => [...prev, { speaker: '系统', content: '连接中断' }]);
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [loading, messages, group.username, msgCount, profileId, rounds, topic, mood, selectedMembers, scrollToBottom]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    setMessages(prev => [...prev, { speaker: '我', content: text, isUser: true }]);
    scrollToBottom();
    runSimulation(text);
  }, [input, runSimulation, scrollToBottom]);

  const handleStop = useCallback(() => { abortRef.current?.abort(); }, []);

  const handleReset = useCallback(() => {
    setStarted(false);
    setMessages([]);
    colorMapRef.current.clear();
  }, []);

  // ─── 配置面板（未开始时） ───────────────────────────────────────
  if (!started) {
    return (
      <div className="flex flex-col items-center gap-6 py-6">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-gradient-to-br from-[#07c160] to-[#10aeff] flex items-center justify-center">
            <Users size={28} className="text-white" />
          </div>
          <h3 className="text-lg font-black dk-text">AI 群聊模拟</h3>
          <p className="text-xs text-gray-400 mt-1">让 AI 模拟群友继续聊天，你也可以加入</p>
        </div>

        {/* 参考消息数 */}
        <div className="w-full max-w-md">
          <label className="text-xs font-bold text-gray-500 mb-2 block">参考消息数</label>
          <div className="flex gap-2">
            {MSG_COUNT_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setMsgCount(opt.value)}
                className={`flex-1 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                  msgCount === opt.value
                    ? 'bg-[#07c160] text-white shadow-sm'
                    : 'bg-gray-50 dark:bg-white/5 text-gray-500 hover:bg-gray-100'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-1">越多则风格越准确，但 token 消耗更大</p>
        </div>

        {/* 每次轮数 */}
        <div className="w-full max-w-md">
          <label className="text-xs font-bold text-gray-500 mb-2 block">每次生成轮数</label>
          <div className="flex gap-2">
            {ROUND_OPTIONS.map(n => (
              <button
                key={n}
                onClick={() => setRounds(n)}
                className={`flex-1 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                  rounds === n
                    ? 'bg-[#07c160] text-white shadow-sm'
                    : 'bg-gray-50 dark:bg-white/5 text-gray-500 hover:bg-gray-100'
                }`}
              >
                {n} 轮
              </button>
            ))}
          </div>
        </div>

        {/* 参与成员 */}
        <div className="w-full max-w-md">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-bold text-gray-500">参与成员</label>
            {memberOptions.length > 0 && (
              <button
                onClick={() => {
                  if (selectedMembers.size === memberOptions.length)
                    setSelectedMembers(new Set());
                  else
                    setSelectedMembers(new Set(memberOptions.map(m => m.name)));
                }}
                className="text-[10px] text-[#07c160] font-bold"
              >
                {selectedMembers.size === memberOptions.length ? '取消全选' : '全选'}
              </button>
            )}
          </div>
          {membersLoading ? (
            <div className="flex items-center gap-2 text-xs text-gray-400 py-3">
              <Loader2 size={12} className="animate-spin" /> 加载成员列表...
            </div>
          ) : memberOptions.length === 0 ? (
            <div className="text-xs text-gray-300 py-2">暂无成员数据</div>
          ) : (
            <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
              {memberOptions.map(m => (
                <button
                  key={m.name}
                  onClick={() => toggleMember(m.name)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-all ${
                    selectedMembers.has(m.name)
                      ? 'bg-[#e7f8f0] dark:bg-[#07c160]/10 text-[#07c160] ring-1 ring-[#07c160]/30'
                      : 'bg-gray-50 dark:bg-white/5 text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10'
                  }`}
                >
                  <span className={privacyMode ? 'privacy-blur' : ''}>{m.name}</span>
                  <span className="text-gray-300 text-[10px]">{m.count.toLocaleString()}</span>
                </button>
              ))}
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-1">取消勾选的成员不会参与模拟对话</p>
        </div>

        {/* 话题/场景 */}
        <div className="w-full max-w-md">
          <label className="text-xs font-bold text-gray-500 mb-2 block">话题/场景设定（选填）</label>
          <textarea
            value={topic}
            onChange={e => setTopic(e.target.value)}
            placeholder="例如：讨论周末去哪吃饭、聊最近的电影、吐槽工作..."
            rows={2}
            className="w-full px-3 py-2 bg-gray-50 dark:bg-white/5 rounded-xl text-xs outline-none focus:ring-2 focus:ring-[#07c160]/30 dk-text placeholder:text-gray-300 resize-none"
          />
          <p className="text-[10px] text-gray-400 mt-1">不填则让群友自由发挥，跟随历史聊天风格</p>
        </div>

        {/* 氛围 */}
        <div className="w-full max-w-md">
          <label className="text-xs font-bold text-gray-500 mb-2 block">聊天氛围</label>
          <div className="flex flex-wrap gap-1.5">
            {MOOD_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setMood(opt.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  mood === opt.value
                    ? 'bg-[#07c160] text-white'
                    : 'bg-gray-50 dark:bg-white/5 text-gray-500 hover:bg-gray-100'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* LLM Profile */}
        {profiles.length > 0 && (
          <div className="w-full max-w-md">
            <label className="text-xs font-bold text-gray-500 mb-2 block">AI 模型</label>
            <select
              value={profileId}
              onChange={e => setProfileId(e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-white/5 rounded-xl text-xs outline-none focus:ring-2 focus:ring-[#07c160]/30 dk-text dk-input"
            >
              {profiles.map(p => (
                <option key={p.id} value={p.id}>{p.provider}{p.model ? ` · ${p.model}` : ''}</option>
              ))}
            </select>
          </div>
        )}

        {/* 开始按钮 */}
        <button
          onClick={() => { setStarted(true); setTimeout(() => runSimulation(), 50); }}
          disabled={selectedMembers.size < 2 || !profileId}
          className="px-8 py-3 bg-gradient-to-r from-[#07c160] to-[#10aeff] text-white rounded-2xl font-bold text-sm shadow-lg hover:shadow-xl transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40 disabled:hover:scale-100"
        >
          <span className="flex items-center gap-2">
            <Sparkles size={16} />
            开始模拟
          </span>
        </button>

        {onOpenSettings && (
          <p className="text-[10px] text-gray-400">
            需要先在 <button onClick={onOpenSettings} className="text-[#07c160] underline">设置</button> 中配置 AI 接口
          </p>
        )}
      </div>
    );
  }

  // ─── 聊天面板（已开始后） ───────────────────────────────────────
  return (
    <div className="flex flex-col" style={{ height: 'calc(70vh - 100px)', minHeight: 400 }}>
      {/* 顶部控制栏 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-xs text-gray-400 flex-wrap">
          <Users size={12} />
          <span>{selectedMembers.size} 人参与</span>
          {topic && <><span className="text-gray-200">·</span><span>话题: {topic.length > 15 ? topic.slice(0, 15) + '…' : topic}</span></>}
          {mood && <><span className="text-gray-200">·</span><span>{MOOD_OPTIONS.find(m => m.value === mood)?.label}</span></>}
          {profileId && profiles.length > 0 && (() => {
            const defaultModels: Record<string, string> = {
              deepseek: 'deepseek-chat', kimi: 'moonshot-v1-8k', gemini: 'gemini-2.0-flash',
              glm: 'glm-4-flash', grok: 'grok-3-mini', minimax: 'MiniMax-Text-01',
              'minimax-cn': 'MiniMax-Text-01', openai: 'gpt-4o-mini', claude: 'claude-haiku-4-5-20251001',
              ollama: 'llama3',
            };
            const p = profiles.find(pp => pp.id === profileId);
            const modelName = p?.model || (p ? defaultModels[p.provider] : '') || '';
            return p ? (
              <span className="text-[10px] text-[#07c160] bg-[#e7f8f0] dark:bg-[#07c160]/10 px-2 py-0.5 rounded-full font-medium">
                {p.provider}{modelName ? ` · ${modelName}` : ''}
              </span>
            ) : null;
          })()}
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={handleReset}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold
              text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
            title="重新配置"
          >
            <RotateCcw size={12} />重新配置
          </button>
          {messages.length > 0 && (
            <button
              onClick={() => { setMessages([]); colorMapRef.current.clear(); }}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold
                text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
            >
              <Trash2 size={12} />清空
            </button>
          )}
          {loading ? (
            <button
              onClick={handleStop}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold
                bg-red-500 text-white hover:bg-red-600 transition-colors"
            >
              <Square size={12} />停止
            </button>
          ) : (
            <button
              onClick={() => runSimulation()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold
                bg-[#07c160] text-white hover:bg-[#06ad56] transition-colors"
            >
              <Play size={12} />继续聊
            </button>
          )}
        </div>
      </div>

      {/* 消息区 */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto rounded-2xl bg-[#f0f0f0] dark:bg-gray-900/50 p-4 space-y-3"
      >
        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-gray-300 dark:text-gray-600 gap-3">
            <Loader2 size={32} className="animate-spin text-[#07c160]" />
            <p className="text-sm font-semibold">正在准备群聊模拟...</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2.5 ${msg.isUser ? 'flex-row-reverse' : 'flex-row'}`}>
            <div
              className="w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center text-white text-xs font-bold"
              style={{ backgroundColor: msg.isUser ? '#07c160' : msg.speaker === '系统' ? '#999' : speakerColor(msg.speaker, colorMapRef.current) }}
            >
              {msg.speaker === '系统' ? '!' : msg.speaker.charAt(0)}
            </div>
            <div className={`max-w-[75%] ${msg.isUser ? 'items-end' : 'items-start'} flex flex-col gap-0.5`}>
              {!msg.isUser && (
                <span className={`text-[10px] font-bold px-1 ${privacyMode ? 'privacy-blur' : ''}`}
                  style={{ color: msg.speaker === '系统' ? '#999' : speakerColor(msg.speaker, colorMapRef.current) }}>
                  {msg.speaker}
                </span>
              )}
              <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed break-words whitespace-pre-wrap ${
                msg.isUser
                  ? 'bg-[#07c160] text-white rounded-br-sm'
                  : msg.speaker === '系统'
                    ? 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300 text-xs rounded-bl-sm'
                    : 'bg-white dark:bg-gray-800 text-[#1d1d1f] dark:text-gray-100 rounded-bl-sm shadow-sm'
              }`}>
                {msg.content}
              </div>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2 text-gray-400 text-xs py-2">
            <Loader2 size={14} className="animate-spin" />
            群友正在打字...
          </div>
        )}
      </div>

      {/* 输入框 */}
      <form
        onSubmit={e => { e.preventDefault(); handleSend(); }}
        className="flex gap-2 mt-3"
      >
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="发消息加入群聊..."
          className="flex-1 px-4 py-2.5 rounded-2xl border border-gray-200 dark:border-gray-700 text-sm
            bg-white dark:bg-gray-800 dk-input focus:outline-none focus:border-[#07c160] transition-colors"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={!input.trim() || loading}
          className="px-4 py-2.5 bg-[#07c160] text-white rounded-2xl text-sm font-bold
            disabled:opacity-40 hover:bg-[#06ad56] transition-colors flex-shrink-0"
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );
};
