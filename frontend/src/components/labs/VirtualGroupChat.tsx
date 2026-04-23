/**
 * AI 虚拟群聊 —— 把现实里没在同一个群的联系人拉到一个虚拟群让 AI 扮演他们聊天
 *
 * 步骤：挑 2-8 个联系人 → 可选写一句场景/话题 → 点"开始 / 下一轮"
 * 每次调 /api/ai/virtual-group/chat 生成一位参与者的一句话并流式追加。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Users, MessageSquarePlus, Loader2, Send, Trash2, X, Search, Sparkles, Shuffle,
} from 'lucide-react';
import type { ContactStats } from '../../types';
import { avatarSrc } from '../../utils/avatar';
import { getServerURL, getToken } from '../../runtimeConfig';

interface Props {
  contacts: ContactStats[];
}

interface TurnMsg {
  speaker: string;        // username（非群员时 = "我"）
  displayName: string;
  content: string;
  avatar?: string;
  streaming?: boolean;
}

const displayOf = (c: ContactStats) => c.remark || c.nickname || c.username;

export const VirtualGroupChat: React.FC<Props> = ({ contacts }) => {
  const [members, setMembers] = useState<ContactStats[]>([]);
  const [topic, setTopic] = useState('');
  const [history, setHistory] = useState<TurnMsg[]>([]);
  const [loading, setLoading] = useState(false);
  const [picker, setPicker] = useState(false);
  const [search, setSearch] = useState('');
  const [userInput, setUserInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history]);

  const filteredContacts = useMemo(() => {
    // 只展示有消息的私聊（过滤群聊 + 消息量为 0 的人）
    const base = contacts.filter(c => !c.username.endsWith('@chatroom') && (c.total_messages || 0) > 0);
    const q = search.trim().toLowerCase();
    if (!q) return base.slice(0, 200);
    return base.filter(c =>
      (c.remark || '').toLowerCase().includes(q) ||
      (c.nickname || '').toLowerCase().includes(q) ||
      c.username.toLowerCase().includes(q),
    ).slice(0, 200);
  }, [contacts, search]);

  const addMember = (c: ContactStats) => {
    if (members.find(m => m.username === c.username)) return;
    if (members.length >= 8) return;
    setMembers(m => [...m, c]);
  };
  const removeMember = (u: string) => {
    setMembers(m => m.filter(x => x.username !== u));
  };

  const canStart = members.length >= 2 && !loading;

  const requestTurn = async (nextSpeaker = 'auto') => {
    if (loading) return;
    setLoading(true);
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const server = getServerURL().replace(/\/+$/, '');
      const token = getToken();
      const resp = await fetch((server || '') + '/api/ai/virtual-group/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          members: members.map(m => m.username),
          history: history.map(h => ({ speaker: h.speaker, content: h.content })),
          topic,
          next_speaker: nextSpeaker,
        }),
        signal: abort.signal,
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? resp.statusText);
      }
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let cur: TurnMsg | null = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const chunk = JSON.parse(line.slice(6)) as {
              meta?: boolean; speaker?: string; display_name?: string;
              delta?: string; done?: boolean; error?: string;
            };
            if (chunk.error) throw new Error(chunk.error);
            if (chunk.meta && chunk.speaker) {
              const m = members.find(x => x.username === chunk.speaker);
              cur = {
                speaker: chunk.speaker,
                displayName: chunk.display_name || (m ? displayOf(m) : chunk.speaker),
                content: '',
                avatar: m?.big_head_url || m?.small_head_url,
                streaming: true,
              };
              setHistory(h => [...h, cur!]);
              continue;
            }
            if (chunk.delta && cur) {
              cur.content += chunk.delta;
              setHistory(h => h.map(x => (x === cur ? { ...x, content: cur!.content } : x)));
            }
            if (chunk.done && cur) {
              cur.streaming = false;
              setHistory(h => h.map(x => (x === cur ? { ...x, streaming: false } : x)));
            }
          } catch (e) {
            if (!(e instanceof SyntaxError)) throw e;
          }
        }
      }
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') {
        alert('生成失败：' + ((e as Error).message || '未知错误'));
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const sendUserTurn = () => {
    const t = userInput.trim();
    if (!t || members.length < 2) return;
    setHistory(h => [...h, { speaker: '我', displayName: '我', content: t }]);
    setUserInput('');
    // 用户发完，自动让 AI 回一轮
    setTimeout(() => requestTurn('auto'), 50);
  };

  const reset = () => {
    if (loading && abortRef.current) abortRef.current.abort();
    setHistory([]);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-10rem)] max-w-4xl mx-auto">
      {/* Header */}
      <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-fuchsia-500 to-purple-500 flex items-center justify-center">
            <Sparkles size={18} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-black dk-text">AI 虚拟群聊</h2>
            <p className="text-[11px] text-gray-400">
              把现实里不认识的几个人拉进同一个群聊，AI 用各自的说话风格让他们"聊起来"。
              风格来源：已训练分身 优先 · 私聊样例兜底。
            </p>
          </div>
        </div>

        {/* 成员 bar */}
        <div className="flex flex-wrap items-center gap-1.5">
          {members.map(m => (
            <div
              key={m.username}
              className="inline-flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-full bg-gray-100 dark:bg-white/5 text-xs dk-text"
            >
              <img
                loading="lazy"
                src={avatarSrc(m.big_head_url || m.small_head_url || '')}
                alt=""
                className="w-5 h-5 rounded-full object-cover bg-gray-200"
              />
              <span className="max-w-[8rem] truncate">{displayOf(m)}</span>
              <button
                onClick={() => removeMember(m.username)}
                className="text-gray-400 hover:text-red-500"
                title="移除"
              >
                <X size={12} />
              </button>
            </div>
          ))}
          {members.length < 8 && (
            <button
              onClick={() => setPicker(v => !v)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-dashed border-gray-300 dark:border-white/20 text-xs text-gray-500 hover:text-[#07c160] hover:border-[#07c160]"
            >
              <MessageSquarePlus size={12} />
              {members.length === 0 ? '添加成员（至少 2 位）' : '加人'}
            </button>
          )}
          {members.length > 0 && (
            <button
              onClick={reset}
              className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-gray-400 hover:text-red-500"
              title="清空对话"
            >
              <Trash2 size={12} /> 清空
            </button>
          )}
        </div>

        {/* 联系人选择器 */}
        {picker && (
          <div className="mt-3 border-t border-gray-100 dark:border-white/10 pt-3">
            <div className="relative mb-2">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="搜备注 / 昵称"
                className="w-full pl-9 pr-3 py-1.5 text-sm rounded-xl border border-gray-200 dark:border-white/10 bg-white dk-input"
              />
            </div>
            <div className="max-h-48 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-1">
              {filteredContacts.map(c => {
                const picked = !!members.find(m => m.username === c.username);
                return (
                  <button
                    key={c.username}
                    onClick={() => { if (!picked) addMember(c); }}
                    disabled={picked}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-xs ${
                      picked
                        ? 'opacity-40 cursor-not-allowed'
                        : 'hover:bg-gray-100 dark:hover:bg-white/5'
                    }`}
                  >
                    <img
                      loading="lazy"
                      src={avatarSrc(c.big_head_url || c.small_head_url || '')}
                      alt=""
                      className="w-7 h-7 rounded-full object-cover bg-gray-200"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="dk-text truncate">{displayOf(c)}</div>
                      <div className="text-[10px] text-gray-400">{(c.total_messages || 0).toLocaleString()} 条</div>
                    </div>
                  </button>
                );
              })}
              {filteredContacts.length === 0 && (
                <div className="col-span-full py-8 text-center text-xs text-gray-400">没有匹配</div>
              )}
            </div>
          </div>
        )}

        {/* 话题输入 */}
        <div className="mt-3">
          <input
            value={topic}
            onChange={e => setTopic(e.target.value)}
            placeholder="可选：给他们一个场景或话题（例如：周末一起吃饭时聊什么）"
            className="w-full px-3 py-1.5 text-sm rounded-xl border border-gray-200 dark:border-white/10 dk-input"
          />
        </div>
      </div>

      {/* 聊天区 */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto rounded-2xl border border-gray-100 dark:border-white/10 bg-[#f8faf8] dark:bg-white/2 p-4 space-y-3"
      >
        {history.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center text-gray-400 text-sm gap-2">
            <Users size={36} className="text-gray-300" />
            <p>选好成员（建议 ≥ 3 位）后点下面按钮开聊</p>
            <p className="text-[11px]">训练过分身的人风格最像；没训练的会从私聊最近 30 条里临时学</p>
          </div>
        )}
        {history.map((m, i) => {
          const isMe = m.speaker === '我';
          return (
            <div key={i} className={`flex gap-2 ${isMe ? 'flex-row-reverse' : ''}`}>
              {isMe ? (
                <div className="w-8 h-8 rounded-full bg-[#07c160] flex items-center justify-center text-white text-[10px] font-black shrink-0">
                  我
                </div>
              ) : (
                <img
                  loading="lazy"
                  src={avatarSrc(m.avatar || '')}
                  alt=""
                  className="w-8 h-8 rounded-full object-cover bg-gray-200 shrink-0"
                />
              )}
              <div className={`max-w-[75%] ${isMe ? 'items-end' : 'items-start'} flex flex-col gap-0.5`}>
                <span className="text-[10px] text-gray-400 px-1">{m.displayName}</span>
                <div
                  className={`px-3 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
                    isMe
                      ? 'bg-[#07c160] text-white rounded-br-md'
                      : 'bg-white dark:bg-white/10 dk-text rounded-bl-md border border-gray-100 dark:border-white/5'
                  }`}
                >
                  {m.content || (m.streaming ? <span className="text-gray-400"><Loader2 size={12} className="inline animate-spin" /> 在输入…</span> : '')}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 底部：控制条 + 用户输入 */}
      <div className="mt-3 rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-3">
        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={() => requestTurn('auto')}
            disabled={!canStart}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-fuchsia-500 to-purple-500 text-white text-sm font-bold disabled:opacity-40 hover:opacity-90"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {history.length === 0 ? '开启群聊' : '下一轮 AI'}
          </button>
          <button
            onClick={() => requestTurn('random')}
            disabled={!canStart}
            className="flex items-center gap-1 px-3 py-2 rounded-xl border border-gray-200 dark:border-white/10 text-xs text-gray-500 hover:text-[#07c160] disabled:opacity-40"
            title="随便选一个人发言（而不是轮转）"
          >
            <Shuffle size={12} /> 随机
          </button>
          <span className="text-[11px] text-gray-400 ml-auto">成员 {members.length} / 8 · 历史 {history.length} 条</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={userInput}
            onChange={e => setUserInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendUserTurn(); } }}
            disabled={members.length < 2}
            placeholder={members.length < 2 ? '先加够 2 位成员' : '以"我"的身份插一句（Enter 发送，会自动触发下一轮 AI）'}
            className="flex-1 px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-white/10 dk-input disabled:opacity-50"
          />
          <button
            onClick={sendUserTurn}
            disabled={!userInput.trim() || members.length < 2 || loading}
            className="p-2 rounded-xl bg-[#07c160] text-white disabled:opacity-40 hover:bg-[#06ad56]"
            title="发送"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default VirtualGroupChat;
