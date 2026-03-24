/**
 * 搜索结果点击消息后展示当天完整聊天记录，自动滚动到目标消息并高亮
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { X, Loader2, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import type { ChatMessage, GroupChatMessage } from '../../types';
import { contactsApi, groupsApi } from '../../services/api';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';
import { exportDayMessagesCsv, exportDayMessagesTxt, parseExportResult } from '../../utils/exportChat';

export interface SearchContextTarget {
  username: string;
  displayName: string;
  date: string;          // "2024-03-15"
  targetTime: string;    // "14:23"
  targetContent: string; // 用于定位并高亮目标消息
  isGroup: boolean;
}

interface Props extends SearchContextTarget {
  onClose: () => void;
}

const SPEAKER_COLORS = [
  '#07c160', '#10aeff', '#576b95', '#ff9500', '#ff3b30',
  '#af52de', '#5ac8fa', '#34c759', '#ff6b35', '#8b5cf6',
];
function speakerColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return SPEAKER_COLORS[Math.abs(hash) % SPEAKER_COLORS.length];
}

function shiftDate(date: string, delta: number): string {
  const d = new Date(date + 'T12:00:00');
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

function formatDate(d: string): string {
  const [y, m, day] = d.split('-');
  return `${y}年${parseInt(m)}月${parseInt(day)}日`;
}

export const SearchContextModal: React.FC<Props> = ({
  username, displayName, date: initDate, targetTime, targetContent, isGroup, onClose,
}) => {
  const { privacyMode } = usePrivacyMode();
  const [date, setDate] = useState(initDate);
  const [messages, setMessages] = useState<(ChatMessage | GroupChatMessage)[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportMsg, setExportMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [showExportPanel, setShowExportPanel] = useState(false);
  const exportPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showExportPanel) return;
    const handler = (e: MouseEvent) => {
      if (exportPanelRef.current && !exportPanelRef.current.contains(e.target as Node)) {
        setShowExportPanel(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showExportPanel]);

  const handleExport = useCallback(async (format: 'csv' | 'txt') => {
    setShowExportPanel(false);
    const result = format === 'csv'
      ? await exportDayMessagesCsv(messages, displayName, date, isGroup)
      : await exportDayMessagesTxt(messages, displayName, date, isGroup);
    const parsed = parseExportResult(result);
    setExportMsg(parsed);
    setTimeout(() => setExportMsg(null), 4000);
  }, [messages, displayName, date, isGroup]);

  const targetRef = useRef<HTMLDivElement>(null);
  const shouldScrollToTarget = useRef(true);

  useEffect(() => {
    setLoading(true);
    const req = isGroup
      ? groupsApi.getDayMessages(username, date)
      : contactsApi.getDayMessages(username, date);
    req
      .then(data => setMessages(data ?? []))
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
  }, [username, date, isGroup]);

  useEffect(() => {
    if (!loading && shouldScrollToTarget.current && targetRef.current) {
      shouldScrollToTarget.current = false;
      setTimeout(() => targetRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    }
  }, [loading]);

  // 判断是否为目标消息：时间匹配 + 内容包含关键片段
  const isTarget = (msg: ChatMessage | GroupChatMessage) =>
    msg.time === targetTime && msg.content.includes(targetContent.slice(0, 30));

  const goDay = (delta: number) => {
    setDate(d => shiftDate(d, delta));
    shouldScrollToTarget.current = false;
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-8 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
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
            <div className="text-xs text-gray-400 mt-0.5">
              {isGroup
                ? <><span className={privacyMode ? 'privacy-blur' : ''}>{displayName}</span> · 群聊记录</>
                : <>与 <span className={privacyMode ? 'privacy-blur' : ''}>{displayName}</span> 的聊天</>
              }
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => goDay(-1)}
              className="p-2 text-gray-300 hover:text-gray-600 transition-colors rounded-xl hover:bg-gray-50"
              title="前一天"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={() => goDay(1)}
              className="p-2 text-gray-300 hover:text-gray-600 transition-colors rounded-xl hover:bg-gray-50"
              title="后一天"
            >
              <ChevronRight size={18} />
            </button>
            {!loading && messages.length > 0 && (
              <div className="relative ml-0.5" ref={exportPanelRef}>
                <button
                  onClick={() => setShowExportPanel(v => !v)}
                  className={`p-2 transition-colors rounded-xl ${showExportPanel ? 'text-[#07c160] bg-[#e7f8f0]' : 'text-gray-300 hover:text-[#07c160] hover:bg-[#e7f8f0]'}`}
                  title="导出当天记录"
                >
                  <Download size={16} />
                </button>
                {showExportPanel && (
                  <div className="absolute right-0 top-full mt-1 flex flex-col bg-white border border-gray-100 rounded-xl shadow-lg z-10 overflow-hidden min-w-[120px]">
                    <button onClick={() => handleExport('csv')} className="px-4 py-2 text-xs text-left text-gray-700 hover:bg-[#f0faf4] hover:text-[#07c160] whitespace-nowrap transition-colors">导出 CSV</button>
                    <button onClick={() => handleExport('txt')} className="px-4 py-2 text-xs text-left text-gray-700 hover:bg-[#f0faf4] hover:text-[#07c160] whitespace-nowrap transition-colors">导出 TXT</button>
                  </div>
                )}
                {exportMsg && (
                  <div className={`absolute right-0 top-full mt-1 px-3 py-1.5 text-[10px] rounded-xl shadow-lg bg-white border border-gray-100 whitespace-nowrap z-10 ${exportMsg.ok ? 'text-[#07c160]' : 'text-red-500'}`}>
                    {exportMsg.ok ? '✓ ' : '✕ '}{exportMsg.message}
                  </div>
                )}
              </div>
            )}
            <button
              onClick={onClose}
              className="p-2 text-gray-300 hover:text-gray-600 transition-colors rounded-xl hover:bg-gray-50 ml-1"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 size={28} className="text-[#07c160] animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center text-gray-300 py-12 text-sm">当天暂无记录</div>
          ) : isGroup ? (
            <div className="space-y-3">
              {(messages as GroupChatMessage[]).map((msg, i) => {
                const color = speakerColor(msg.speaker);
                const showHeader = i === 0 || (messages as GroupChatMessage[])[i - 1].speaker !== msg.speaker;
                const highlight = isTarget(msg);
                return (
                  <div
                    key={i}
                    ref={highlight ? targetRef : undefined}
                    className={`flex items-start gap-2 rounded-xl transition-all ${highlight ? 'ring-2 ring-yellow-300 ring-offset-2 bg-yellow-50/60 p-1' : ''}`}
                  >
                    {showHeader ? (
                      <div
                        className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-white text-[10px] font-black mt-0.5"
                        style={{ background: color }}
                      >
                        <span className={privacyMode ? 'privacy-blur' : ''}>{msg.speaker.charAt(0)}</span>
                      </div>
                    ) : (
                      <div className="w-8 flex-shrink-0" />
                    )}
                    <div className="flex flex-col gap-0.5 max-w-[80%]">
                      {showHeader && (
                        <span className={`text-[11px] font-semibold${privacyMode ? ' privacy-blur' : ''}`} style={{ color }}>
                          {msg.speaker}
                        </span>
                      )}
                      <div className={`px-3 py-2 rounded-2xl rounded-tl-sm text-sm leading-relaxed break-words whitespace-pre-wrap
                        ${msg.type !== 1 ? 'bg-gray-100 text-gray-400 italic text-xs' : 'bg-[#f0f0f0] text-[#1d1d1f]'}`}>
                        {msg.content}
                      </div>
                      <span className="text-[10px] text-gray-300 px-1">{msg.time}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2">
              {(messages as ChatMessage[]).map((msg, i) => {
                const highlight = isTarget(msg);
                return (
                  <div
                    key={i}
                    ref={highlight ? targetRef : undefined}
                    className={`flex items-end gap-2 rounded-xl transition-all ${msg.is_mine ? 'flex-row-reverse' : 'flex-row'} ${highlight ? 'ring-2 ring-yellow-300 ring-offset-2 bg-yellow-50/60 p-1' : ''}`}
                  >
                    <div className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-white text-[9px] font-black
                      ${msg.is_mine ? 'bg-[#07c160]' : 'bg-[#576b95]'}`}>
                      {msg.is_mine ? '我' : <span className={privacyMode ? 'privacy-blur' : ''}>{displayName.charAt(0)}</span>}
                    </div>
                    <div className={`flex flex-col gap-0.5 max-w-[72%] ${msg.is_mine ? 'items-end' : 'items-start'}`}>
                      <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed break-words whitespace-pre-wrap
                        ${msg.is_mine ? 'bg-[#07c160] text-white rounded-br-sm' : 'bg-[#f0f0f0] text-[#1d1d1f] rounded-bl-sm'}
                        ${msg.type !== 1 ? 'italic text-gray-400 bg-gray-100 text-xs' : ''}`}>
                        {msg.content}
                      </div>
                      <span className="text-[10px] text-gray-300 px-1">{msg.time}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
