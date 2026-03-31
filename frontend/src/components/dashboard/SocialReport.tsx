/**
 * 社交体检报告 — 从联系人统计数据生成一张可视化健康报告卡片，支持截图分享
 */

import { useMemo, useState, useCallback } from 'react';
import { Heart, Users, MessageCircle, Moon, TrendingUp, Share2, Check, Loader2 } from 'lucide-react';
import type { ContactStats, GlobalStats, HealthStatus } from '../../types';
import { avatarSrc } from '../../utils/avatar';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';
import { generateReportImage } from '../../utils/shareImage';

interface Props {
  contacts: ContactStats[];
  globalStats: GlobalStats | null;
  healthStatus: HealthStatus;
}

function contactName(c: ContactStats): string {
  return c.remark || c.nickname || c.username;
}

export default function SocialReport({ contacts, globalStats, healthStatus }: Props) {
  const { privacyMode } = usePrivacyMode();
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState(false);

  const totalContacts = useMemo(
    () => healthStatus.hot + healthStatus.warm + healthStatus.cooling + healthStatus.silent + healthStatus.cold,
    [healthStatus],
  );

  // ─── Social health score (0-100) ──────────────────────────────────
  const score = useMemo(() => {
    if (totalContacts === 0) return 0;
    const activeRatio = (healthStatus.hot + healthStatus.warm) / totalContacts;
    const volumeFactor = globalStats
      ? Math.min(globalStats.total_messages / 10000, 1)
      : 0;
    const diversityFactor = Math.min(contacts.filter(c => c.total_messages > 0).length / 30, 1);
    return Math.round(activeRatio * 40 + volumeFactor * 30 + diversityFactor * 30);
  }, [totalContacts, healthStatus, globalStats, contacts]);

  // ─── Most chatted month ───────────────────────────────────────────
  const bestMonth = useMemo(() => {
    if (!globalStats) return null;
    const entries = Object.entries(globalStats.monthly_trend);
    if (entries.length === 0) return null;
    const [month, count] = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
    return { month, count };
  }, [globalStats]);

  // ─── Night owl index ──────────────────────────────────────────────
  const nightOwl = useMemo(() => {
    if (!globalStats) return { count: 0, pct: 0 };
    const nightMsgs = globalStats.hourly_heatmap.slice(0, 5).reduce((a, b) => a + b, 0);
    const total = globalStats.total_messages || 1;
    return { count: nightMsgs, pct: Math.round((nightMsgs / total) * 100) };
  }, [globalStats]);

  // ─── Active percentage ────────────────────────────────────────────
  const activePct = useMemo(
    () => (totalContacts === 0 ? 0 : Math.round(((totalContacts - healthStatus.cold) / totalContacts) * 100)),
    [totalContacts, healthStatus],
  );

  // ─── Top contact ──────────────────────────────────────────────────
  const topContact = useMemo(() => {
    if (contacts.length === 0) return null;
    return contacts.reduce((a, b) => (b.total_messages > a.total_messages ? b : a));
  }, [contacts]);

  // ─── Highlights ───────────────────────────────────────────────────
  const highlights = useMemo(() => {
    const items: string[] = [];

    if (topContact) {
      const name = privacyMode ? '***' : contactName(topContact);
      items.push(`你和 ${name} 聊得最多，共 ${topContact.total_messages.toLocaleString()} 条消息`);
    }

    if (bestMonth) {
      items.push(`你最活跃的月份是 ${bestMonth.month}，发了 ${bestMonth.count.toLocaleString()} 条消息`);
    }

    if (globalStats && globalStats.zero_msg_friends > 0) {
      const pct = Math.round((globalStats.zero_msg_friends / globalStats.total_friends) * 100);
      items.push(`${pct}% 的好友从未聊过天`);
    }

    if (nightOwl.count > 0) {
      items.push(`深夜 0-5 点你发了约 ${nightOwl.count.toLocaleString()} 条消息`);
    }

    return items;
  }, [topContact, bestMonth, globalStats, nightOwl, privacyMode]);

  // ─── Score color ──────────────────────────────────────────────────
  const scoreColor = score >= 70 ? 'text-green-500' : score >= 40 ? 'text-yellow-500' : 'text-red-400';
  const scoreLabel = score >= 70 ? '社交达人' : score >= 40 ? '还不错' : '有点宅';

  // ─── Share as image (Canvas 2D, same header/footer as AI share) ──
  const handleShare = useCallback(async () => {
    if (sharing) return;
    setSharing(true);
    try {
      await generateReportImage({
        score,
        scoreLabel,
        stats: [
          { label: '好友数', value: String(globalStats?.total_friends ?? totalContacts) },
          { label: '活跃率', value: `${activePct}%` },
          { label: '最活跃月', value: bestMonth ? `${bestMonth.month.slice(0, 4)}年${parseInt(bestMonth.month.slice(5))}月` : '-' },
          { label: '夜猫指数', value: `${nightOwl.pct}%` },
        ],
        topContactName: topContact ? (privacyMode ? '***' : contactName(topContact)) : undefined,
        topContactAvatar: topContact?.small_head_url || topContact?.big_head_url,
        topContactMessages: topContact?.total_messages,
        highlights,
      });
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    } catch (e) {
      console.error('Share failed', e);
    } finally {
      setSharing(false);
    }
  }, [sharing, score, scoreLabel, globalStats, totalContacts, activePct, bestMonth, nightOwl, topContact, highlights, privacyMode]);

  return (
    <div className="relative">
      {/* Share button */}
      <button
        onClick={handleShare}
        disabled={sharing}
        className="absolute top-3 right-3 z-10 p-2 rounded-xl transition-all
          bg-white/80 dark:bg-black/30 backdrop-blur-sm
          text-gray-400 hover:text-[#07c160] hover:bg-white
          disabled:opacity-50"
        title="保存为图片"
      >
        {sharing ? (
          <Loader2 size={16} className="animate-spin" />
        ) : shared ? (
          <Check size={16} className="text-[#07c160]" />
        ) : (
          <Share2 size={16} />
        )}
      </button>

      <div className="dk-card bg-white dk-border border border-gray-100 rounded-2xl overflow-hidden">
        {/* Header */}
        <div
          className="px-5 py-4 flex items-center justify-between"
          style={{ background: 'linear-gradient(135deg, #07c160, #06ad56)' }}
        >
          <div className="flex items-center gap-2">
            <Heart className="w-5 h-5 text-white" />
            <span className="text-white font-bold text-base">社交体检报告</span>
          </div>
          <span className="text-white/70 text-xs">
            {new Date().getFullYear()}年{new Date().getMonth() + 1}月
          </span>
        </div>

        <div className="p-5 space-y-5">
          {/* Score */}
          <div className="flex flex-col items-center gap-1">
            <span className={`text-5xl font-black ${scoreColor}`}>{score}</span>
            <span className="text-xs text-gray-400">社交健康指数 · {scoreLabel}</span>
          </div>

          {/* Key Stats Row */}
          <div className="grid grid-cols-4 gap-2">
            <StatPill icon={<Users className="w-3.5 h-3.5" />} label="好友数" value={globalStats?.total_friends ?? totalContacts} />
            <StatPill icon={<TrendingUp className="w-3.5 h-3.5" />} label="活跃率" value={`${activePct}%`} />
            <StatPill icon={<MessageCircle className="w-3.5 h-3.5" />} label="最活跃月" value={bestMonth?.month.slice(5) ?? '-'} />
            <StatPill icon={<Moon className="w-3.5 h-3.5" />} label="夜猫指数" value={`${nightOwl.pct}%`} />
          </div>

          {/* Top contact avatar row */}
          {topContact && (
            <div className="flex items-center gap-3 p-3 rounded-xl bg-green-50 dark:bg-green-900/20">
              <div className="w-9 h-9 rounded-full overflow-hidden flex-shrink-0">
                {topContact.small_head_url ? (
                  <img
                    src={avatarSrc(topContact.small_head_url)}
                    alt=""
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-[#07c160] to-[#06ad56] flex items-center justify-center text-white text-xs font-bold">
                    {contactName(topContact).charAt(0)}
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <p className={`text-sm font-medium dk-text truncate${privacyMode ? ' privacy-blur' : ''}`}>
                  {contactName(topContact)}
                </p>
                <p className="text-xs text-gray-400">{topContact.total_messages.toLocaleString()} 条消息 · 最佳拍档</p>
              </div>
            </div>
          )}

          {/* Highlights */}
          {highlights.length > 0 && (
            <ul className="space-y-2">
              {highlights.map((text, i) => (
                <li key={i} className="flex items-start gap-2 text-sm dk-text">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#07c160]" />
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Footer watermark for share image */}
          <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-white/10">
            <span className="text-[10px] text-gray-300">WeLink · 微信聊天数据分析</span>
            <span className="text-[10px] text-gray-300">welink.click</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Mini stat pill ─────────────────────────────────────────────── */
function StatPill({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 p-2 rounded-xl bg-gray-50 dark:bg-gray-800/50">
      <span style={{ color: '#07c160' }}>{icon}</span>
      <span className="text-sm font-bold dk-text">{value}</span>
      <span className="text-[10px] text-gray-400">{label}</span>
    </div>
  );
}
