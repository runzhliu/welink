/**
 * WeChatView —— 1:1 复刻微信手机端私聊界面的只读视图。
 *
 * 数据：GET /api/contacts/messages?username&date（GetDayMessages，按天返回双向消息）。
 * 顶部日期导航（前一天 / 后一天 / 日期选择器），默认落在该联系人最后聊天那天。
 * 支持导出当天聊天为长图（复用 captureCardToPng）。
 *
 * 视觉还原要点（对照真机微信）：
 *   - 聊天区底色 #ededed
 *   - 我方气泡 #95ec69（微信绿，比主题绿浅）右对齐 + 右尖角；对方白色气泡左对齐 + 左尖角
 *   - 头像为圆角方块（非圆形）
 *   - 居中灰色日期/时间分隔；系统消息居中小灰字
 *   - 媒体消息（图片/语音/视频/表情/红包）渲染成占位气泡
 */

import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { ChevronLeft, ChevronRight, Calendar, Loader2, Share2, Check, MoreHorizontal, ChevronLeft as Back } from 'lucide-react';
import { avatarSrc } from '../../utils/avatar';
import { useSelfInfo } from '../../contexts/SelfInfoContext';
import { captureCardToPng } from '../../utils/exportPng';
import { useToast } from '../common/Toast';

interface ChatMsg {
  time: string;      // "14:23"
  content: string;
  is_mine: boolean;
  type: number;      // local_type
}

interface Props {
  username: string;
  displayName: string;
  avatarUrl?: string;
  /** 联系人最后一条消息时间，如 "2024-03-15 14:23"，用作默认日期 */
  lastMessageTime?: string;
}

// 从 "2024-03-15 14:23" 或 "2024-03-15" 抠出 YYYY-MM-DD；抠不到用今天
function pickDefaultDate(s?: string): string {
  if (s && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

function shiftDate(date: string, deltaDays: number): string {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

// 媒体类型 → 占位气泡的图标/文案。文本(1)返回 null（正常渲染内容）
function mediaLabel(type: number, content: string): string | null {
  switch (type) {
    case 3: return '图片';
    case 34: return '语音';
    case 43: return '视频';
    case 47: return '表情';
    case 49:
      if (content.includes('红包') || content.includes('转账')) return '红包 / 转账';
      return '链接 / 文件';
    default:
      // 后端已把非文本统一成 "[xxx]"；text(1) 直接显示
      if (type !== 1 && /^\[.*\]$/.test(content)) return content.replace(/^\[|\]$/g, '');
      return null;
  }
}

export const WeChatView: React.FC<Props> = ({ username, displayName, avatarUrl, lastMessageTime }) => {
  const toast = useToast();
  const selfInfo = useSelfInfo();
  const [date, setDate] = useState(() => pickDefaultDate(lastMessageTime));
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const fetchDay = async (d: string) => {
    setLoading(true);
    setErr('');
    try {
      const r = await axios.get<ChatMsg[]>('/api/contacts/messages', { params: { username, date: d } });
      setMsgs(Array.isArray(r.data) ? r.data : []);
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } }; message?: string })
        ?.response?.data?.error || (e as Error).message || '加载失败';
      setErr(msg);
      setMsgs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDay(date); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [date, username]);

  const today = new Date().toISOString().slice(0, 10);
  const atToday = date >= today;

  const exportPng = async () => {
    if (!cardRef.current || exporting || msgs.length === 0) return;
    setExporting(true);
    const r = await captureCardToPng(cardRef.current, {
      filename: `wechat-${displayName}-${date}.png`,
      backgroundColor: '#ededed',
      width: 420, // 接近手机宽度，气泡比例更真
    });
    setExporting(false);
    if (r.ok) {
      setExported(true);
      setTimeout(() => setExported(false), 2000);
    } else {
      toast.error('截图失败：' + (r.error || '未知错误'));
    }
  };

  const myAvatar = selfInfo?.avatar_url;

  return (
    <div>
      {/* 日期导航 + 导出 */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setDate(shiftDate(date, -1))}
            className="p-1.5 rounded-lg bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/15 transition-colors"
            title="前一天"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="relative">
            <input
              type="date"
              value={date}
              max={today}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="text-sm font-semibold text-[#1d1d1f] dark:text-gray-200 bg-gray-100 dark:bg-white/10 rounded-lg pl-2.5 pr-2 py-1.5 outline-none focus:ring-2 focus:ring-[#07c160]/30"
            />
          </div>
          <button
            onClick={() => setDate(shiftDate(date, 1))}
            disabled={atToday}
            className="p-1.5 rounded-lg bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/15 disabled:opacity-30 transition-colors"
            title="后一天"
          >
            <ChevronRight size={16} />
          </button>
          <Calendar size={13} className="text-gray-400 ml-1" />
        </div>
        {msgs.length > 0 && (
          <button
            onClick={exportPng}
            disabled={exporting}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-[#07c160] text-white hover:bg-[#06ad56] disabled:opacity-50 transition-colors"
          >
            {exporting ? <Loader2 size={12} className="animate-spin" /> : exported ? <Check size={12} /> : <Share2 size={12} />}
            {exported ? '已下载' : '导出长图'}
          </button>
        )}
      </div>

      {err && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/30 p-3 mb-3 text-xs text-red-700 dark:text-red-300">{err}</div>
      )}

      {/* 微信聊天面板 */}
      <div className="rounded-2xl overflow-hidden border border-gray-200 dark:border-white/10 shadow-sm">
        <div ref={cardRef} className="bg-[#ededed]">
          {/* 顶栏：微信灰底 + 居中联系人名 */}
          <div className="relative flex items-center justify-center h-11 bg-[#ededed] border-b border-black/5 px-10">
            <Back size={20} className="absolute left-2 text-[#181818]" strokeWidth={2.5} />
            <span className="text-[15px] font-semibold text-[#181818] truncate max-w-[60%]">{displayName}</span>
            <MoreHorizontal size={20} className="absolute right-2 text-[#181818]" />
          </div>

          {/* 消息区 */}
          <div className="px-3 py-3 min-h-[200px] max-h-[60vh] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-40 text-gray-400 text-sm gap-2">
                <Loader2 size={14} className="animate-spin" /> 加载中…
              </div>
            ) : msgs.length === 0 ? (
              <div className="text-center py-16 text-[#9a9a9a] text-[13px]">
                这一天没有聊天记录
                <div className="text-xs text-[#b8b8b8] mt-1">换个日期试试 · {displayName}</div>
              </div>
            ) : (
              <>
                {/* 居中日期分隔 */}
                <div className="flex justify-center mb-3">
                  <span className="text-[11px] text-white bg-[#dadada] rounded px-2 py-0.5">{date}</span>
                </div>
                <div className="space-y-3">
                  {msgs.map((m, i) => <Bubble key={i} m={m} displayName={displayName} avatarUrl={avatarUrl} myAvatar={myAvatar} />)}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <p className="text-[10px] text-gray-400 mt-2 text-center">
        只读视图 · 按天浏览 · 数据全部来自本地，不上传
      </p>
    </div>
  );
};

