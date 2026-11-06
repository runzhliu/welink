import { DatePicker } from '../common/DatePicker';
import { Select } from '../common/Select';
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
import { ChevronLeft, ChevronRight, Calendar, Loader2, Share2, Check, User, Signal, Wifi, BatteryFull, Mic, Smile, PlusCircle } from 'lucide-react';
import { avatarSrc } from '../../utils/avatar';
import { useSelfInfo } from '../../contexts/SelfInfoContext';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';
import { captureCardToPng } from '../../utils/exportPng';
import { useToast } from '../common/Toast';

interface ChatMsg {
  time: string;      // "14:23"
  content: string;
  is_mine: boolean;
  type: number;      // local_type
  speaker?: string;
  avatar_url?: string;
}

interface Props {
  username: string;
  displayName: string;
  avatarUrl?: string;
  /** 联系人最后一条消息时间，如 "2024-03-15 14:23"，用作默认日期 */
  lastMessageTime?: string;
  isGroup?: boolean;
}

// Native pixel dimensions: https://www.apple.com/iphone-18-pro/specs/
// and https://www.apple.com/iphone-duo/specs/. Logical dimensions are at 3×.
const DEVICES = {
  promax: { label: 'iPhone 18 Pro Max · 1320 × 2868', width: 440, height: 956 },
  duoOuter: { label: 'iPhone Duo 外屏 · 1398 × 2034', width: 466, height: 678 },
  duoInner: { label: 'iPhone Duo 内屏 · 1878 × 2670', width: 626, height: 890 },
} as const;

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

