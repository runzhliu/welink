/**
 * 联系人详情弹窗组件
 */

import React, { useEffect, useState, useCallback } from 'react';
import { X, Users } from 'lucide-react';
import type { ContactStats, ContactDetail, SentimentResult, GroupInfo } from '../../types';
import { WordCloudCanvas } from './WordCloudCanvas';
import { ContactDetailCharts } from './ContactDetailCharts';
import { SentimentChart } from './SentimentChart';
import { useWordCloud } from '../../hooks/useContacts';
import { contactsApi } from '../../services/api';

interface ContactModalProps {
  contact: ContactStats | null;
  onClose: () => void;
  onGroupClick?: (group: GroupInfo) => void;
}

type ModalTab = 'wordcloud' | 'detail' | 'sentiment';

export const ContactModal: React.FC<ContactModalProps> = ({ contact, onClose, onGroupClick }) => {
  const { data: wordData, loading: isAnalysing, fetch: fetchWordCloud } = useWordCloud();
  const [tab, setTab] = useState<ModalTab>('wordcloud');
  const [detail, setDetail] = useState<ContactDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [sentiment, setSentiment] = useState<SentimentResult | null>(null);
  const [sentimentLoading, setSentimentLoading] = useState(false);
  const [includeMine, setIncludeMine] = useState(false);
  const [commonGroups, setCommonGroups] = useState<GroupInfo[]>([]);

  const fetchDetail = useCallback(async (username: string) => {
    setDetailLoading(true);
    try {
      const d = await contactsApi.getDetail(username);
      setDetail(d);
    } catch (e) {
      console.error('Failed to fetch detail', e);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const fetchSentiment = useCallback(async (username: string, mine: boolean) => {
    setSentimentLoading(true);
    try {
      const d = await contactsApi.getSentiment(username, mine);
      setSentiment(d);
    } catch (e) {
      console.error('Failed to fetch sentiment', e);
    } finally {
      setSentimentLoading(false);
    }
  }, []);

  useEffect(() => {
    if (contact) {
      setTab('wordcloud');
      setDetail(null);
      setSentiment(null);
      setIncludeMine(false);
      setCommonGroups([]);
      fetchWordCloud(contact.username, false);
      fetchDetail(contact.username);
      fetchSentiment(contact.username, false);
      contactsApi.getCommonGroups(contact.username).then(setCommonGroups).catch(() => {});
    }
  }, [contact, fetchWordCloud, fetchDetail, fetchSentiment]);

  // 切换「包含我的消息」时重新拉取词云和情感
  const handleToggleMine = (val: boolean) => {
    if (!contact) return;
    setIncludeMine(val);
    if (tab === 'wordcloud') fetchWordCloud(contact.username, val);
    if (tab === 'sentiment') fetchSentiment(contact.username, val);
  };

  if (!contact) return null;

  const displayName = contact.remark || contact.nickname || contact.username;
  const avatarUrl = contact.big_head_url || contact.small_head_url;

  return (
    <div
      className="fixed inset-0 bg-[#1d1d1f]/90 backdrop-blur-md z-50 flex items-end sm:items-center justify-center sm:p-8 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="dk-card bg-white rounded-t-[32px] sm:rounded-[48px] w-full sm:max-w-5xl overflow-y-auto max-h-[92vh] shadow-2xl relative p-6 sm:p-16 animate-in slide-in-from-bottom sm:zoom-in duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 sm:top-10 sm:right-10 text-gray-300 hover:text-gray-900 transition-colors duration-200"
        >
          <X size={28} strokeWidth={2} />
        </button>

        {/* Header */}
        <div className="mb-6 sm:mb-8 pr-10 sm:pr-0 flex items-center gap-4">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={displayName}
              className="w-14 h-14 sm:w-20 sm:h-20 rounded-2xl object-cover flex-shrink-0 shadow-md"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <div className="w-14 h-14 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-br from-[#07c160] to-[#06ad56] flex items-center justify-center text-white text-2xl sm:text-3xl font-black flex-shrink-0 shadow-md">
              {displayName.charAt(0)}
            </div>
          )}
          <div>
            <h3 className="dk-text text-xl sm:text-3xl font-black tracking-tight text-[#1d1d1f] mb-0.5">
              {displayName}
            </h3>
            {contact.remark && contact.nickname && (
              <p className="text-sm text-gray-400 mb-1">{contact.nickname}</p>
            )}
            <p className="text-gray-400 font-bold flex flex-wrap items-center gap-2 tracking-widest uppercase text-xs">
              <span>始于 {contact.first_message_time}</span>
              <span className="text-gray-300">•</span>
              <span>{contact.total_messages.toLocaleString()} 条消息</span>
            </p>
            {(contact.their_messages != null || contact.my_messages != null) && (
              <div className="flex items-center gap-3 mt-1.5">
                {contact.their_messages != null && (
                  <span className="flex items-center gap-1 text-xs font-semibold text-gray-500">
                    <span className="w-2 h-2 rounded-full bg-[#07c160] inline-block" />
                    对方 {contact.their_messages.toLocaleString()} 条
                  </span>
                )}
                {contact.my_messages != null && (
                  <span className="flex items-center gap-1 text-xs font-semibold text-gray-400">
                    <span className="w-2 h-2 rounded-full bg-gray-300 inline-block" />
                    我 {contact.my_messages.toLocaleString()} 条
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 共同群聊 */}
        {commonGroups.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1 text-xs font-black text-gray-400 uppercase tracking-wider mr-1">
              <Users size={12} strokeWidth={2.5} /> 共同群聊
            </span>
            {commonGroups.map((g) => (
              <button
                key={g.username}
                onClick={() => onGroupClick?.(g)}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#f0fdf4] border border-[#07c16030] text-[#07c160] text-xs font-semibold hover:bg-[#07c16015] transition-colors"
              >
                {g.small_head_url ? (
                  <img src={g.small_head_url} alt="" className="w-4 h-4 rounded-sm object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                ) : (
                  <Users size={11} strokeWidth={2} />
                )}
                {g.name}
              </button>
            ))}
          </div>
        )}

        {/* Tabs + 消息范围切换 */}
        <div className="flex items-center justify-between mb-6 dk-border border-b border-gray-100">
          <div className="flex gap-2">
            {(['wordcloud', 'detail', 'sentiment'] as ModalTab[]).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTab(t);
                  if (!contact) return;
                  if (t === 'wordcloud') fetchWordCloud(contact.username, includeMine);
                  if (t === 'sentiment') fetchSentiment(contact.username, includeMine);
                }}
                className={`px-5 py-2 rounded-t-xl text-sm font-bold transition border-b-2 -mb-px ${
                  tab === t
                    ? 'text-[#07c160] border-[#07c160]'
                    : 'text-gray-400 border-transparent hover:text-gray-600'
                }`}
              >
                {t === 'wordcloud' ? '词云分析' : t === 'detail' ? '深度画像' : '情感分析'}
              </button>
            ))}
          </div>

          {/* 只在词云/情感 tab 显示切换 */}
          {(tab === 'wordcloud' || tab === 'sentiment') && (
            <button
              onClick={() => handleToggleMine(!includeMine)}
              className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full border transition-all mb-1 ${
                includeMine
                  ? 'bg-[#07c160] text-white border-[#07c160]'
                  : 'bg-white text-gray-400 border-gray-200 hover:border-[#07c160] hover:text-[#07c160]'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${includeMine ? 'bg-white' : 'bg-gray-300'}`} />
              {includeMine ? '双方消息' : '仅对方消息'}
            </button>
          )}
        </div>

        {tab === 'wordcloud' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-10">
            {/* Word Cloud */}
            <div className="lg:col-span-2">
              <p className="text-xs text-gray-400 mb-2">{includeMine ? '双方' : '对方'}文本消息分词统计，词越大出现频率越高，已过滤停用词与表情符号</p>
              <WordCloudCanvas data={wordData} loading={isAnalysing} />
            </div>

            {/* Side Info */}
            <div className="space-y-4 sm:space-y-8">
              <div className="bg-gradient-to-br from-gray-900 to-gray-800 text-white p-6 sm:p-10 rounded-3xl sm:rounded-[40px] flex flex-col justify-center shadow-xl">
                <p className="text-[10px] font-black text-gray-500 uppercase mb-1 tracking-[0.2em]">
                  第一条消息
                </p>
                <p className="text-[10px] text-gray-500 mb-3">{contact.first_message_time}</p>
                <p className="text-base sm:text-lg italic font-medium leading-relaxed">
                  "{contact.first_msg || '穿越时空的信号...'}"
                </p>
              </div>

              {contact.type_pct && Object.keys(contact.type_pct).length > 0 && (
                <div className="bg-gradient-to-br from-[#07c160] to-[#06ad56] text-white p-6 sm:p-10 rounded-3xl sm:rounded-[40px] shadow-lg shadow-green-100/50">
                  <p className="text-[10px] font-black text-green-100 uppercase mb-1 tracking-[0.2em]">
                    Message Mix
                  </p>
                  <p className="text-[10px] text-green-200 mb-3">各类型消息占全部消息的比例</p>
                  <div className="space-y-2 font-bold text-sm">
                    {Object.entries(contact.type_pct).map(([k, v]: any) => (
                      <div key={k} className="flex justify-between items-center gap-2">
                        <span className="text-white/90">{k}</span>
                        <span className="text-white/50 text-xs font-normal flex-1 text-right">
                          {contact.type_cnt?.[k]?.toLocaleString() ?? ''}
                        </span>
                        <span className="text-white font-black w-10 text-right">{Math.round(v)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'detail' && (
          detailLoading ? (
            <div className="flex items-center justify-center h-48 text-[#07c160] font-bold animate-pulse text-sm">
              正在分析数据...
            </div>
          ) : detail ? (
            <ContactDetailCharts
              detail={detail}
              totalMessages={contact.total_messages}
              username={contact.username}
              contactName={displayName}
            />
          ) : (
            <div className="text-center text-gray-300 py-12">暂无深度数据</div>
          )
        )}

        {tab === 'sentiment' && (
          sentimentLoading ? (
            <div className="flex items-center justify-center h-48 text-[#07c160] font-bold animate-pulse text-sm">
              正在分析情感...
            </div>
          ) : sentiment ? (
            <SentimentChart data={sentiment} />
          ) : (
            <div className="text-center text-gray-300 py-12">暂无情感数据</div>
          )
        )}
      </div>
    </div>
  );
};
