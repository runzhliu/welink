/**
 * 语音 / 通话档案 Lab —— 把私聊里被其它分析忽略的语音条 + 音视频通话翻出来。
 *
 * GET /api/labs/voice-call
 *   - call_duration_rank: 煲电话粥榜（接通通话总时长降序）
 *   - call_longest_rank:  最长一次通话（单次最长降序）
 *   - voice_sender_rank:  语音条之王（谁爱给我发语音，TA 发时长降序）
 *   + 全局汇总（总通话时长 / 总语音条数）
 *
 * 纯解析（voicelength + 通话时长文本），零 LLM。仅供娱乐回顾。
 */

import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Phone, Mic, Loader2, RefreshCw, Share2, Check, AlertCircle, PhoneCall, PhoneMissed, Clock } from 'lucide-react';
import { captureCardToPng } from '../../utils/exportPng';
import { avatarSrc } from '../../utils/avatar';
import { useToast } from '../common/Toast';
import { WelinkBrand } from './_shared';

interface ContactRow {
  username: string;
  display_name: string;
  avatar_url: string;
  call_connected: number;
  call_missed: number;
  call_total_sec: number;
  call_longest_sec: number;
  voice_count: number;
  voice_total_sec: number;
  voice_longest_sec: number;
  my_voice_count: number;
  their_voice_count: number;
  their_voice_sec: number;
}

interface Resp {
  scanned_contacts: number;
  total_call_sec: number;
  total_call_connected: number;
  total_call_missed: number;
  total_voice_count: number;
  total_voice_sec: number;
  call_duration_rank: ContactRow[];
  call_longest_rank: ContactRow[];
  voice_sender_rank: ContactRow[];
  generated_at: number;
}

type Tab = 'call-dur' | 'call-long' | 'voice';

