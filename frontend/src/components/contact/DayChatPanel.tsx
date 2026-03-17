/**
 * 点击日历某天后，展示当天双方聊天记录的面板
 */

import React, { useEffect, useRef, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import type { ChatMessage } from '../../types';
import { contactsApi } from '../../services/api';

interface DayChatPanelProps {
  username: string;
  date: string;       // "2024-03-15"
  dayCount: number;   // 当天消息数
  contactName: string;
  onClose: () => void;
}

export const DayChatPanel: React.FC<DayChatPanelProps> = ({
  username, date, dayCount, contactName, onClose,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    contactsApi.getDayMessages(username, date)
      .then(data => setMessages(data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [username, date]);

  useEffect(() => {
    if (!loading) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [loading]);

  const formatDate = (d: string) => {
    const [y, m, day] = d.split('-');
    return `${y}年${parseInt(m)}月${parseInt(day)}日`;
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-8 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
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
            <div className="text-xs text-gray-400 mt-0.5">与 {contactName} 的聊天 · {dayCount} 条</div>
          </div>
          <button onClick={onClose} className="text-gray-300 hover:text-gray-600 transition-colors">
            <X size={22} />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 size={28} className="text-[#07c160] animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center text-gray-300 py-12 text-sm">暂无文字记录</div>
          ) : (
            messages.map((msg, i) => (
              <div key={i} className={`flex items-end gap-2 ${msg.is_mine ? 'flex-row-reverse' : 'flex-row'}`}>
                {/* Avatar dot */}
                <div className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-white text-[9px] font-black
                  ${msg.is_mine ? 'bg-[#07c160]' : 'bg-[#576b95]'}`}>
                  {msg.is_mine ? '我' : contactName.charAt(0)}
                </div>
                <div className={`flex flex-col gap-0.5 max-w-[72%] ${msg.is_mine ? 'items-end' : 'items-start'}`}>
                  <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed break-words whitespace-pre-wrap
                    ${msg.is_mine
                      ? 'bg-[#07c160] text-white rounded-br-sm'
                      : 'bg-[#f0f0f0] text-[#1d1d1f] rounded-bl-sm'
                    }
                    ${msg.type !== 1 ? 'italic text-gray-500 bg-gray-100 text-xs' : ''}`}
                  >
                    {msg.content}
                  </div>
                  <span className="text-[10px] text-gray-300 px-1">{msg.time}</span>
                </div>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
};