// "HH:MM" → 当天分钟数；解析失败返回 -1
function toMinutes(t: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return -1;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// "21:04" → 微信风格 "晚上9:04"（带时段前缀 + 12 小时制）
function wechatTime(t: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return t;
  const h = parseInt(m[1], 10);
  const mm = m[2];
  let period = '';
  if (h < 5) period = '凌晨';
  else if (h < 8) period = '早上';
  else if (h < 12) period = '上午';
  else if (h < 13) period = '中午';
  else if (h < 18) period = '下午';
  else period = '晚上';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${period}${h12}:${mm}`;
}

// 真微信只在"会话开头"或"距上一条间隔较大"时插一条居中时间，不是每条都带。
const TIME_GAP_MIN = 5;

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

export const WeChatView: React.FC<Props> = ({ username, displayName, avatarUrl, lastMessageTime, isGroup = false }) => {
  const toast = useToast();
  const selfInfo = useSelfInfo();
  const { privacyMode } = usePrivacyMode();
  const visibleName = privacyMode ? (isGroup ? '群聊' : '联系人') : displayName;
  const [date, setDate] = useState(() => pickDefaultDate(lastMessageTime));
  const [activeDates, setActiveDates] = useState<string[]>([]);
  const [datesLoaded, setDatesLoaded] = useState(false);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [exportOptions, setExportOptions] = useState(false);
  const [device, setDevice] = useState<keyof typeof DEVICES>('promax');
  const [exportMode, setExportMode] = useState<'long' | 'screen'>('long');
  const cardRef = useRef<HTMLDivElement>(null);

  // 拉该联系人「有记录的日期」列表，默认落到最后有记录那天
  useEffect(() => {
    let cancelled = false;
    setDatesLoaded(false);
    axios.get<{ dates: string[] }>('/api/contacts/active-dates', { params: { username } })
      .then(r => {
        if (cancelled) return;
        const ds = r.data?.dates ?? [];
        setActiveDates(ds);
        if (ds.length > 0) setDate(ds[ds.length - 1]); // 最后有记录的一天
      })
      .catch(() => { /* 拿不到就退化成自由选日期 */ })
      .finally(() => { if (!cancelled) setDatesLoaded(true); });
    return () => { cancelled = true; };
  }, [username]);

  // 按天拉消息。带取消守卫：切换联系人/日期时，旧请求的迟到响应不能覆盖新数据
  // （否则会出现 B 的头部下显示 A 的消息、或慢请求把正确数据冲掉的竞态）。
  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setErr('');
    axios.get<ChatMsg[]>(isGroup ? '/api/groups/messages' : '/api/contacts/messages', { params: { username, date } })
      .then(r => {
        if (ignore) return;
        setMsgs(Array.isArray(r.data) ? r.data : []);
      })
      .catch(e => {
        if (ignore) return;
        const msg = (e as { response?: { data?: { error?: string } }; message?: string })
          ?.response?.data?.error || (e as Error).message || '加载失败';
        setErr(msg);
        setMsgs([]);
      })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [date, username, isGroup]);

  // 前一天 / 后一天：跳到「有记录的相邻日期」，而不是盲目 ±1 个自然日
  const curIdx = activeDates.indexOf(date);
  const goPrev = () => {
    if (activeDates.length === 0) { setDate(shiftDate(date, -1)); return; }
    if (curIdx > 0) setDate(activeDates[curIdx - 1]);
    else if (curIdx === -1) {
      // 当前日期不在列表里：跳到比它早的最近一天
      const earlier = [...activeDates].reverse().find(d => d < date);
      if (earlier) setDate(earlier);
    }
  };
  const goNext = () => {
    if (activeDates.length === 0) { setDate(shiftDate(date, 1)); return; }
    if (curIdx >= 0 && curIdx < activeDates.length - 1) setDate(activeDates[curIdx + 1]);
    else if (curIdx === -1) {
      // 当前日期不在列表里：跳到比它晚的最近一天
      const later = activeDates.find(d => d > date);
      if (later) setDate(later);
    }
  };
  const firstDate = activeDates[0];
  const lastDate = activeDates[activeDates.length - 1];
  const canPrev = activeDates.length === 0 || (firstDate !== undefined && date > firstDate);
  const canNext = activeDates.length === 0 || (lastDate !== undefined && date < lastDate);

  const today = new Date().toISOString().slice(0, 10);

  const exportPng = async () => {
    if (!cardRef.current || exporting || msgs.length === 0) return;
    setExporting(true);
    const preset = DEVICES[device];
    const originalMessages = cardRef.current.querySelector<HTMLElement>('[data-wechat-messages]');
    const scrollFraction = originalMessages && originalMessages.scrollHeight > originalMessages.clientHeight
      ? originalMessages.scrollTop / (originalMessages.scrollHeight - originalMessages.clientHeight) : 0;
    const r = await captureCardToPng(cardRef.current, {
      filename: `wechat-${visibleName}-${date}-${device}-${exportMode}.png`,
      backgroundColor: '#ededed',
      width: preset.width,
      height: exportMode === 'screen' ? preset.height : undefined,
      scale: 3,
      beforeCapture: wrapper => {
        const card = wrapper.querySelector<HTMLElement>('[data-wechat-card]');
        const messages = wrapper.querySelector<HTMLElement>('[data-wechat-messages]');
        if (!card || !messages) throw new Error('找不到聊天视图');
        // html2canvas 对 CJK 字体的基线计算偏低。单独调整文字，不移动气泡或尖角。
        wrapper.querySelectorAll<HTMLElement>('[data-wechat-bubble]').forEach(bubble => {
          bubble.style.paddingTop = '4px';
          bubble.style.paddingBottom = '12px';
        });
        wrapper.querySelectorAll<HTMLElement>('[data-wechat-content], [data-wechat-avatar-label]').forEach(content => {
          content.style.position = 'relative';
          content.style.top = '-5px';
        });
        card.style.height = exportMode === 'screen' ? `${preset.height}px` : 'auto';
        if (exportMode === 'long') {
          messages.style.flex = 'none';
          messages.style.overflow = 'visible';
          messages.style.maxHeight = 'none';
        } else {
          messages.scrollTop = scrollFraction * (messages.scrollHeight - messages.clientHeight);
        }
      },
      onClone: wrapper => {
        if (exportMode !== 'screen') return;
        const messages = wrapper.querySelector<HTMLElement>('[data-wechat-messages]');
        if (messages) messages.scrollTop = scrollFraction * (messages.scrollHeight - messages.clientHeight);
      },
    });
    setExporting(false);
    if (r.ok) {
      setExported(true);
      setExportOptions(false);
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
            onClick={goPrev}
            disabled={!canPrev}
            className="p-1.5 rounded-lg bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/15 disabled:opacity-30 transition-colors"
            title="上一个有记录的日期"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="relative">
            <DatePicker aria-label="选择日期"

              value={date}
              min={firstDate}
              max={today}
              onValueChange={(nextValue) => nextValue && setDate(nextValue)}
              className="text-sm font-semibold text-[#1d1d1f] dark:text-gray-200 bg-gray-100 dark:bg-white/10 rounded-lg pl-2.5 pr-2 py-1.5 outline-none focus:ring-2 focus:ring-[#07c160]/30"
            />
          </div>
          <button
            onClick={goNext}
            disabled={!canNext}
            className="p-1.5 rounded-lg bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/15 disabled:opacity-30 transition-colors"
            title="下一个有记录的日期"
          >
            <ChevronRight size={16} />
          </button>
          {datesLoaded && activeDates.length > 0 && (
            <span className="text-[11px] text-gray-400 ml-1 inline-flex items-center gap-1">
              <Calendar size={12} />共 {activeDates.length} 天有记录
            </span>
          )}
        </div>
        {msgs.length > 0 && (
          <button
            onClick={() => setExportOptions(v => !v)}
            disabled={exporting}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-[#07c160] text-white hover:bg-[#06ad56] disabled:opacity-50 transition-colors"
          >
            {exporting ? <Loader2 size={12} className="animate-spin" /> : exported ? <Check size={12} /> : <Share2 size={12} />}
            {exported ? '已下载' : '导出图片'}
          </button>
        )}
      </div>

      {exportOptions && <div className="mb-4 p-4 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 space-y-3">
        <div className="text-sm font-semibold text-gray-700 dark:text-gray-200">导出尺寸</div>
        <Select aria-label="选择手机屏幕尺寸" value={device} onValueChange={v => setDevice(v as keyof typeof DEVICES)} className="w-full">
          {Object.entries(DEVICES).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
        </Select>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-gray-600 dark:text-gray-300">
          <label className="flex items-center gap-2"><input type="radio" name="wechat-export-mode" checked={exportMode === 'long'} onChange={() => setExportMode('long')} />完整长图</label>
          <label className="flex items-center gap-2"><input type="radio" name="wechat-export-mode" checked={exportMode === 'screen'} onChange={() => setExportMode('screen')} />手机屏幕截图</label>
        </div>
        <p className="text-xs text-gray-400 leading-relaxed">{exportMode === 'long' ? '包含当天全部消息，宽度按所选屏幕像素，高度随内容增长。' : '导出选定手机的精确屏幕像素，显示当前滚动位置附近的内容；其他消息可滚动后再次导出。'}</p>
        <button type="button" onClick={exportPng} disabled={exporting} className="px-4 py-2 rounded-lg text-xs font-bold bg-[#07c160] text-white disabled:opacity-50">{exporting ? '正在生成…' : '下载 PNG'}</button>
      </div>}

      {err && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/30 p-3 mb-3 text-xs text-red-700 dark:text-red-300">{err}</div>
      )}

      {/* 微信聊天面板 */}
      <div className="mx-auto max-w-[440px] rounded-2xl overflow-hidden border border-gray-200 dark:border-white/10 shadow-sm">
        <div ref={cardRef} data-wechat-card className="bg-[#ededed] flex flex-col" style={{ height: 'min(72vh, 720px)', minHeight: 360 }}>
          <div aria-hidden="true" className="h-11 shrink-0 flex items-center justify-between px-6 text-[13px] font-semibold text-[#181818]">
            <span>9:41</span><span className="flex items-center gap-1"><Signal size={14} /><Wifi size={14} /><BatteryFull size={19} /></span>
          </div>
          {/* 顶栏：微信灰底 + 居中联系人名 */}
          <div className="relative flex items-center justify-center h-11 shrink-0 bg-[#ededed] px-10">
            <span aria-hidden="true" className="absolute left-3 text-[28px] leading-none text-[#181818]">‹</span>
            <span className="text-[15px] font-semibold text-[#181818] truncate max-w-[60%]">{visibleName}</span>
            <span aria-hidden="true" className="absolute right-3 text-[17px] tracking-[2px] leading-none text-[#181818]">•••</span>
          </div>

          {/* 消息区 */}
          <div data-wechat-messages className="px-3 py-3 min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-40 text-gray-400 text-sm gap-2">
                <Loader2 size={14} className="animate-spin" /> 加载中…
              </div>
            ) : msgs.length === 0 ? (
              <div className="text-center py-16 text-[#9a9a9a] text-[13px]">
                这一天没有聊天记录
                <div className="text-xs text-[#b8b8b8] mt-1">换个日期试试 · {visibleName}</div>
              </div>
            ) : (
              <>
                {/* 居中日期分隔 */}
                <div className="flex justify-center mb-3">
                  <span className="text-[12px] text-[#a5a5a5]">{date}</span>
                </div>
                <div className="space-y-2.5">
                  {msgs.map((m, i) => {
                    // 真微信：开头 + 间隔 ≥ 5 分钟时插一条居中时间
                    const prevMin = i > 0 ? toMinutes(msgs[i - 1].time) : -999;
                    const curMin = toMinutes(m.time);
                    const showTime = i === 0 || (curMin >= 0 && prevMin >= 0 && curMin - prevMin >= TIME_GAP_MIN);
                    return (
                      <React.Fragment key={i}>
                        {showTime && (
                          <div className="flex justify-center py-1">
                            <span className="text-[12px] text-[#a5a5a5]">{wechatTime(m.time)}</span>
                          </div>
                        )}
                        <Bubble m={m} displayName={isGroup ? (privacyMode ? '群成员' : (m.speaker || '未知')) : visibleName} avatarUrl={privacyMode ? undefined : (isGroup ? m.avatar_url : avatarUrl)} myAvatar={privacyMode ? undefined : myAvatar} selfName={privacyMode ? undefined : selfInfo?.nickname} isGroup={isGroup} />
                      </React.Fragment>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          <div aria-label="只读聊天记录" className="h-[58px] shrink-0 flex items-center gap-3 px-3 bg-[#f7f7f7] border-t border-black/5 text-[#222]">
            <Mic size={23} strokeWidth={1.6} /><div className="h-9 flex-1 rounded-md bg-white" /><Smile size={23} strokeWidth={1.6} /><PlusCircle size={23} strokeWidth={1.6} />
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
const Bubble: React.FC<{ m: ChatMsg; displayName: string; avatarUrl?: string; myAvatar?: string; selfName?: string; isGroup?: boolean }> = ({ m, displayName, avatarUrl, myAvatar, selfName, isGroup }) => {
  const media = mediaLabel(m.type, m.content);
  const mine = m.is_mine;
  const avatar = mine ? myAvatar : avatarUrl;
  const bubbleColor = mine ? '#95ec69' : '#ffffff';

  // CSS 三角尖角：贴在气泡靠头像那侧、顶部 ~13px 处（微信经典位置）
  const tailStyle: React.CSSProperties = mine
    ? { right: -5, top: 13, borderTop: '5px solid transparent', borderBottom: '5px solid transparent', borderLeft: `6px solid ${bubbleColor}` }
    : { left: -5, top: 13, borderTop: '5px solid transparent', borderBottom: '5px solid transparent', borderRight: `6px solid ${bubbleColor}` };

  return (
    <div className={`flex items-start gap-2.5 ${mine ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* 头像：圆角方块；无头像时用中性灰 + 人形图标（不再是绿色"我"方块） */}
      <Avatar src={avatar} fallbackChar={mine ? (selfName?.charAt(0) || '') : (displayName.charAt(0) || '')} />

      {/* 气泡 + 尖角。
          line-height 用紧凑值：html2canvas 截图时把文字按行框顶部对齐，行高过大
          单行气泡下方会留一截空白（看着"字没在中间"）。1.3 + 对称 py 视觉居中。 */}
      <div className="relative max-w-[70%]">
        {isGroup && !mine && <div className="text-[11px] text-[#999] mb-1 ml-0.5">{displayName}</div>}
        <div
          data-wechat-bubble
          className="relative px-3 py-2 text-[16px] break-words whitespace-pre-wrap text-[#181818]"
          style={{ background: bubbleColor, borderRadius: 5, lineHeight: 1.3 }}
        >
          <span data-wechat-content className="block">
            {media ? (
              <span className="inline-flex items-center gap-1 text-[#576b95]" style={{ lineHeight: 1.3 }}>
                <span className="text-[15px]">{mediaIcon(media)}</span>
                <span className="text-[14px]">{media}</span>
              </span>
            ) : m.content}
          </span>
          <span className="absolute w-0 h-0" style={tailStyle} />
        </div>
      </div>
    </div>
  );
};

// 头像：圆角方块；有图显图，无图显灰底人形（接近微信默认头像观感）
const Avatar: React.FC<{ src?: string; fallbackChar: string }> = ({ src, fallbackChar }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (src && !failed) {
    return (
      <img
        src={avatarSrc(src) || ''}
        alt=""
        className="w-10 h-10 rounded-[5px] object-cover flex-shrink-0 bg-[#d8d8d8]"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div className="w-10 h-10 rounded-[5px] flex-shrink-0 flex items-center justify-center bg-[#c8c8c8] text-white">
      {fallbackChar ? <span data-wechat-avatar-label className="text-sm font-semibold">{fallbackChar}</span> : <User size={20} className="text-white/90" />}
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