// 秒 → 时长（"45 秒" / "12:34" / "1:02:33"）
function fmtClock(sec: number): string {
  if (sec <= 0) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// 秒 → 粗略可读（hero 大字用）："3.2 小时" / "47 分钟"
function fmtRough(sec: number): string {
  if (sec <= 0) return '0';
  if (sec < 60) return `${sec} 秒`;
  if (sec < 3600) return `${Math.round(sec / 60)} 分钟`;
  const h = sec / 3600;
  return h < 10 ? `${h.toFixed(1)} 小时` : `${Math.round(h)} 小时`;
}

export const VoiceCallArchive: React.FC = () => {
  const toast = useToast();
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<Tab>('call-dur');
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const fetchData = async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setErr('');
    try {
      const r = await axios.get<Resp>('/api/labs/voice-call', { params: refresh ? { refresh: 1 } : {} });
      setData(r.data);
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } }; message?: string })
        ?.response?.data?.error || (e as Error).message || '加载失败';
      setErr(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchData(false); }, []);

  const today = new Date().toLocaleDateString('zh-CN');

  const exportPng = async () => {
    if (!data || !cardRef.current || exporting) return;
    setExporting(true);
    const r = await captureCardToPng(cardRef.current, {
      filename: `voice-call-${today.replace(/\//g, '-')}.png`,
      backgroundColor: '#ffffff',
      appendHTML: '',
    });
    setExporting(false);
    if (r.ok) {
      setExported(true);
      setTimeout(() => setExported(false), 2000);
    } else {
      toast.error('截图失败：' + (r.error || '未知错误'));
    }
  };

  const tabs: { key: Tab; label: string; hint: string }[] = [
    { key: 'call-dur',  label: '煲电话粥榜', hint: '和谁接通通话累计时长最长' },
    { key: 'call-long', label: '最长一次通话', hint: '单次通话时长之最' },
    { key: 'voice',     label: '语音条之王', hint: '谁最爱给你发语音条' },
  ];

  const rows = data
    ? (tab === 'call-dur' ? data.call_duration_rank : tab === 'call-long' ? data.call_longest_rank : data.voice_sender_rank)
    : [];

  const empty = data && data.call_duration_rank.length === 0
    && data.call_longest_rank.length === 0 && data.voice_sender_rank.length === 0;

  // 当前榜的主指标取值
  const mainVal = (c: ContactRow): number =>
    tab === 'call-dur' ? c.call_total_sec : tab === 'call-long' ? c.call_longest_sec : c.their_voice_sec;
  // 次行说明
  const subText = (c: ContactRow): string => {
    if (tab === 'call-dur') return `${c.call_connected} 次接通 · 最长 ${fmtClock(c.call_longest_sec)}`;
    if (tab === 'call-long') return `共 ${c.call_connected} 次接通 · 累计 ${fmtClock(c.call_total_sec)}`;
    return `TA 发 ${c.their_voice_count} 条 · 你发 ${c.my_voice_count} 条`;
  };

  const connectRate = data && (data.total_call_connected + data.total_call_missed) > 0
    ? Math.round(100 * data.total_call_connected / (data.total_call_connected + data.total_call_missed))
    : 0;

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-3 gap-2">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          统计私聊里的语音条和音视频通话——那些没留下文字、却很真实的陪伴。零 LLM、秒出。
        </p>
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={() => fetchData(true)}
            disabled={refreshing || loading}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/15 disabled:opacity-50 transition-colors"
          >
            {refreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            刷新
          </button>
          {data && !empty && (
            <button
              onClick={exportPng}
              disabled={exporting}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-gradient-to-r from-[#07c160] to-[#10aeff] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {exporting ? <Loader2 size={12} className="animate-spin" /> : exported ? <Check size={12} /> : <Share2 size={12} />}
              {exported ? '已下载' : '截图'}
            </button>
          )}
        </div>
      </div>

      {/* 免责声明 */}
      <div className="rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-3 mb-4 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
        <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
        <span>通话/语音只能读到时长和次数，<strong>读不到任何内容</strong>。仅供娱乐回顾 😉</span>
      </div>

      {err && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/30 p-3 mb-4 text-xs text-red-700 dark:text-red-300">{err}</div>
      )}

      {loading && (
        <div className="text-center py-16 text-gray-400 text-sm flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" />
          翻你这些年的通话和语音…
        </div>
      )}

      {empty && !loading && (
        <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-8 text-center text-sm text-gray-500">
          没找到语音条或通话记录
          <div className="text-xs text-gray-400 mt-2">已扫描 {data?.scanned_contacts} 个私聊</div>
        </div>
      )}

      {data && !empty && (
        <>
          {/* Tab 切换 */}
          <div className="flex gap-1.5 mb-3">
            {tabs.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex-1 px-2 py-2 rounded-xl text-xs font-bold transition-colors ${
                  tab === t.key
                    ? 'bg-gradient-to-r from-[#07c160] to-[#10aeff] text-white'
                    : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div ref={cardRef} className="rounded-2xl bg-white dark:bg-[#1c1c1e] overflow-hidden border border-gray-100 dark:border-white/10">
            {/* Hero */}
            <div className="px-7 py-6 bg-[#07c160]/8 dark:bg-[#07c160]/10 border-b border-[#07c160]/15">
              <div className="text-xs uppercase tracking-widest text-[#07c160] font-bold mb-1 flex items-center gap-1.5">
                {tab === 'voice' ? <Mic size={12} /> : <Phone size={12} />}
                Voice & Call · 语音/通话档案
              </div>
              <div className="text-2xl font-black text-[#1d1d1f] dark:text-gray-100 mb-1 break-words">
                {tabs.find(t => t.key === tab)?.label}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{tabs.find(t => t.key === tab)?.hint}</div>

              {/* 全局汇总三块 */}
              <div className="grid grid-cols-3 gap-2 mt-4">
                <div className="rounded-xl bg-white/70 dark:bg-white/5 px-3 py-2.5">
                  <div className="flex items-center gap-1 text-[10px] text-gray-400 mb-0.5"><PhoneCall size={10} /> 总通话</div>
                  <div className="text-base font-black text-[#07c160]">{fmtRough(data.total_call_sec)}</div>
                  <div className="text-[10px] text-gray-400">{data.total_call_connected} 次接通</div>
                </div>
                <div className="rounded-xl bg-white/70 dark:bg-white/5 px-3 py-2.5">
                  <div className="flex items-center gap-1 text-[10px] text-gray-400 mb-0.5"><PhoneMissed size={10} /> 接通率</div>
                  <div className="text-base font-black text-[#10aeff]">{connectRate}%</div>
                  <div className="text-[10px] text-gray-400">{data.total_call_missed} 次没接通</div>
                </div>
                <div className="rounded-xl bg-white/70 dark:bg-white/5 px-3 py-2.5">
                  <div className="flex items-center gap-1 text-[10px] text-gray-400 mb-0.5"><Mic size={10} /> 语音条</div>
                  <div className="text-base font-black text-[#07c160]">{data.total_voice_count}</div>
                  <div className="text-[10px] text-gray-400">共 {fmtRough(data.total_voice_sec)}</div>
                </div>
              </div>
            </div>

            {/* 榜单 */}
            <div className="px-5 py-4">
              {rows.length === 0 ? (
                <div className="text-center text-gray-400 text-sm py-6">这个维度暂无数据</div>
              ) : (
                <div className="space-y-1.5">
                  {rows.slice(0, 15).map((c, idx) => (
                    <div key={c.username} className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-white/5">
                      <span className="text-xs font-mono text-gray-400 w-6 text-right">#{idx + 1}</span>
                      {c.avatar_url ? (
                        <img src={avatarSrc(c.avatar_url) || ''} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#07c160] to-[#10aeff] flex items-center justify-center text-xs text-white font-bold flex-shrink-0">
                          {c.display_name.charAt(0)}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-[#1d1d1f] dark:text-gray-200 truncate">{c.display_name}</div>
                        <div className="flex items-center gap-1 text-[11px] text-gray-400 mt-0.5">
                          {tab === 'voice' ? <Mic size={9} /> : <Clock size={9} />}
                          {subText(c)}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-base font-black text-[#07c160]">
                          {tab === 'voice' ? fmtRough(mainVal(c)) : fmtClock(mainVal(c))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <WelinkBrand
              label="语音/通话档案"
              leftText={<>已扫描 {data.scanned_contacts} 个私聊 · {tabs.find(t => t.key === tab)?.label}</>}
            />
          </div>
        </>
      )}
    </div>
  );
};
