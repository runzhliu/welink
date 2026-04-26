/**
 * AI 虚拟群聊 —— 把现实里没在同一个群的联系人拉到一个虚拟群让 AI 扮演他们聊天
 *
 * 步骤：挑 2-8 个联系人 → 可选写一句场景/话题 → 点"开始 / 下一轮"
 * 每次调 /api/ai/virtual-group/chat 生成一位参与者的一句话并流式追加。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Users, MessageSquarePlus, Loader2, Send, Trash2, X, Search, Sparkles, Shuffle, Zap, Square, Share2, Check, Save, History, Plus,
} from 'lucide-react';
import { toPng } from 'html-to-image';
import axios from 'axios';
import type { ContactStats } from '../../types';
import { avatarSrc } from '../../utils/avatar';
import { getServerURL, getToken } from '../../runtimeConfig';
import { TTSButton } from '../common/TTSButton';

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
  const [batchLeft, setBatchLeft] = useState(0); // >0 表示正在批量模式
  const [sampleCount, setSampleCount] = useState<30 | 60 | 120>(30); // 仅对未训练分身的成员生效
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  // 会话持久化
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [sessionName, setSessionName] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  interface SavedSession {
    id: number; name: string; topic: string;
    members: { username: string; name: string; avatar?: string }[];
    history: { speaker: string; display_name: string; content: string; avatar?: string }[];
    created_at: number; updated_at: number;
  }
  const [savedList, setSavedList] = useState<SavedSession[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // historyRef 跟随 history，stream 里 push fresh 时直接 historyRef.current.length 取索引，
  // 这样 setHistory 的 reducer 保持纯函数（不在回调里写外部变量）。
  const historyRef = useRef<TurnMsg[]>([]);
  const batchCancelRef = useRef(false);

  // TTS 声音按成员 index 的奇偶分配 A/B —— 让不同人音色不同
  const speakerVoice = useMemo(() => {
    const m: Record<string, 'A' | 'B'> = {};
    members.forEach((c, i) => { m[c.username] = i % 2 === 0 ? 'A' : 'B'; });
    return m;
  }, [members]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history]);
  // setHistory 的所有调用都改走它：同步推进 historyRef，避免 useEffect/commit 时机
  // 让 ref 落后于 stream 内连续 push 的真实长度。
  const updateHistory = (next: TurnMsg[] | ((h: TurnMsg[]) => TurnMsg[])) => {
    const computed = typeof next === 'function' ? (next as (h: TurnMsg[]) => TurnMsg[])(historyRef.current) : next;
    historyRef.current = computed;
    setHistory(computed);
  };

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

  const requestTurn = async (nextSpeaker = 'auto', turns = 1) => {
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
          turns,
          sample_count: sampleCount,
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
      // 用 index 寻址当前条：之前用 `cur` 变量 + `x === cur` 在 setHistory 回调里
      // 比对引用，但第一个 delta 的 setState 会把数组里的 fresh 替换成浅拷贝；
      // cur 还指向已不在数组里的 fresh，第二个 delta 起 map 找不到匹配 → 后续
      // delta 全部丢失，UI 看起来一卡一卡只渲染第一段。
      let curIdx = -1;
      const finalizeCur = () => {
        if (curIdx < 0) return;
        const i = curIdx;
        updateHistory(h => h.map((x, idx) => (idx === i ? { ...x, streaming: false } : x)));
        curIdx = -1;
      };
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
              delta?: string; done?: boolean; turn_end?: boolean; error?: string;
            };
            if (chunk.error) throw new Error(chunk.error);
            if (chunk.meta && chunk.speaker) {
              finalizeCur(); // 上一条收尾
              const m = members.find(x => x.username === chunk.speaker);
              const fresh: TurnMsg = {
                speaker: chunk.speaker,
                displayName: chunk.display_name || (m ? displayOf(m) : chunk.speaker),
                content: '',
                avatar: m?.big_head_url || m?.small_head_url,
                streaming: true,
              };
              curIdx = historyRef.current.length;
              updateHistory(h => [...h, fresh]);
              continue;
            }
            if (chunk.delta && curIdx >= 0) {
              const i = curIdx;
              const delta = chunk.delta;
              updateHistory(h => h.map((x, idx) => (idx === i ? { ...x, content: x.content + delta } : x)));
            }
            if (chunk.turn_end) {
              finalizeCur();
            }
            if (chunk.done) {
              finalizeCur();
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
    updateHistory(h => [...h, { speaker: '我', displayName: '我', content: t }]);
    setUserInput('');
    // 用户发完，自动让 AI 回一轮
    setTimeout(() => requestTurn('auto'), 50);
  };

  const reset = () => {
    if (loading && abortRef.current) abortRef.current.abort();
    batchCancelRef.current = true;
    setBatchLeft(0);
    updateHistory([]);
  };

  // 批量连跑 N 条：一次 LLM 调用生成 N 条（不再循环 N 次）。
  // 速度比旧版快几倍：省掉 N-1 次 LLM 握手，且同一 prompt 上下文只传一次。
  const runBatch = async (n: number) => {
    if (loading || !canStart) return;
    batchCancelRef.current = false;
    setBatchLeft(n);
    await requestTurn('auto', n);
    setBatchLeft(0);
  };

  const stopBatch = () => {
    batchCancelRef.current = true;
    if (abortRef.current) abortRef.current.abort();
    setBatchLeft(0);
  };

  // ── 持久化 ──
  const loadSavedList = async () => {
    try {
      const r = await axios.get<{ sessions: SavedSession[] }>('/api/ai/virtual-group/sessions');
      setSavedList(r.data.sessions || []);
    } catch { setSavedList([]); }
  };

  useEffect(() => { void loadSavedList(); }, []);

  const saveSession = async (asNew: boolean) => {
    if (members.length === 0) { alert('至少要有成员'); return; }
    setSaving(true);
    try {
      const name = sessionName.trim() || (topic.trim() || members.map(displayOf).slice(0, 3).join(' / ')) + ` @ ${new Date().toLocaleString('zh-CN', { hour12: false })}`;
      const body = {
        id: asNew ? 0 : (sessionId || 0),
        name,
        topic,
        members: members.map(m => ({ username: m.username, name: displayOf(m), avatar: m.big_head_url || m.small_head_url })),
        history: history
          .filter(h => h && typeof h.content === 'string')
          .map(h => ({ speaker: h.speaker, display_name: h.displayName, content: h.content, avatar: h.avatar })),
      };
      const r = await axios.post<{ id: number }>('/api/ai/virtual-group/sessions', body);
      setSessionId(r.data.id);
      setSessionName(name);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      void loadSavedList();
    } catch (e: unknown) {
      alert('保存失败：' + ((e as { response?: { data?: { error?: string } }; message?: string }).response?.data?.error || (e as Error).message));
    } finally { setSaving(false); }
  };

  const loadSession = async (id: number) => {
    try {
      const r = await axios.get<SavedSession>(`/api/ai/virtual-group/sessions/${id}`);
      const s = r.data;
      // 重建成员 ContactStats（用保存时的 avatar/name；找不到 contact 就构造一个占位）
      const rebuilt: ContactStats[] = s.members.map(m => {
        const existing = contacts.find(c => c.username === m.username);
        if (existing) return existing;
        return {
          username: m.username,
          nickname: m.name,
          remark: '',
          alias: '',
          flag: 0,
          verify_flag: 0,
          big_head_url: m.avatar || '',
          small_head_url: m.avatar || '',
          description: '',
          total_messages: 0,
        } as unknown as ContactStats;
      });
      setMembers(rebuilt);
      setTopic(s.topic || '');
      // 过滤 null / 缺字段的坏数据（老版本 bug 可能留下的脏记录）
      updateHistory((s.history || [])
        .filter(h => h && typeof h.content === 'string' && typeof h.speaker === 'string')
        .map(h => ({
          speaker: h.speaker, displayName: h.display_name, content: h.content, avatar: h.avatar,
        })));
      setSessionId(s.id);
      setSessionName(s.name);
      setHistoryOpen(false);
    } catch (e: unknown) {
      alert('载入失败：' + ((e as Error).message || '未知错误'));
    }
  };

  const deleteSession = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('删除这个虚拟群会话？')) return;
    try {
      await axios.delete(`/api/ai/virtual-group/sessions/${id}`);
      setSavedList(list => list.filter(x => x.id !== id));
      if (sessionId === id) { setSessionId(null); setSessionName(''); }
    } catch { /* ignore */ }
  };

  const newSession = () => {
    if (history.length > 0 && !confirm('开始新群聊会清空当前对话（记得先保存）。继续？')) return;
    setMembers([]);
    updateHistory([]);
    setTopic('');
    setSessionId(null);
    setSessionName('');
  };

  // 导出当前对话为图片：临时在聊天区外包一层带 header/footer 的节点截图
  const exportImage = async () => {
    if (exporting || history.length === 0 || !scrollRef.current) return;
    setExporting(true);
    setExported(false);
    try {
      // 构造一个 wrapper 克隆出聊天内容 + 品牌头尾
      const chatNode = scrollRef.current.cloneNode(true) as HTMLElement;
      // 展开全部消息（去掉 max-height 等限制）
      chatNode.style.maxHeight = 'none';
      chatNode.style.overflow = 'visible';
      chatNode.style.height = 'auto';

      const wrapper = document.createElement('div');
      wrapper.style.cssText = `
        width: 720px; background: #ffffff; padding: 0; font-family: system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
        position: fixed; left: -10000px; top: 0; z-index: -1;
      `;
      // header
      const header = document.createElement('div');
      header.style.cssText = `background: linear-gradient(90deg, #09d46a, #06a850); padding: 20px 28px; color: white;`;
      header.innerHTML = `
        <div style="font-size: 20px; font-weight: 900;">WeLink · AI 虚拟群聊</div>
        <div style="font-size: 12px; opacity: 0.8; margin-top: 4px;">${topic ? `场景：${topic} · ` : ''}成员 ${members.length} 位 · 共 ${history.length} 条消息</div>
      `;
      wrapper.appendChild(header);
      // 成员头像条
      const mbar = document.createElement('div');
      mbar.style.cssText = 'display: flex; gap: 8px; padding: 12px 28px; background: #f8f9fb; border-bottom: 1px solid #eee; align-items: center;';
      members.forEach(m => {
        const pill = document.createElement('div');
        pill.style.cssText = 'display:inline-flex; align-items:center; gap:6px; background:#fff; border:1px solid #eee; border-radius:999px; padding:4px 10px 4px 4px; font-size:12px;';
        pill.innerHTML = `<img src="${avatarSrc(m.big_head_url || m.small_head_url || '')}" style="width:22px;height:22px;border-radius:50%;object-fit:cover;background:#eee" /><span>${displayOf(m)}</span>`;
        mbar.appendChild(pill);
      });
      wrapper.appendChild(mbar);
      // 聊天区
      chatNode.style.background = '#f8faf8';
      chatNode.style.padding = '20px 28px';
      chatNode.style.border = 'none';
      chatNode.style.borderRadius = '0';
      wrapper.appendChild(chatNode);
      // footer
      const footer = document.createElement('div');
      footer.style.cssText = 'padding:16px 28px; background:#f8f9fb; border-top: 1px solid #eee; display:flex; justify-content:space-between; align-items:center; font-size:11px; color:#888;';
      footer.innerHTML = `
        <div>
          <div><strong style="color:#555">github.com/runzhliu/welink</strong></div>
          <div style="color:#bbb; margin-top:2px;">© ${new Date().getFullYear()} @runzhliu · AGPL-3.0</div>
        </div>
        <div style="color:#07c160; font-weight:700;">welink.click →</div>
      `;
      wrapper.appendChild(footer);
      document.body.appendChild(wrapper);

      const dataUrl = await toPng(wrapper, { pixelRatio: 2, cacheBust: true });
      document.body.removeChild(wrapper);

      // 下载
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `welink-virtual-group-${Date.now()}.png`;
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
    <div className="flex flex-col h-[calc(100vh-10rem)] max-w-4xl mx-auto">
      {/* Header */}
      <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#07c160] to-[#10aeff] flex items-center justify-center">
            <Sparkles size={18} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-black dk-text">
              AI 虚拟群聊
              {sessionName && <span className="ml-2 text-[11px] font-normal text-gray-400">· {sessionName}</span>}
            </h2>
            <p className="text-[11px] text-gray-400">
              把现实里不认识的几个人拉进同一个群聊，AI 用各自的说话风格让他们"聊起来"。
              风格来源：已训练分身 优先 · 私聊样例兜底。
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => { setHistoryOpen(v => !v); if (!historyOpen) void loadSavedList(); }}
              className={`relative p-1.5 rounded-lg transition-colors ${
                historyOpen
                  ? 'bg-[#07c160]/15 text-[#07c160]'
                  : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5'
              }`}
              title="历史会话"
            >
              <History size={16} />
              {savedList.length > 0 && !historyOpen && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 px-1 rounded-full bg-[#07c160] text-white text-[9px] font-bold flex items-center justify-center">
                  {savedList.length}
                </span>
              )}
            </button>
            <button
              onClick={() => saveSession(false)}
              disabled={saving || members.length === 0}
              className="p-1.5 rounded-lg text-gray-400 hover:text-[#07c160] hover:bg-gray-100 dark:hover:bg-white/5 disabled:opacity-30"
              title={sessionId ? '保存到当前会话' : '保存会话'}
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : saved ? <Check size={16} className="text-[#07c160]" /> : <Save size={16} />}
            </button>
            <button
              onClick={newSession}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5"
              title="新会话"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>

        {/* 历史会话面板 */}
        {historyOpen && (
          <div className="mt-3 border-t border-gray-100 dark:border-white/10 pt-3 max-h-56 overflow-y-auto">
            {savedList.length === 0 ? (
              <div className="text-center text-xs text-gray-400 py-6">还没保存过虚拟群会话</div>
            ) : (
              <ul className="space-y-1">
                {savedList.map(s => (
                  <li
                    key={s.id}
                    onClick={() => loadSession(s.id)}
                    className={`group flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer ${
                      sessionId === s.id ? 'bg-[#07c160]/10' : 'hover:bg-gray-100 dark:hover:bg-white/5'
                    }`}
                  >
                    <div className="flex -space-x-1.5 shrink-0">
                      {s.members.slice(0, 3).map(m => (
                        <img
                          key={m.username}
                          src={avatarSrc(m.avatar || '')}
                          alt=""
                          className="w-6 h-6 rounded-full object-cover bg-gray-200 border-2 border-white dark:border-[#1c1c1e]"
                        />
                      ))}
                      {s.members.length > 3 && (
                        <div className="w-6 h-6 rounded-full bg-gray-200 text-[9px] font-bold flex items-center justify-center border-2 border-white dark:border-[#1c1c1e]">
                          +{s.members.length - 3}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs dk-text truncate">{s.name}</div>
                      <div className="text-[10px] text-gray-400">
                        {s.members.length} 人 · {s.history.length} 条 · {new Date(s.updated_at * 1000).toLocaleDateString()}
                      </div>
                    </div>
                    <button
                      onClick={(e) => deleteSession(s.id, e)}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded text-gray-400 hover:text-red-500 transition-opacity"
                      title="删除"
                    >
                      <Trash2 size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

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
          {history.length > 0 && (
            <button
              onClick={exportImage}
              disabled={exporting}
              className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-gray-500 hover:text-[#07c160] disabled:opacity-50"
              title="导出聊天为图片"
            >
              {exporting ? <Loader2 size={12} className="animate-spin" /> : exported ? <Check size={12} className="text-[#07c160]" /> : <Share2 size={12} />}
              {exporting ? '生成中' : exported ? '已保存' : '导出图片'}
            </button>
          )}
          {members.length > 0 && (
            <button
              onClick={reset}
              className={`${history.length > 0 ? '' : 'ml-auto'} inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-gray-400 hover:text-red-500`}
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

        {/* 样例深度：仅对未训练分身的成员生效 */}
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-gray-500 dark:text-gray-400">样例深度</span>
          <div className="inline-flex items-center gap-1 rounded-lg bg-gray-100 dark:bg-white/5 p-0.5">
            {[
              { v: 30 as const,  label: '轻' },
              { v: 60 as const,  label: '中' },
              { v: 120 as const, label: '深' },
            ].map(opt => (
              <button
                key={opt.v}
                onClick={() => setSampleCount(opt.v)}
                className={`px-2.5 py-0.5 rounded-md text-[11px] font-semibold transition-colors ${
                  sampleCount === opt.v
                    ? 'bg-white dark:bg-[#1c1c1e] text-[#07c160] shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-[#07c160]'
                }`}
              >
                {opt.label} {opt.v}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-gray-400">
            条 · 只对未训练分身的成员生效；训练过的用完整人设
          </span>
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
        {history.filter(m => m && typeof m.content === 'string').map((m, i) => {
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
              <div className={`max-w-[75%] group ${isMe ? 'items-end' : 'items-start'} flex flex-col gap-0.5`}>
                <span className="text-[10px] text-gray-400 px-1">{m.displayName}</span>
                <div className={`flex items-start gap-1 ${isMe ? 'flex-row-reverse' : ''}`}>
                  <div
                    className={`px-3 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
                      isMe
                        ? 'bg-[#07c160] text-white rounded-br-md'
                        : 'bg-white dark:bg-white/10 dk-text rounded-bl-md border border-gray-100 dark:border-white/5'
                    }`}
                  >
                    {m.content || (m.streaming ? <span className="text-gray-400"><Loader2 size={12} className="inline animate-spin" /> 在输入…</span> : '')}
                  </div>
                  {!isMe && m.content && !m.streaming && (
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity self-end pb-1">
                      <TTSButton
                        text={m.content}
                        speaker={speakerVoice[m.speaker] || 'A'}
                        size={12}
                      />
                    </div>
                  )}
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
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-[#07c160] to-[#10aeff] text-white text-sm font-bold disabled:opacity-40 hover:opacity-90"
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
          {batchLeft > 0 ? (
            <button
              onClick={stopBatch}
              className="flex items-center gap-1 px-3 py-2 rounded-xl bg-red-500/10 text-red-500 hover:bg-red-500/15 text-xs font-bold"
              title="中止"
            >
              <Square size={12} /> 停止（目标 {batchLeft} 条）
            </button>
          ) : (
            <>
              <button
                onClick={() => runBatch(5)}
                disabled={!canStart}
                className="flex items-center gap-1 px-3 py-2 rounded-xl border border-gray-200 dark:border-white/10 text-xs text-gray-500 hover:text-[#07c160] disabled:opacity-40"
                title="一次生成 5 条"
              >
                <Zap size={12} /> 来 5 条
              </button>
              <button
                onClick={() => runBatch(10)}
                disabled={!canStart}
                className="flex items-center gap-1 px-3 py-2 rounded-xl border border-gray-200 dark:border-white/10 text-xs text-gray-500 hover:text-[#07c160] disabled:opacity-40"
                title="一次生成 10 条"
              >
                <Zap size={12} /> 来 10 条
              </button>
            </>
          )}
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
