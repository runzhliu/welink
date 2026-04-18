/**
 * 聊天回放播放器 — 按时间间隔回放聊天记录
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Play, Pause, SkipForward, X, Clock, Gauge } from 'lucide-react';
import type { ChatMessage } from '../../types';
import { contactsApi } from '../../services/api';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';
import { useSelfInfo } from '../../contexts/SelfInfoContext';
import { avatarSrc } from '../../utils/avatar';

interface Props {
  username: string;
  displayName: string;
  avatarUrl?: string;
  onClose: () => void;
}

const SPEED_OPTIONS = [
  { label: '实时', value: 1 },
  { label: '2x', value: 2 },
  { label: '5x', value: 5 },
  { label: '10x', value: 10 },
  { label: '50x', value: 50 },
  { label: '100x', value: 100 },
];

const MAX_GAP_MS = 5000; // 最大间隔 5 秒（即使实时间隔更长也不超过这个）

export const ChatReplay: React.FC<Props> = ({ username, displayName, avatarUrl, onClose }) => {
  const { privacyMode } = usePrivacyMode();
  const selfInfo = useSelfInfo();
  const [allMessages, setAllMessages] = useState<ChatMessage[]>([]);
  const [visibleCount, setVisibleCount] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(10);
  const [loading, setLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [msgLimit, setMsgLimit] = useState(100);
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const MSG_LIMIT_OPTIONS = [50, 100, 300, 500];

  // 加载消息
  const loadMessages = useCallback(async (useDate = false) => {
    setLoading(true);
    try {
      if (useDate && dateFrom) {
        // 日期范围模式：逐天加载
        const from = dateFrom;
        const to = dateTo || dateFrom;
        const allMsgs: ChatMessage[] = [];
        const startDate = new Date(from);
        const endDate = new Date(to);
        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
          const dateStr = d.toISOString().slice(0, 10);
          try {
            const dayMsgs = await contactsApi.getDayMessages(username, dateStr);
            if (dayMsgs?.length) {
              allMsgs.push(...dayMsgs.map(m => ({ ...m, date: dateStr })));
            }
          } catch {}
          if (allMsgs.length >= 500) break;
        }
        setAllMessages(allMsgs.slice(0, 500));
      } else {
        // 最近 N 条模式：用 export API 取最新的
        const msgs = await contactsApi.exportMessages(username);
        setAllMessages((msgs ?? []).slice(-msgLimit));
      }
      setVisibleCount(0);
      setPlaying(false);
      setLoaded(true);
    } catch {} finally { setLoading(false); }
  }, [username, dateFrom, dateTo, msgLimit]);

  // 计算两条消息之间的时间间隔（毫秒）
  const getDelay = useCallback((idx: number) => {
    if (idx <= 0 || idx >= allMessages.length) return 500;
    const cur = allMessages[idx];
    const prev = allMessages[idx - 1];
    if (!cur.date || !prev.date) return 500;

    const curTime = new Date(`${cur.date}T${cur.time}:00`).getTime();
    const prevTime = new Date(`${prev.date}T${prev.time}:00`).getTime();
    const realGap = Math.max(0, curTime - prevTime);

    // 按速度缩放，但不超过 MAX_GAP_MS
    const scaled = Math.min(realGap / speed, MAX_GAP_MS);
    return Math.max(scaled, 100); // 最小 100ms
  }, [allMessages, speed]);

  // 播放逻辑
  useEffect(() => {
    if (!playing || visibleCount >= allMessages.length) {
      if (visibleCount >= allMessages.length && allMessages.length > 0) setPlaying(false);
      return;
    }

    const delay = getDelay(visibleCount);
    timerRef.current = setTimeout(() => {
      setVisibleCount(prev => prev + 1);
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, delay);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [playing, visibleCount, allMessages.length, getDelay]);

  const togglePlay = () => {
    if (visibleCount >= allMessages.length) {
      setVisibleCount(0);
    }
    setPlaying(p => !p);
  };

  const skipForward = () => {
    setVisibleCount(prev => Math.min(prev + 10, allMessages.length));
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  };

  const progress = allMessages.length > 0 ? (visibleCount / allMessages.length) * 100 : 0;

  return (
    <div className="flex flex-col" style={{ minHeight: 400 }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-gray-500">
          {allMessages.length > 0 ? `${visibleCount} / ${allMessages.length} 条` : '选择时间范围后开始回放'}
        </div>
      </div>

        {/* 选择回放方式（未加载时显示） */}
        {!loaded && (
          <div className="flex-1 flex flex-col items-center justify-center gap-5 py-10">
            <Clock size={32} className="text-gray-300" />
            <div className="text-sm font-bold dk-text">选择回放方式</div>

            {/* 快捷选项：最近 N 条 */}
            <div>
              <div className="text-[10px] text-gray-400 text-center mb-2">按消息条数（最新的）</div>
              <div className="flex gap-2 justify-center">
                {MSG_LIMIT_OPTIONS.map(n => (
                  <button
                    key={n}
                    onClick={() => setMsgLimit(n)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      msgLimit === n ? 'bg-[#07c160] text-white' : 'bg-gray-100 dark:bg-white/10 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    最近 {n} 条
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => loadMessages(false)}
              disabled={loading}
              className="px-6 py-2.5 bg-[#07c160] text-white rounded-full font-bold text-sm hover:bg-[#06ad56] transition-colors disabled:opacity-50"
            >
              {loading ? '加载中...' : `回放最近 ${msgLimit} 条`}
            </button>

            {/* 分隔线 */}
            <div className="flex items-center gap-3 w-full max-w-xs">
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
              <span className="text-[10px] text-gray-300">或按日期</span>
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
            </div>

            {/* 日期范围 */}
            <div className="flex items-center gap-2">
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-xs dk-input" />
              <span className="text-gray-400 text-xs">~</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-xs dk-input" />
              <button
                onClick={() => loadMessages(true)}
                disabled={loading || !dateFrom}
                className="px-4 py-1.5 bg-gray-100 dark:bg-white/10 text-gray-600 rounded-lg text-xs font-bold hover:bg-gray-200 disabled:opacity-40 transition-colors"
              >
                {loading ? '...' : '回放'}
              </button>
            </div>
          </div>
        )}

        {/* 消息区域 */}
        {loaded && (
          <>
            <div ref={scrollRef} className="flex-1 overflow-y-auto py-2 space-y-2 bg-[#f0f0f0] dark:bg-gray-900/50 rounded-2xl px-3 max-h-[50vh]">
              {allMessages.slice(0, visibleCount).map((msg, i) => {
                const showDate = i === 0 || msg.date !== allMessages[i - 1]?.date;
                return (
                  <React.Fragment key={i}>
                    {showDate && msg.date && (
                      <div className="text-center py-2">
                        <span className="text-[10px] text-gray-400 bg-white dark:bg-gray-800 px-3 py-0.5 rounded-full shadow-sm">{msg.date}</span>
                      </div>
                    )}
                    <div className={`flex items-start gap-2 ${msg.is_mine ? 'flex-row-reverse' : ''} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
                      {msg.is_mine ? (
                        selfInfo?.avatar_url ? (
                          <img src={avatarSrc(selfInfo.avatar_url)} alt="" className="w-7 h-7 rounded-full flex-shrink-0 object-cover mt-0.5" />
                        ) : (
                          <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-white text-[9px] font-black bg-[#07c160] mt-0.5">我</div>
                        )
                      ) : avatarUrl ? (
                        <img src={avatarSrc(avatarUrl)} alt="" className="w-7 h-7 rounded-full flex-shrink-0 object-cover mt-0.5" />
                      ) : (
                        <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-white text-[9px] font-black bg-[#576b95] mt-0.5">
                          {displayName.charAt(0)}
                        </div>
                      )}
                      <div className={`max-w-[72%] px-3 py-2 rounded-2xl text-sm break-words ${
                        msg.is_mine
                          ? 'bg-[#07c160] text-white rounded-br-sm'
                          : 'bg-white dark:bg-gray-800 text-[#1d1d1f] dark:text-gray-100 rounded-bl-sm shadow-sm'
                      }`}>
                        {msg.content}
                      </div>
                    </div>
                    {i === visibleCount - 1 && playing && (
                      <div className="text-center py-1">
                        <span className="text-[9px] text-gray-400">{msg.time}</span>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
              {visibleCount >= allMessages.length && allMessages.length > 0 && (
                <div className="text-center py-6 text-gray-400 text-sm">— 回放结束 —</div>
              )}
            </div>

            {/* 控制栏 */}
            <div className="pt-3 space-y-2">
              {/* 进度条 */}
              <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div className="h-full bg-[#07c160] transition-all duration-200 rounded-full" style={{ width: `${progress}%` }} />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button onClick={togglePlay} className="w-9 h-9 rounded-full bg-[#07c160] flex items-center justify-center text-white hover:bg-[#06ad56] transition-colors shadow-sm">
                    {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
                  </button>
                  <button onClick={skipForward} className="text-gray-400 hover:text-[#07c160] p-1.5" title="快进 10 条">
                    <SkipForward size={14} />
                  </button>
                </div>

                <div className="flex items-center gap-1">
                  <Gauge size={11} className="text-gray-300" />
                  {SPEED_OPTIONS.map(s => (
                    <button
                      key={s.value}
                      onClick={() => setSpeed(s.value)}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-all ${
                        speed === s.value ? 'bg-[#07c160] text-white' : 'text-gray-400 hover:text-[#07c160]'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
    </div>
  );
};
