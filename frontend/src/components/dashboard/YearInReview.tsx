/**
 * 年度社交回顾 — 类似 Spotify Wrapped 的年度总结
 * 分页卡片式展示，支持导出为长图
 */

import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight, Share2, Loader2, Check, Calendar, MessageCircle, Moon, Users, Sparkles, Heart } from 'lucide-react';
import type { ContactStats, GlobalStats } from '../../types';
import { statsApi } from '../../services/api';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';
import { avatarSrc } from '../../utils/avatar';
import QRCode from 'qrcode';
import { RevealLink } from '../common/RevealLink';

interface Props {
  contacts: ContactStats[];
  globalStats: GlobalStats | null;
  onClose: () => void;
}

function displayName(c: ContactStats) {
  return c.remark || c.nickname || c.username;
}

// 检测 WebView
function isWebView() {
  const ua = navigator.userAgent;
  return ua.includes('AppleWebKit') && !ua.includes('Safari') && !ua.includes('Chrome') && !ua.includes('Firefox');
}

async function downloadPng(dataUrl: string, filename: string): Promise<string | null> {
  if (isWebView()) {
    const base64 = dataUrl.split(',')[1] ?? dataUrl;
    const resp = await fetch('/api/app/save-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, content: base64, encoding: 'base64' }),
    });
    if (resp.ok) {
      const d = await resp.json() as { path?: string };
      return d.path ?? `~/Downloads/${filename}`;
    }
    return null;
  } else {
    const link = document.createElement('a');
    link.download = filename;
    link.href = dataUrl;
    link.click();
    return null;
  }
}

