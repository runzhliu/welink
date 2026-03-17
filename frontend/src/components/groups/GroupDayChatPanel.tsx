/**
 * 群聊日历点击后展示当天聊天记录的面板
 */

import React, { useEffect, useRef, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import type { GroupChatMessage } from '../../types';
import { groupsApi } from '../../services/api';

interface GroupDayChatPanelProps {
  username: string;
  date: string;
  dayCount: number;
  groupName: string;
  onClose: () => void;
}

// 根据发言者名字生成固定颜色
const SPEAKER_COLORS = [
  '#07c160', '#10aeff', '#576b95', '#ff9500', '#ff3b30',
  '#af52de', '#5ac8fa', '#34c759', '#ff6b35', '#8b5cf6',
];
function speakerColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return SPEAKER_COLORS[Math.abs(hash) % SPEAKER_COLORS.length];
}

export const GroupDayChatPanel: React.FC<GroupDayChatPanelProps> = ({
  username, date, dayCount, groupName, onClose,
}) => {
  const [messages, setMessages] = useState<GroupChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    groupsApi.getDayMessages(username, date)
      .then(data => setMessages(data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [username, date]);

  useEffect(() => {
    if (!loading) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [loading]);

  const formatDate = (d: string) => {
    const [y, m, day] = d.split('-');
    return `${y}年${parseInt(m)}月${parseInt(day)}日`;
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-8 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-[32px] sm:rounded-[32px] w-full sm:max-w-lg flex flex-col max-h-[85vh] shadow-2xl animate-in slide-in-from-bottom sm:zoom-in duration-300"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 flex-shrink-0">
          <div>
            <div className="font-black text-[#1d1d1f] text-base">{formatDate(date)}</div>
            <div className="text-xs text-gray-400 mt-0.5">{groupName} · {dayCount} 条</div>
          </div>
          <button onClick={onClose} className="text-gray-300 hover:text-gray-600 transition-colors">
            <X size={22} />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 size={28} className="text-[#07c160] animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center text-gray-300 py-12 text-sm">暂无文字记录</div>
          ) : (
            messages.map((msg, i) => {
              const color = speakerColor(msg.speaker);
              // 合并连续同一发言者的消息：只在第一条显示头像和名字
              const showHeader = i === 0 || messages[i - 1].speaker !== msg.speaker;
              return (
                <div key={i} className="flex items-start gap-2">
                  {/* 头像占位（保持对齐） */}
                  {showHeader ? (
                    <div
                      className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-white text-[10px] font-black mt-0.5"
                      style={{ background: color }}
                    >
                      {msg.speaker.charAt(0)}
                    </div>
                  ) : (
                    <div className="w-8 flex-shrink-0" />
                  )}
                  <div className="flex flex-col gap-0.5 max-w-[80%]">
                    {showHeader && (
                      <span className="text-[11px] font-semibold" style={{ color }}>
                        {msg.speaker}
                      </span>
                    )}
                    <div className={`px-3 py-2 rounded-2xl rounded-tl-sm text-sm leading-relaxed break-words whitespace-pre-wrap
                      ${msg.type !== 1
                        ? 'bg-gray-100 text-gray-400 italic text-xs'
                        : 'bg-[#f0f0f0] text-[#1d1d1f]'
                      }`}
                    >
                      {msg.content}
                    </div>
                    <span className="text-[10px] text-gray-300 px-1">{msg.time}</span>
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
};