// 单条气泡
const Bubble: React.FC<{ m: ChatMsg; displayName: string; avatarUrl?: string; myAvatar?: string }> = ({ m, displayName, avatarUrl, myAvatar }) => {
  const media = mediaLabel(m.type, m.content);
  const mine = m.is_mine;

  const avatar = mine ? myAvatar : avatarUrl;
  const fallbackChar = mine ? '我' : (displayName.charAt(0) || '?');
  const fallbackBg = mine ? 'bg-[#07c160]' : 'bg-[#576b95]';

  return (
    <div className={`flex items-start gap-2 ${mine ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* 头像：圆角方块 */}
      {avatar ? (
        <img
          src={avatarSrc(avatar) || ''}
          alt=""
          className="w-9 h-9 rounded-[5px] object-cover flex-shrink-0 bg-gray-200"
          onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
        />
      ) : (
        <div className={`w-9 h-9 rounded-[5px] flex-shrink-0 flex items-center justify-center text-white text-xs font-bold ${fallbackBg}`}>
          {fallbackChar}
        </div>
      )}

      {/* 气泡 + 尖角 */}
      <div className={`relative max-w-[68%] ${mine ? 'mr-0' : 'ml-0'}`}>
        <div
          className={`relative px-3 py-2 text-[15px] leading-[1.4] break-words whitespace-pre-wrap ${
            mine ? 'bg-[#95ec69] text-[#181818]' : 'bg-white text-[#181818]'
          }`}
          style={{ borderRadius: 6 }}
        >
          {media ? (
            <span className="inline-flex items-center gap-1 text-[#576b95]">
              <span className="text-base">{mediaIcon(media)}</span>
              <span className="text-[13px]">[{media}]</span>
            </span>
          ) : (
            m.content
          )}
          {/* 尖角：用绝对定位的小方块旋转 45° 模拟 */}
          <span
            className={`absolute top-3 w-2 h-2 rotate-45 ${mine ? 'bg-[#95ec69] -right-1' : 'bg-white -left-1'}`}
          />
        </div>
        {/* 时间：微信里默认不显示每条时间，这里放在气泡下方小灰字便于回溯 */}
        <div className={`text-[10px] text-[#b2b2b2] mt-0.5 ${mine ? 'text-right' : 'text-left'}`}>{m.time}</div>
      </div>
    </div>
  );
};

function mediaIcon(label: string): string {
  if (label === '图片') return '🖼️';
  if (label === '语音') return '🎤';
  if (label === '视频') return '🎬';
  if (label === '表情') return '😄';
  if (label.includes('红包') || label.includes('转账')) return '🧧';
  return '🔗';
}