export const YearInReview: React.FC<Props> = ({ contacts, globalStats, onClose }) => {
  const { privacyMode } = usePrivacyMode();
  const currentYear = new Date().getFullYear();
  const [page, setPage] = useState(0);
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // 从聊天记录推导可用年份范围
  const years = useMemo(() => {
    let minYear = currentYear;
    for (const c of contacts) {
      if (c.first_message_time && c.first_message_time !== '-') {
        const y = parseInt(c.first_message_time.slice(0, 4));
        if (y > 2000 && y < minYear) minYear = y;
      }
    }
    // 也从 monthly_trend 取最早年份
    if (globalStats?.monthly_trend) {
      for (const month of Object.keys(globalStats.monthly_trend)) {
        const y = parseInt(month.slice(0, 4));
        if (y > 2000 && y < minYear) minYear = y;
      }
    }
    const result: number[] = [];
    for (let y = currentYear; y >= minYear; y--) result.push(y);
    return result;
  }, [currentYear, contacts, globalStats]);

  const [selectedYear, setSelectedYear] = useState(() => {
    // 默认选去年（如果有数据），否则选最近的年份
    return years.includes(currentYear - 1) ? currentYear - 1 : years[0] ?? currentYear;
  });

  // 按年份从后端加载精确数据
  const [yearLoading, setYearLoading] = useState(false);
  const [yearData, setYearData] = useState<{
    totalYearMsgs: number;
    monthlyMsgs: Record<string, number>;
    peakMonth: string;
    peakMonthCount: number;
    activeDays: number;
    yearContacts: ContactStats[];
    newFriends: ContactStats[];
    lateNightMsgs: number;
    lateNightTop: { name: string; late_night_count: number }[];
    totalContacts: number;
  } | null>(null);

  useEffect(() => {
    setYearLoading(true);
    setYearData(null);
    setPage(0);

    const yearStart = Math.floor(new Date(`${selectedYear}-01-01T00:00:00`).getTime() / 1000);
    const yearEnd = Math.floor(new Date(`${selectedYear}-12-31T23:59:59`).getTime() / 1000);

    statsApi.filter(yearStart, yearEnd).then(result => {
      if (!result) return;
      const gs = result.global_stats;
      const cs = result.contacts ?? [];

      // 月度消息量
      const monthlyMsgs: Record<string, number> = gs?.monthly_trend ?? {};
      let totalYearMsgs = 0;
      for (const count of Object.values(monthlyMsgs)) totalYearMsgs += count;

      // 最活跃月份
      let peakMonth = '';
      let peakMonthCount = 0;
      for (const [month, count] of Object.entries(monthlyMsgs)) {
        if (count > peakMonthCount) { peakMonth = month; peakMonthCount = count; }
      }

      // 活跃天数
      const activeDays = Math.min(Object.keys(monthlyMsgs).length * 25, 365);

      // Top 5（按该年度过滤后的消息量排序）
      const yearContacts = [...cs]
        .filter(c => c.total_messages > 0)
        .sort((a, b) => b.total_messages - a.total_messages)
        .slice(0, 5);

      // 新认识的人
      const yearPrefix = `${selectedYear}-`;
      const newFriends = cs.filter(c =>
        c.first_message_time?.startsWith(yearPrefix) && c.total_messages > 0
      ).sort((a, b) => a.first_message_time.localeCompare(b.first_message_time));

      // 深夜消息
      let lateNightMsgs = 0;
      if (gs?.hourly_heatmap) {
        lateNightMsgs = gs.hourly_heatmap.slice(0, 5).reduce((a: number, b: number) => a + b, 0);
      }
      const lateNightTop = gs?.late_night_ranking?.slice(0, 3) ?? [];
      const totalContacts = cs.filter(c => c.total_messages > 0).length;

      setYearData({
        totalYearMsgs, monthlyMsgs, peakMonth, peakMonthCount, activeDays,
        yearContacts, newFriends, lateNightMsgs, lateNightTop, totalContacts,
      });
    }).catch(() => {}).finally(() => setYearLoading(false));
  }, [selectedYear]);

  // 卡片内容
  const cards = useMemo(() => {
    const result: { title: string; icon: React.ReactNode; bg: string; content: React.ReactNode }[] = [];
    if (!yearData) return result;
    const y = yearData!;

    // 1. 封面
    result.push({
      title: '',
      icon: null,
      bg: 'from-[#07c160] to-[#06ad56]',
      content: (
        <div className="flex flex-col items-center justify-center h-full gap-6 text-white">
          <div className="text-6xl font-black">{selectedYear}</div>
          <div className="text-2xl font-bold">年度社交回顾</div>
          <div className="text-sm opacity-70">WeLink · 微信聊天数据分析</div>
        </div>
      ),
    });

    // 2. 总览
    result.push({
      title: '这一年的数字',
      icon: <Calendar size={20} />,
      bg: 'from-[#10aeff] to-[#0e8dd6]',
      content: (
        <div className="grid grid-cols-3 gap-4 text-center text-white">
          <div>
            <div className="text-3xl font-black">{y.totalYearMsgs.toLocaleString()}</div>
            <div className="text-xs opacity-70 mt-1">条消息</div>
          </div>
          <div>
            <div className="text-3xl font-black">{y.totalContacts}</div>
            <div className="text-xs opacity-70 mt-1">位联系人</div>
          </div>
          <div>
            <div className="text-3xl font-black">{y.activeDays}</div>
            <div className="text-xs opacity-70 mt-1">活跃天数</div>
          </div>
        </div>
      ),
    });

    // 3. Top 5
    if (y.yearContacts.length > 0) {
      result.push({
        title: '聊得最多的人',
        icon: <Heart size={20} />,
        bg: 'from-[#fa5151] to-[#e04040]',
        content: (
          <div className="space-y-3 text-white">
            {y.yearContacts.map((c, i) => (
              <div key={c.username} className="flex items-center gap-3">
                <span className="text-2xl font-black opacity-60 w-8">{i + 1}</span>
                <div className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0 ring-2 ring-white/30">
                  {c.small_head_url ? (
                    <img loading="lazy" src={avatarSrc(c.small_head_url)} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-white/20 flex items-center justify-center text-sm font-bold">
                      {displayName(c).charAt(0)}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`font-bold truncate ${privacyMode ? 'blur-sm' : ''}`}>{displayName(c)}</div>
                  <div className="text-xs opacity-60">{c.total_messages.toLocaleString()} 条消息</div>
                </div>
              </div>
            ))}
          </div>
        ),
      });
    }

    // 4. 最活跃月份
    if (y.peakMonth) {
      const monthNum = parseInt(y.peakMonth.slice(5));
      result.push({
        title: '最活跃的月份',
        icon: <Sparkles size={20} />,
        bg: 'from-[#ff9500] to-[#e08500]',
        content: (
          <div className="flex flex-col items-center gap-4 text-white">
            <div className="text-6xl font-black">{monthNum}月</div>
            <div className="text-lg font-bold">{y.peakMonthCount.toLocaleString()} 条消息</div>
            <div className="text-sm opacity-60">这是你全年最活跃的月份</div>
            {/* 月度柱状图 */}
            <div className="flex items-end gap-1 h-16 w-full max-w-xs">
              {Array.from({ length: 12 }, (_, i) => {
                const m = `${selectedYear}-${String(i + 1).padStart(2, '0')}`;
                const count = y.monthlyMsgs[m] ?? 0;
                const pct = y.peakMonthCount > 0 ? (count / y.peakMonthCount) * 100 : 0;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                    <div
                      className={`w-full rounded-t-sm ${m === y.peakMonth ? 'bg-white' : 'bg-white/40'}`}
                      style={{ height: `${Math.max(pct, 3)}%` }}
                    />
                    <span className="text-[8px] opacity-50">{i + 1}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ),
      });
    }

    // 5. 深夜
    if (y.lateNightMsgs > 0) {
      result.push({
        title: '深夜时光',
        icon: <Moon size={20} />,
        bg: 'from-[#1a1a2e] to-[#16213e]',
        content: (
          <div className="text-white space-y-4">
            <div className="text-center">
              <div className="text-4xl font-black">{y.lateNightMsgs.toLocaleString()}</div>
              <div className="text-sm opacity-60 mt-1">条深夜消息（0-5 点）</div>
            </div>
            {y.lateNightTop.length > 0 && (
              <div>
                <div className="text-xs opacity-50 mb-2">陪你熬夜的人</div>
                <div className="space-y-2">
                  {y.lateNightTop.map((e, i) => (
                    <div key={e.name} className="flex items-center gap-2 text-sm">
                      <span className="opacity-40">{i + 1}.</span>
                      <span className={`font-bold ${privacyMode ? 'blur-sm' : ''}`}>{e.name}</span>
                      <span className="opacity-40 ml-auto">{e.late_night_count} 条</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ),
      });
    }

    // 6. 新朋友
    if (y.newFriends.length > 0) {
      result.push({
        title: '新认识的人',
        icon: <Users size={20} />,
        bg: 'from-[#576b95] to-[#3d4f77]',
        content: (
          <div className="text-white space-y-3">
            <div className="text-center text-3xl font-black">{y.newFriends.length} 位</div>
            <div className="flex flex-wrap justify-center gap-2">
              {y.newFriends.slice(0, 12).map(c => (
                <div key={c.username} className="flex flex-col items-center gap-1">
                  <div className="w-10 h-10 rounded-full overflow-hidden ring-2 ring-white/20">
                    {c.small_head_url ? (
                      <img loading="lazy" src={avatarSrc(c.small_head_url)} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-white/20 flex items-center justify-center text-xs font-bold">
                        {displayName(c).charAt(0)}
                      </div>
                    )}
                  </div>
                  <span className={`text-[9px] opacity-60 max-w-[48px] truncate ${privacyMode ? 'blur-sm' : ''}`}>
                    {displayName(c)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ),
      });
    }

    // 7. 尾页
    result.push({
      title: '',
      icon: null,
      bg: 'from-[#07c160] to-[#06ad56]',
      content: (
        <div className="flex flex-col items-center justify-center h-full gap-4 text-white">
          <div className="text-xl font-bold">感谢每一段对话</div>
          <div className="text-sm opacity-70">{selectedYear} 年，你的社交世界精彩纷呈</div>
          <div className="mt-4 text-xs opacity-50">WeLink · welink.click</div>
        </div>
      ),
    });

    return result;
  }, [yearData, selectedYear, privacyMode]);

  const handleShare = useCallback(async () => {
    if (sharing || !yearData) return;
    setSharing(true);
    try {
      const yd = yearData;
      const S = 2; // @2x
      const W = 440;
      const FONT = "system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif";

      // 预加载 Top 5 头像
      const avatarImgs: (HTMLImageElement | null)[] = [];
      await Promise.all(yd.yearContacts.slice(0, 5).map((c, i) => {
        return new Promise<void>(resolve => {
          const url = avatarSrc(c.small_head_url || c.big_head_url);
          if (!url) { avatarImgs[i] = null; resolve(); return; }
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => { avatarImgs[i] = img; resolve(); };
          img.onerror = () => { avatarImgs[i] = null; resolve(); };
          img.src = url;
          setTimeout(() => { avatarImgs[i] = avatarImgs[i] ?? null; resolve(); }, 3000);
        });
      }));

      // 计算总高度
      let totalH = 0;
      totalH += 140; // 封面
      totalH += 120; // 总览
      totalH += Math.min(yd.yearContacts.length, 5) * 52 + 50; // Top 5
      if (yd.peakMonth) totalH += 130; // 最活跃月
      if (yd.lateNightMsgs > 0) totalH += 120; // 深夜
      if (yd.newFriends.length > 0) totalH += 80; // 新朋友
      totalH += 100; // 尾页 + footer

      const cvs = document.createElement('canvas');
      cvs.width = W * S;
      cvs.height = totalH * S;
      const ctx = cvs.getContext('2d')!;

      // WeLink 绿色渐变背景
      const bgGrad = ctx.createLinearGradient(0, 0, 0, totalH * S);
      bgGrad.addColorStop(0, '#07c160');
      bgGrad.addColorStop(0.5, '#06ad56');
      bgGrad.addColorStop(1, '#048a3e');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W * S, totalH * S);

      // 半透明覆盖层
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.fillRect(0, 0, W * S, totalH * S);

      let curY = 0;

      // ── 封面 ──
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.font = `900 ${48*S}px ${FONT}`;
      ctx.fillText(String(selectedYear), (W/2)*S, (curY + 50)*S);
      ctx.font = `700 ${18*S}px ${FONT}`;
      ctx.fillText('年度社交回顾', (W/2)*S, (curY + 90)*S);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = `${11*S}px ${FONT}`;
      ctx.fillText('WeLink · 微信聊天数据分析', (W/2)*S, (curY + 120)*S);
      curY += 140;

      // ── 总览 ──
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      const rr = (x: number, yy: number, w: number, h: number, r: number) => {
        ctx.beginPath();
        ctx.moveTo(x+r, yy); ctx.lineTo(x+w-r, yy); ctx.arcTo(x+w, yy, x+w, yy+r, r);
        ctx.lineTo(x+w, yy+h-r); ctx.arcTo(x+w, yy+h, x+w-r, yy+h, r);
        ctx.lineTo(x+r, yy+h); ctx.arcTo(x, yy+h, x, yy+h-r, r);
        ctx.lineTo(x, yy+r); ctx.arcTo(x, yy, x+r, yy, r);
        ctx.closePath();
      };
      rr(24*S, curY*S, (W-48)*S, 80*S, 12*S);
      ctx.fill();

      const stats3 = [
        { val: yd.totalYearMsgs.toLocaleString(), label: '条消息' },
        { val: String(yd.totalContacts), label: '位联系人' },
        { val: String(yd.activeDays), label: '活跃天数' },
      ];
      stats3.forEach((s, i) => {
        const cx = (24 + (W-48)/3 * (i+0.5));
        ctx.fillStyle = '#ffffff';
        ctx.font = `900 ${22*S}px ${FONT}`;
        ctx.fillText(s.val, cx*S, (curY + 30)*S);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = `${10*S}px ${FONT}`;
        ctx.fillText(s.label, cx*S, (curY + 55)*S);
      });
      curY += 100;

      // ── Top 5 ──
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = `700 ${12*S}px ${FONT}`;
      ctx.fillText('♥  聊得最多的人', 30*S, (curY + 10)*S);
      curY += 30;
      const avatarSize = 32;
      for (let i = 0; i < Math.min(yd.yearContacts.length, 5); i++) {
        const c = yd.yearContacts[i];
        const name = privacyMode ? '***' : displayName(c);
        // 排名
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = `900 ${20*S}px ${FONT}`;
        ctx.fillText(String(i + 1), 30*S, (curY + 26)*S);
        // 头像（圆形裁切）
        const avX = 60; const avY = curY + 6;
        ctx.save();
        ctx.beginPath();
        ctx.arc((avX + avatarSize/2)*S, (avY + avatarSize/2)*S, (avatarSize/2)*S, 0, Math.PI * 2);
        ctx.clip();
        if (avatarImgs[i]) {
          ctx.drawImage(avatarImgs[i]!, avX*S, avY*S, avatarSize*S, avatarSize*S);
        } else {
          // 无头像时画绿色圆 + 首字母
          ctx.fillStyle = 'rgba(255,255,255,0.2)';
          ctx.fillRect(avX*S, avY*S, avatarSize*S, avatarSize*S);
          ctx.fillStyle = '#ffffff';
          ctx.font = `700 ${14*S}px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(name.charAt(0), (avX + avatarSize/2)*S, (avY + avatarSize/2)*S);
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
        }
        ctx.restore();
        // 名字 + 消息数
        const textX = avX + avatarSize + 10;
        ctx.fillStyle = '#ffffff';
        ctx.font = `700 ${15*S}px ${FONT}`;
        ctx.fillText(name, textX*S, (curY + 18)*S);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = `${11*S}px ${FONT}`;
        ctx.fillText(`${c.total_messages.toLocaleString()} 条消息`, textX*S, (curY + 36)*S);
        curY += 52;
      }
      curY += 10;

      // ── 最活跃月份 ──
      if (yd.peakMonth) {
        const monthNum = parseInt(yd.peakMonth.slice(5));
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.font = `900 ${36*S}px ${FONT}`;
        ctx.fillText(`${monthNum}月`, (W/2)*S, (curY + 30)*S);
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = `${12*S}px ${FONT}`;
        ctx.fillText(`${yd.peakMonthCount.toLocaleString()} 条消息 · 全年最活跃`, (W/2)*S, (curY + 55)*S);

        // 迷你月度柱状图
        const barW = ((W - 80) / 12);
        for (let i = 0; i < 12; i++) {
          const m = `${selectedYear}-${String(i + 1).padStart(2, '0')}`;
          const count = yd.monthlyMsgs[m] ?? 0;
          const pct = yd.peakMonthCount > 0 ? count / yd.peakMonthCount : 0;
          const barH = Math.max(pct * 40, 2);
          const bx = 40 + i * barW;
          ctx.fillStyle = m === yd.peakMonth ? '#ffffff' : 'rgba(255,255,255,0.3)';
          ctx.fillRect(bx*S, (curY + 100 - barH)*S, (barW - 2)*S, barH*S);
        }
        curY += 130;
      }

      // ── 深夜 ──
      if (yd.lateNightMsgs > 0) {
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.font = `900 ${28*S}px ${FONT}`;
        ctx.fillText(`${yd.lateNightMsgs.toLocaleString()}`, (W/2)*S, (curY + 30)*S);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = `${11*S}px ${FONT}`;
        ctx.fillText('条深夜消息（0-5 点）', (W/2)*S, (curY + 55)*S);
        if (yd.lateNightTop.length > 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.4)';
          ctx.font = `${10*S}px ${FONT}`;
          const names = yd.lateNightTop.map(e => privacyMode ? '***' : e.name).join('、');
          ctx.fillText(`陪你熬夜的人：${names}`, (W/2)*S, (curY + 80)*S);
        }
        curY += 120;
      }

      // ── 新朋友 ──
      if (yd.newFriends.length > 0) {
        ctx.fillStyle = '#ffffff';
        ctx.font = `900 ${24*S}px ${FONT}`;
        ctx.fillText(`${yd.newFriends.length} 位新朋友`, (W/2)*S, (curY + 30)*S);
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = `${10*S}px ${FONT}`;
        ctx.fillText(`今年新认识的人`, (W/2)*S, (curY + 55)*S);
        curY += 80;
      }

      // ── 尾页 ──
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = `700 ${14*S}px ${FONT}`;
      ctx.fillText('感谢每一段对话', (W/2)*S, (curY + 20)*S);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = `${10*S}px ${FONT}`;
      ctx.fillText('WeLink · welink.click', (W/2)*S, (curY + 45)*S);

      // 生成 QR 码
      const doSave = async (canvas: HTMLCanvasElement) => {
        const dataUrl = canvas.toDataURL('image/png');
        const path = await downloadPng(dataUrl, `welink-${selectedYear}-review.png`);
        if (path) setSavedPath(path);
        setShared(true);
        setTimeout(() => setShared(false), 4000);
        setSharing(false);
      };
      try {
        const qrDataUrl = await QRCode.toDataURL('https://welink.click', { width: 64, margin: 1, color: { dark: '#ffffff', light: '#00000000' } });
        const qrImg = new Image();
        qrImg.onload = () => {
          ctx.drawImage(qrImg, ((W-32)/2)*S, (curY + 55)*S, 32*S, 32*S);
          doSave(cvs);
        };
        qrImg.src = qrDataUrl;
      } catch {
        doSave(cvs);
      }
    } catch (e) {
      console.error(e);
      setSharing(false);
    }
  }, [sharing, selectedYear, yearData, privacyMode]);

  const totalPages = cards.length;
  const card = cards[page];

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="relative w-full max-w-md" onClick={e => e.stopPropagation()}>
        {/* 关闭 */}
        <button onClick={onClose} className="absolute -top-10 right-0 text-white/60 hover:text-white">
          <X size={24} />
        </button>

        {/* 年份选择 */}
        <div className="flex justify-center gap-2 mb-4">
          {years.map(y => (
            <button
              key={y}
              onClick={() => { setSelectedYear(y); setPage(0); }}
              className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
                selectedYear === y ? 'bg-white text-[#1d1d1f]' : 'text-white/50 hover:text-white/80'
              }`}
            >
              {y}
            </button>
          ))}
        </div>

        {/* 卡片 */}
        {yearLoading || !card ? (
          <div className="bg-gradient-to-br from-[#07c160] to-[#06ad56] rounded-3xl p-8 min-h-[420px] flex flex-col items-center justify-center shadow-2xl">
            <Loader2 size={32} className="animate-spin text-white/60 mb-3" />
            <div className="text-white/60 text-sm">正在统计 {selectedYear} 年数据…</div>
            <div className="text-white/40 text-xs mt-1">消息量越大，统计时间越长</div>
          </div>
        ) : (
        <div
          ref={cardRef}
          className={`bg-gradient-to-br ${card.bg} rounded-3xl p-8 min-h-[420px] flex flex-col justify-center shadow-2xl transition-all duration-300`}
        >
          {card.title && (
            <div className="flex items-center gap-2 text-white/80 mb-6">
              {card.icon}
              <span className="text-sm font-bold uppercase tracking-wider">{card.title}</span>
            </div>
          )}
          {card.content}
        </div>
        )}

        {/* 导航 */}
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="text-white/50 hover:text-white disabled:opacity-20 transition-colors"
          >
            <ChevronLeft size={28} />
          </button>

          {/* 页码指示器 */}
          <div className="flex gap-1.5">
            {cards.map((_, i) => (
              <button
                key={i}
                onClick={() => setPage(i)}
                className={`w-2 h-2 rounded-full transition-all ${
                  i === page ? 'bg-white w-6' : 'bg-white/30 hover:bg-white/50'
                }`}
              />
            ))}
          </div>

          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page === totalPages - 1}
            className="text-white/50 hover:text-white disabled:opacity-20 transition-colors"
          >
            <ChevronRight size={28} />
          </button>
        </div>

        {/* 分享按钮 + 路径提示 */}
        <div className="flex flex-col items-center gap-2 mt-4">
          <button
            onClick={() => { setSavedPath(null); handleShare(); }}
            disabled={sharing}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 text-white/70 hover:bg-white/20 hover:text-white text-xs font-bold transition-all"
          >
            {sharing ? <Loader2 size={14} className="animate-spin" /> : shared ? <Check size={14} /> : <Share2 size={14} />}
            {shared ? '已保存' : '保存为图片'}
          </button>
          {savedPath && (
            <div className="text-[10px] text-white/50 text-center max-w-xs break-all select-all">
              已保存到：{savedPath}
              <RevealLink path={savedPath} className="ml-2 text-white" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
