/**
 * 联系人详情弹窗组件
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { X, Users, EyeOff, Search, Loader2, Download, Bot } from 'lucide-react';
import type { ContactStats, ContactDetail, SentimentResult, GroupInfo, ChatMessage } from '../../types';
import { SearchContextModal, type SearchContextTarget } from '../search/SearchContextModal';
import { contactsApi } from '../../services/api';
import { exportContactCsv, exportContactTxt, EXPORT_LIMIT, parseExportResult } from '../../utils/exportChat';
import { WordCloudCanvas } from './WordCloudCanvas';
import { LLMAnalysisTab } from './LLMAnalysisTab';
import { ContactDetailCharts } from './ContactDetailCharts';
import { SentimentChart } from './SentimentChart';
import { MessageTypePieChart } from '../common/MessageTypePieChart';
import { useWordCloud } from '../../hooks/useContacts';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';

interface ContactModalProps {
  contact: ContactStats | null;
  onClose: () => void;
  onGroupClick?: (group: GroupInfo) => void;
  onBlock?: (username: string) => void;
  initialTab?: ModalTab;
  initialQuery?: string;
}

type ModalTab = 'wordcloud' | 'detail' | 'sentiment' | 'search' | 'ai';

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function shiftDays(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n); return isoDate(d);
}
function shiftMonths(n: number) {
  const d = new Date(); d.setMonth(d.getMonth() - n); return isoDate(d);
}
const today = isoDate(new Date());
const exportPresets = [
  { label: '最近一天', from: today,          to: today },
  { label: '最近一周', from: shiftDays(6),   to: today },
  { label: '最近一月', from: shiftMonths(1), to: today },
  { label: '最近一年', from: shiftMonths(12),to: today },
];

export const ContactModal: React.FC<ContactModalProps> = ({ contact, onClose, onGroupClick, onBlock, initialTab, initialQuery }) => {
  const { privacyMode } = usePrivacyMode();
  const { data: wordData, loading: isAnalysing, fetch: fetchWordCloud } = useWordCloud();
  const [tab, setTab] = useState<ModalTab>(initialTab ?? 'wordcloud');

  // 联系人切换时重置到指定 tab（支持从首页跳转到 AI 分析）
  useEffect(() => {
    if (contact) setTab(initialTab ?? 'wordcloud');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact?.username]);
  const [detail, setDetail] = useState<ContactDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [sentiment, setSentiment] = useState<SentimentResult | null>(null);
  const [sentimentLoading, setSentimentLoading] = useState(false);
  const [includeMine, setIncludeMine] = useState(false);
  const [commonGroups, setCommonGroups] = useState<GroupInfo[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ChatMessage[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchDone, setSearchDone] = useState(false);
  const [contextTarget, setContextTarget] = useState<SearchContextTarget | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const [showExportPanel, setShowExportPanel] = useState(false);
  const [exportMsg, setExportMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [groupsReady, setGroupsReady] = useState(false);
  const exportPanelRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 点击外部关闭导出面板
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
    if (!contact) return;
    setExporting(true);
    setExportMsg(null);
    try {
      const from = exportFrom ? Math.floor(new Date(exportFrom).getTime() / 1000) : undefined;
      const to = exportTo ? Math.floor(new Date(exportTo + 'T23:59:59').getTime() / 1000) : undefined;
      const msgs = await contactsApi.exportMessages(contact.username, from, to) ?? [];
      if (msgs.length === 0) {
        setExportMsg({ ok: false, message: '该时间范围内没有消息记录' });
        setTimeout(() => setExportMsg(null), 4000);
        return;
      }
      const name = contact.remark || contact.nickname || contact.username;
      const result = format === 'csv'
        ? await exportContactCsv(msgs, name, exportFrom || undefined, exportTo || undefined)
        : await exportContactTxt(msgs, name, exportFrom || undefined, exportTo || undefined);
      const parsed = parseExportResult(result);
      if (parsed.ok && msgs.length >= EXPORT_LIMIT) {
        parsed.message += `（超出限制，仅含最近 ${EXPORT_LIMIT.toLocaleString()} 条）`;
      }
      setExportMsg(parsed);
      setTimeout(() => setExportMsg(null), 4000);
    } finally {
      setExporting(false);
    }
  }, [contact, exportFrom, exportTo]);

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
      setSearchQuery('');
      setSearchResults([]);
      setSearchDone(false);
      setGroupsReady(false);
      fetchWordCloud(contact.username, false);
      fetchDetail(contact.username);
      fetchSentiment(contact.username, false);
      contactsApi.getCommonGroups(contact.username)
        .then(groups => { setCommonGroups(groups ?? []); setGroupsReady(true); })
        .catch(() => { setCommonGroups([]); setGroupsReady(true); });
    }
  }, [contact, fetchWordCloud, fetchDetail, fetchSentiment]);

  const handleSearch = useCallback(async (q: string) => {
    if (!contact || !q.trim()) return;
    setSearchLoading(true);
    setSearchDone(false);
    try {
      const results = await contactsApi.searchMessages(contact.username, q.trim(), includeMine);
      setSearchResults(results ?? []);
      setSearchDone(true);
    } catch (e) {
      console.error('Search failed', e);
    } finally {
      setSearchLoading(false);
    }
  }, [contact, includeMine]);

  // 切换「包含我的消息」时重新拉取词云和情感
  const handleToggleMine = (val: boolean) => {
    if (!contact) return;
    setIncludeMine(val);
    if (tab === 'wordcloud') fetchWordCloud(contact.username, val);
    if (tab === 'sentiment') fetchSentiment(contact.username, val);
    if (tab === 'search' && searchQuery.trim()) handleSearch(searchQuery);
  };

  if (!contact) return null;

  const displayName = contact.remark || contact.nickname || contact.username;
  const avatarUrl = contact.big_head_url || contact.small_head_url;
  // 只需等共同群聊加载完（groups 和 commonGroups 同批次更新，内容出现时高度已稳定）。
  // Canvas 在 opacity-0 容器里静默渲染，出现时通常已画好；若未画完，loading prop 短暂显示。
  const allReady = groupsReady;

  return (
    <>
    <div
      className="fixed inset-0 bg-[#1d1d1f]/90 backdrop-blur-md z-50 flex items-end sm:items-center justify-center sm:p-8 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="dk-card bg-white rounded-t-[32px] sm:rounded-[48px] w-full sm:max-w-5xl overflow-y-auto max-h-[calc(100dvh-5rem)] sm:max-h-[92vh] shadow-2xl relative p-4 sm:p-8 lg:p-16 animate-in slide-in-from-bottom sm:zoom-in duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top-right actions */}
        <div className="absolute top-5 right-5 sm:top-10 sm:right-10 flex items-center gap-2">
          {/* 导出 */}
          <div className="relative" ref={exportPanelRef}>
            <button
              disabled={exporting}
              onClick={() => setShowExportPanel(v => !v)}
              className={`p-2 rounded-xl transition-colors duration-200 disabled:opacity-40 ${showExportPanel ? 'text-[#07c160] bg-[#e7f8f0]' : 'text-gray-300 hover:text-[#07c160] hover:bg-[#e7f8f0]'}`}
              title="导出聊天记录"
            >
              {exporting ? <Loader2 size={20} className="animate-spin" /> : <Download size={20} strokeWidth={2} />}
            </button>
            {showExportPanel && (
              <div className="absolute right-0 top-full mt-1 flex flex-col bg-white border border-gray-100 rounded-2xl shadow-lg z-10 w-56 p-3 gap-2">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">日期范围（可选）</p>
                {/* 快捷选项 */}
                <div className="flex flex-wrap gap-1">
                  {exportPresets.map(p => (
                    <button
                      key={p.label}
                      onClick={() => { setExportFrom(p.from); setExportTo(p.to); }}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors
                        ${exportFrom === p.from && exportTo === p.to
                          ? 'bg-[#07c160] text-white border-[#07c160]'
                          : 'text-gray-500 border-gray-200 hover:border-[#07c160] hover:text-[#07c160]'}`}
                    >{p.label}</button>
                  ))}
                </div>
                <input
                  type="date" value={exportFrom} onChange={e => setExportFrom(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-[#07c160]"
                />
                <input
                  type="date" value={exportTo} onChange={e => setExportTo(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-[#07c160]"
                />
                <div className="flex gap-1 mt-1">
                  <button onClick={() => handleExport('csv')} disabled={exporting} className="flex-1 px-2 py-2 text-xs text-center text-gray-700 bg-gray-50 hover:bg-[#f0faf4] hover:text-[#07c160] rounded-xl transition-colors font-medium disabled:opacity-40">CSV</button>
                  <button onClick={() => handleExport('txt')} disabled={exporting} className="flex-1 px-2 py-2 text-xs text-center text-gray-700 bg-gray-50 hover:bg-[#f0faf4] hover:text-[#07c160] rounded-xl transition-colors font-medium disabled:opacity-40">TXT</button>
                </div>
                {exportMsg && (
                  <p className={`text-[10px] mt-1.5 leading-tight ${exportMsg.ok ? 'text-[#07c160]' : 'text-red-500'}`}>
                    {exportMsg.ok ? '✓ ' : '✕ '}{exportMsg.message}
                  </p>
                )}
              </div>
            )}
          </div>
          {onBlock && (
            <button
              onClick={() => { onBlock(contact.username); onClose(); }}
              className="p-2 rounded-xl text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors duration-200"
              title="屏蔽该联系人"
            >
              <EyeOff size={20} strokeWidth={2} />
            </button>
          )}
          <button
            onClick={onClose}
            className="text-gray-300 hover:text-gray-900 transition-colors duration-200"
          >
            <X size={28} strokeWidth={2} />
          </button>
        </div>

        {!allReady ? (
          <div className="flex items-center justify-center" style={{ minHeight: 400 }}>
            <div className="text-[#07c160] font-black animate-pulse uppercase tracking-[0.3em] text-lg">
              Analysing...
            </div>
          </div>
        ) : (
          <div className="animate-in fade-in duration-200">

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
            <h3 className={`dk-text text-xl sm:text-3xl font-black tracking-tight text-[#1d1d1f] mb-0.5${privacyMode ? ' privacy-blur' : ''}`}>
              {displayName}
            </h3>
            {contact.remark && contact.nickname && (
              <p className={`text-sm text-gray-400 mb-1${privacyMode ? ' privacy-blur' : ''}`}>{contact.nickname}</p>
            )}
            <p className="text-gray-400 font-bold flex flex-wrap items-center gap-2 tracking-widest uppercase text-xs">
              <span>始于 {contact.first_message_time}</span>
              <span className="text-gray-300">•</span>
              <span>{contact.total_messages.toLocaleString()} 条消息</span>
              {(contact.recall_count ?? 0) > 0 && (
                <>
                  <span className="text-gray-300">•</span>
                  <span className="text-orange-400">撤回 {contact.recall_count} 次</span>
                </>
              )}
              {(contact.avg_msg_len ?? 0) > 0 && (
                <>
                  <span className="text-gray-300">•</span>
                  <span>均 {contact.avg_msg_len!.toFixed(1)} 字/条</span>
                </>
              )}
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
                <span className={privacyMode ? 'privacy-blur' : ''}>{g.name}</span>
              </button>
            ))}
          </div>
        )}

        {/* Tabs + 消息范围切换 */}
        <div className="flex items-center justify-between mb-6 dk-border border-b border-gray-100">
          <div className="flex gap-2">
            {(['wordcloud', 'detail', 'sentiment', 'search', 'ai'] as ModalTab[]).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTab(t);
                  if (!contact) return;
                  if (t === 'wordcloud') fetchWordCloud(contact.username, includeMine);
                  if (t === 'sentiment') fetchSentiment(contact.username, includeMine);
                  if (t === 'search') setTimeout(() => searchInputRef.current?.focus(), 50);
                }}
                className={`flex items-center gap-1 px-3 sm:px-5 py-2 rounded-t-xl text-xs sm:text-sm font-bold transition border-b-2 -mb-px ${
                  tab === t
                    ? 'text-[#07c160] border-[#07c160]'
                    : 'text-gray-400 border-transparent hover:text-gray-600'
                }`}
              >
                {t === 'ai' && <Bot size={13} className="flex-shrink-0" />}
                {t === 'wordcloud' ? '词云分析' : t === 'detail' ? '深度画像' : t === 'sentiment' ? '情感分析' : t === 'search' ? '搜索记录' : 'AI 分析'}
              </button>
            ))}
          </div>

          {/* 只在词云/情感/搜索 tab 显示切换，AI tab 不需要 */}
          {(tab === 'wordcloud' || tab === 'sentiment' || tab === 'search') && (
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
            <div className="lg:col-span-2 flex flex-col">
              <p className="text-xs text-gray-400 mb-2">{includeMine ? '双方' : '对方'}文本消息分词统计，词越大出现频率越高，已过滤停用词与表情符号</p>
              <WordCloudCanvas
                data={wordData}
                loading={isAnalysing}
                className="h-[420px]"
              />
            </div>

            {/* Side Info */}
            <div className="space-y-4 sm:space-y-8">
              <div className="bg-[#f8f9fb] border border-gray-100 p-5 rounded-[28px] flex flex-col gap-1">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">第一条消息</p>
                <p className="text-[10px] text-gray-400">{contact.first_message_time}</p>
                <p className="text-sm italic font-medium text-[#1d1d1f] leading-relaxed mt-1">
                  "{contact.first_msg || '穿越时空的信号...'}"
                </p>
              </div>

              {contact.type_cnt && Object.keys(contact.type_cnt).length > 0 && (
                <MessageTypePieChart
                  typeData={contact.type_cnt}
                  totalMessages={contact.total_messages}
                />
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
            <SentimentChart data={sentiment} username={contact.username} contactName={displayName} includeMine={includeMine} />
          ) : (
            <div className="text-center text-gray-300 py-12">暂无情感数据</div>
          )
        )}

        {tab === 'ai' && (
          <LLMAnalysisTab
            username={contact.username}
            displayName={displayName}
            isGroup={false}
            totalMessages={contact.total_messages}
          />
        )}

        {tab === 'search' && (
          <div>
            {/* 搜索框 */}
            <form
              onSubmit={(e) => { e.preventDefault(); handleSearch(searchQuery); }}
              className="flex gap-2 mb-6"
            >
              <div className="flex-1 relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" strokeWidth={2.5} />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索聊天内容..."
                  className="w-full pl-9 pr-4 py-2.5 rounded-2xl border border-gray-200 text-sm focus:outline-none focus:border-[#07c160] transition-colors bg-gray-50"
                />
              </div>
              <button
                type="submit"
                disabled={!searchQuery.trim() || searchLoading}
                className="px-5 py-2.5 bg-[#07c160] text-white rounded-2xl text-sm font-bold disabled:opacity-40 hover:bg-[#06ad56] transition-colors"
              >
                搜索
              </button>
            </form>

            {/* 结果 */}
            {searchLoading ? (
              <div className="flex items-center justify-center h-40">
                <Loader2 size={28} className="text-[#07c160] animate-spin" />
              </div>
            ) : searchDone && searchResults.length === 0 ? (
              <div className="text-center text-gray-300 py-12 text-sm">未找到相关消息</div>
            ) : searchResults.length > 0 ? (
              <div>
                <p className="text-xs text-gray-400 mb-4">找到 {searchResults.length} 条消息{searchResults.length >= 200 ? '（最多显示 200 条）' : ''}</p>
                <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                  {searchResults.map((msg, i) => (
                    <div
                      key={i}
                      className={`flex items-end gap-2 cursor-pointer hover:opacity-80 transition-opacity ${msg.is_mine ? 'flex-row-reverse' : 'flex-row'}`}
                      onClick={() => msg.date && setContextTarget({
                        username: contact.username,
                        displayName,
                        date: msg.date,
                        targetTime: msg.time,
                        targetContent: msg.content,
                        isGroup: false,
                      })}
                      title="点击查看当天完整对话"
                    >
                      <div className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-white text-[9px] font-black
                        ${msg.is_mine ? 'bg-[#07c160]' : 'bg-[#576b95]'}`}>
                        {msg.is_mine ? '我' : displayName.charAt(0)}
                      </div>
                      <div className={`flex flex-col gap-0.5 max-w-[72%] ${msg.is_mine ? 'items-end' : 'items-start'}`}>
                        <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed break-words whitespace-pre-wrap
                          ${msg.is_mine ? 'bg-[#07c160] text-white rounded-br-sm' : 'bg-[#f0f0f0] text-[#1d1d1f] rounded-bl-sm'}`}>
                          {msg.content}
                        </div>
                        <span className="text-[10px] text-gray-300 px-1">{msg.date} {msg.time}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
          </div>
        )}
      </div>
    </div>

    {contextTarget && (
      <SearchContextModal
        {...contextTarget}
        onClose={() => setContextTarget(null)}
      />
    )}
  </>
  );
};
