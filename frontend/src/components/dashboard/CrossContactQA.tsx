/**
 * 跨联系人 AI 问答 — Agent 模式：LLM 解析意图 → 自动搜索/查询 → LLM 汇总回答
 * 支持问题如："谁跟我聊过旅行""去年国庆和谁聊天了""哪些朋友经常提到加班"
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Globe, Send, Loader2, Trash2, Bot, Search, Calendar, RotateCcw, Share2, Check, Copy } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { searchApi, calendarApi } from '../../services/api';
import { generateShareImage } from '../../utils/shareImage';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';

interface Props {
  onOpenSettings?: () => void;
  onContactClick?: (username: string) => void;
  onGroupClick?: (username: string) => void;
}

interface SearchHit {
  display_name: string;
  username: string;
  is_group: boolean;
  count: number;
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  tool?: string;
  searching?: boolean;
  searchHits?: SearchHit[]; // 完整搜索结果（用于展示在 AI 回答下方）
}

const EXAMPLE_QUESTIONS = [
  '谁跟我聊过旅行？',
  '去年国庆我都跟谁聊天了？',
  '哪些朋友经常提到加班？',
  '最近一个月谁给我发了红包？',
  '有没有人跟我聊过买房？',
  '谁经常在深夜找我聊天？',
];

export const CrossContactQA: React.FC<Props> = ({ onOpenSettings, onContactClick, onGroupClick }) => {
  const { privacyMode } = usePrivacyMode();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [profileId, setProfileId] = useState('');
  const [profiles, setProfiles] = useState<{ id: string; provider: string; model?: string }[]>([]);
  const [sharingIdx, setSharingIdx] = useState(-1);
  const [sharedIdx, setSharedIdx] = useState(-1);
  const [copiedIdx, setCopiedIdx] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch('/api/preferences').then(r => r.json()).then(d => {
      const ps = d?.llm_profiles ?? [];
      setProfiles(ps);
      if (ps.length > 0 && !profileId) setProfileId(ps[0].id);
    }).catch(() => {});
  }, []);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }), 50);
  }, []);

  const askQuestion = useCallback(async (question: string) => {
    if (!question.trim() || loading) return;
    const q = question.trim();
    setMessages(prev => [...prev, { role: 'user', content: q }]);
    setLoading(true);
    scrollToBottom();

    try {
      // ── Step 1: LLM 解析意图 ──
      setMessages(prev => [...prev, { role: 'system', content: '正在理解你的问题...', searching: true }]);
      scrollToBottom();

      const intentResp = await fetch('/api/ai/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{
            role: 'system',
            content: `你是一个问题解析助手。用户会问关于微信聊天记录的跨联系人问题。
请分析用户意图并返回一个 JSON 对象（不要其他内容），格式：
{
  "type": "search" 或 "calendar" 或 "both",
  "keywords": ["关键词1", "关键词2"],
  "date_from": "YYYY-MM-DD" 或 null,
  "date_to": "YYYY-MM-DD" 或 null,
  "search_type": "all" 或 "contact" 或 "group",
  "summary": "一句话描述你理解的意图"
}

规则：
- 如果问题包含具体关键词（如"旅行""加班""买房"），type 设为 "search"
- 如果问题包含时间范围（如"去年国庆""上个月"），type 设为 "calendar" 或 "both"
- "去年国庆" = 去年的 10-01 到 10-07
- "最近一个月" = 从今天往前推 30 天
- 今天是 ${new Date().toISOString().slice(0, 10)}
- keywords 提取核心搜索词，不要太泛
- 只返回 JSON，不要其他文字`
          }, {
            role: 'user',
            content: q,
          }],
        }),
      });
      const intentData = await intentResp.json() as { content?: string; error?: string };
      if (intentData.error) throw new Error(intentData.error);

      let intent: { type: string; keywords: string[]; date_from: string | null; date_to: string | null; search_type: string; summary: string };
      try {
        // 提取 JSON（LLM 可能包裹在 ```json ``` 里）
        const raw = intentData.content ?? '';
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        intent = JSON.parse(jsonMatch?.[0] ?? raw);
      } catch {
        // fallback：直接用关键词搜索
        intent = { type: 'search', keywords: [q], date_from: null, date_to: null, search_type: 'all', summary: q };
      }

      // ── Step 2: 执行搜索/查询 ──
      let dataContext = '';
      const allHits: SearchHit[] = [];

      if (intent.type === 'search' || intent.type === 'both') {
        for (const kw of intent.keywords.slice(0, 3)) {
          setMessages(prev => {
            const next = [...prev];
            next[next.length - 1] = { role: 'system', content: `正在搜索「${kw}」...`, searching: true, tool: 'search' };
            return next;
          });
          scrollToBottom();

          try {
            const results = await searchApi.global(kw, (intent.search_type as 'all' | 'contact' | 'group') || 'all');
            if (results?.length) {
              // 收集完整搜索结果用于前端展示
              for (const r of results) {
                if (!allHits.find(h => h.username === r.username)) {
                  allHits.push({ display_name: r.display_name, username: r.username, is_group: r.is_group, count: r.messages.length });
                }
              }
              dataContext += `\n【搜索「${kw}」结果：${results.length} 个联系人/群聊匹配】\n`;
              for (const group of results.slice(0, 10)) {
                dataContext += `\n${group.is_group ? '[群聊]' : '[联系人]'} ${privacyMode ? '***' : group.display_name}（${group.messages.length} 条匹配）：\n`;
                for (const msg of group.messages.slice(0, 3)) {
                  dataContext += `  [${msg.date} ${msg.time}] ${msg.is_mine ? '我' : (privacyMode ? '***' : group.display_name)}：${msg.content}\n`;
                }
              }
            } else {
              dataContext += `\n【搜索「${kw}」：无匹配结果】\n`;
            }
          } catch {
            dataContext += `\n【搜索「${kw}」失败】\n`;
          }
        }
      }

      if (intent.type === 'calendar' || intent.type === 'both') {
        if (intent.date_from) {
          setMessages(prev => {
            const next = [...prev];
            next[next.length - 1] = { role: 'system', content: `正在查询 ${intent.date_from} ~ ${intent.date_to || intent.date_from} 的聊天记录...`, searching: true, tool: 'calendar' };
            return next;
          });
          scrollToBottom();

          const from = new Date(intent.date_from);
          const to = intent.date_to ? new Date(intent.date_to) : from;
          const days: string[] = [];
          const cur = new Date(from);
          while (cur <= to && days.length < 14) { // 最多 14 天
            days.push(cur.toISOString().slice(0, 10));
            cur.setDate(cur.getDate() + 1);
          }

          dataContext += `\n【${intent.date_from} ~ ${intent.date_to || intent.date_from} 期间聊天活动】\n`;
          for (const day of days) {
            try {
              const dayData = await calendarApi.getDay(day);
              const allEntries = [...(dayData.contacts || []), ...(dayData.groups || [])];
              if (allEntries.length > 0) {
                const names = allEntries.slice(0, 10).map(e => `${privacyMode ? '***' : e.display_name}(${e.count}条)`).join('、');
                dataContext += `${day}：与 ${allEntries.length} 人/群聊天 — ${names}\n`;
              } else {
                dataContext += `${day}：无聊天记录\n`;
              }
            } catch {
              dataContext += `${day}：查询失败\n`;
            }
          }
        }
      }

      if (!dataContext.trim()) {
        dataContext = '【未找到相关数据】';
      }

      // ── Step 3: LLM 汇总回答 ──
      setMessages(prev => {
        const next = [...prev];
        next[next.length - 1] = { role: 'system', content: '正在生成回答...', searching: true };
        return next;
      });
      scrollToBottom();

      abortRef.current = new AbortController();
      const resp = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: '__cross_contact__',
          is_group: false,
          messages: [
            { role: 'system', content: `你是 WeLink 的 AI 助手，用户刚问了一个关于微信聊天记录的问题。
以下是从数据库中检索到的相关数据。请基于这些数据回答用户的问题。

要求：
1. 用中文回答，简洁清晰
2. 直接回答问题，不要废话
3. 如果数据不足以回答，诚实说明
4. 用 Markdown 格式排版（列表、粗体等）
5. 如果涉及多个联系人，用列表列出并简要说明` },
            { role: 'user', content: `问题：${q}\n\n${dataContext}` },
          ],
          profile_id: profileId,
        }),
        signal: abortRef.current.signal,
      });

      const reader = resp.body?.getReader();
      if (!reader) throw new Error('无法读取响应');
      const decoder = new TextDecoder();
      let buf = '';
      let full = '';

      // 替换 searching 消息为正式回答
      setMessages(prev => {
        const next = [...prev];
        next[next.length - 1] = { role: 'assistant', content: '', searchHits: allHits.length > 0 ? allHits : undefined };
        return next;
      });

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
            if (chunk.error) throw new Error(chunk.error);
            if (chunk.delta) {
              full += chunk.delta;
              setMessages(prev => {
                const next = [...prev];
                next[next.length - 1] = { ...next[next.length - 1], content: full };
                return next;
              });
              scrollToBottom();
            }
          } catch {}
        }
      }
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') {
        setMessages(prev => {
          const next = [...prev];
          if (next[next.length - 1]?.searching) {
            next[next.length - 1] = { role: 'assistant', content: `出错了：${(e as Error).message || '未知错误'}` };
          } else {
            next.push({ role: 'assistant', content: `出错了：${(e as Error).message || '未知错误'}` });
          }
          return next;
        });
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [loading, profileId, privacyMode, scrollToBottom]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#576b95] to-[#10aeff] flex items-center justify-center">
            <Globe size={16} className="text-white" />
          </div>
          <div>
            <h3 className="text-sm font-bold dk-text">跨联系人问答</h3>
            <p className="text-[10px] text-gray-400">AI 自动搜索所有聊天记录回答你的问题</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {profiles.length > 1 && (
            <select
              value={profileId}
              onChange={e => setProfileId(e.target.value)}
              className="text-[10px] text-[#576b95] bg-[#576b95]/10 px-2 py-0.5 rounded-full font-semibold border-0 outline-none cursor-pointer"
            >
              {profiles.map(p => (
                <option key={p.id} value={p.id}>{p.provider}{p.model ? ` · ${p.model}` : ''}</option>
              ))}
            </select>
          )}
          {messages.length > 0 && (
            <button onClick={() => setMessages([])} className="text-gray-400 hover:text-red-400 p-1 transition-colors" title="清空对话">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 min-h-0 mb-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <Globe size={40} className="text-gray-200" />
            <p className="text-sm text-gray-400">问我任何关于聊天记录的问题</p>
            <div className="flex flex-wrap justify-center gap-2 max-w-md">
              {EXAMPLE_QUESTIONS.map(q => (
                <button
                  key={q}
                  onClick={() => { setInput(''); askQuestion(q); }}
                  disabled={loading}
                  className="px-3 py-1.5 rounded-full text-xs bg-gray-100 dark:bg-white/5 text-gray-500 hover:bg-[#e7f8f0] hover:text-[#07c160] transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
            {msg.role !== 'user' && (
              <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs ${
                msg.searching ? 'bg-[#ff9500]' : 'bg-[#576b95]'
              }`}>
                {msg.searching ? (msg.tool === 'search' ? <Search size={12} /> : msg.tool === 'calendar' ? <Calendar size={12} /> : <Bot size={12} />) : <Bot size={12} />}
              </div>
            )}
            <div className={`max-w-[80%] ${msg.role === 'user' ? 'items-end' : 'items-start'} flex flex-col`}>
              <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-[#07c160] text-white rounded-br-sm'
                  : msg.searching
                    ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-300 text-xs italic'
                    : 'bg-[#f0f0f0] dark:bg-white/10 rounded-bl-sm'
              }`}>
                {msg.role === 'assistant' && !msg.searching ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none prose-strong:text-[#07c160]">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content || '...'}</ReactMarkdown>
                  </div>
                ) : msg.searching ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 size={12} className="animate-spin" />
                    {msg.content}
                  </span>
                ) : (
                  msg.content
                )}
              </div>
              {/* 复制 + 分享 */}
              {msg.role === 'assistant' && !msg.searching && msg.content && (
                <div className="flex items-center gap-3 mt-1.5 self-start">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(msg.content).then(() => {
                        setCopiedIdx(i);
                        setTimeout(() => setCopiedIdx(-1), 2000);
                      });
                    }}
                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-[#07c160] transition-colors"
                  >
                    {copiedIdx === i ? <Check size={12} className="text-[#07c160]" /> : <Copy size={12} />}
                    {copiedIdx === i ? '已复制' : '复制'}
                  </button>
                  <button
                    onClick={async () => {
                      if (sharingIdx >= 0) return;
                      setSharingIdx(i);
                      try {
                        const userMsg = messages.slice(0, i).reverse().find(m => m.role === 'user');
                        await generateShareImage({
                          question: userMsg?.content ?? '跨联系人问答',
                          answer: msg.content,
                          contactName: '跨联系人问答',
                        });
                        setSharedIdx(i);
                        setTimeout(() => setSharedIdx(-1), 2000);
                      } catch (e) { console.error(e); }
                      finally { setSharingIdx(-1); }
                    }}
                    disabled={sharingIdx >= 0}
                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-[#07c160] transition-colors"
                  >
                    {sharingIdx === i ? <Loader2 size={12} className="animate-spin" /> : sharedIdx === i ? <Check size={12} className="text-[#07c160]" /> : <Share2 size={12} />}
                    {sharedIdx === i ? '已保存' : '分享'}
                  </button>
                </div>
              )}
              {/* 搜索结果完整列表 */}
              {msg.searchHits && msg.searchHits.length > 0 && !msg.searching && msg.content && (
                <details className="mt-2 w-full">
                  <summary className="text-[10px] text-gray-400 cursor-pointer hover:text-[#07c160] transition-colors select-none">
                    查看全部 {msg.searchHits.length} 个匹配（点击展开）
                  </summary>
                  <div className="mt-1.5 max-h-48 overflow-y-auto space-y-1 bg-white dark:bg-gray-900 rounded-xl p-2 border border-gray-100 dark:border-gray-800">
                    {msg.searchHits
                      .sort((a, b) => b.count - a.count)
                      .map(hit => (
                        <button
                          key={hit.username}
                          onClick={() => hit.is_group ? onGroupClick?.(hit.username) : onContactClick?.(hit.username)}
                          className="flex items-center justify-between text-xs px-2 py-1.5 rounded-lg hover:bg-[#e7f8f0] dark:hover:bg-[#07c160]/10 w-full text-left transition-colors cursor-pointer"
                        >
                          <span className={`font-medium text-[#1d1d1f] dk-text hover:text-[#07c160] ${privacyMode ? 'privacy-blur' : ''}`}>
                            {hit.is_group ? '🏠 ' : ''}{hit.display_name}
                          </span>
                          <span className="text-gray-400 flex-shrink-0 ml-2">{hit.count} 条 →</span>
                        </button>
                      ))
                    }
                  </div>
                </details>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <form onSubmit={e => { e.preventDefault(); const q = input.trim(); if (q) { setInput(''); askQuestion(q); } }} className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="问我关于聊天记录的问题..."
          className="flex-1 px-4 py-2.5 rounded-2xl border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-800 dk-input focus:outline-none focus:border-[#07c160]"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={!input.trim() || loading || !profileId}
          className="px-4 py-2.5 bg-[#576b95] text-white rounded-2xl text-sm font-bold disabled:opacity-40 hover:bg-[#4a5d82] transition-colors flex-shrink-0"
        >
          <Send size={16} />
        </button>
      </form>

      {onOpenSettings && !profileId && (
        <p className="text-[10px] text-gray-400 mt-2">
          需要先在 <button onClick={onOpenSettings} className="text-[#07c160] underline">设置</button> 中配置 AI 接口
        </p>
      )}
    </div>
  );
};
