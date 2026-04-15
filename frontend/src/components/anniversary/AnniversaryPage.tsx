/**
 * 纪念日 & 提醒页面
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Heart, Cake, Target, Plus, X, Loader2, Calendar, Trash2, RotateCw } from 'lucide-react';
import type { ContactStats, DetectedEvent, FriendMilestone, CustomAnniversary, AnniversaryResponse } from '../../types';
import { anniversaryApi } from '../../services/api';
import { usePrivacyMode } from '../../contexts/PrivacyModeContext';
import { avatarSrc } from '../../utils/avatar';

interface Props {
  contacts: ContactStats[];
  onContactClick?: (contact: ContactStats) => void;
}

const milestoneLabel = (days: number): string => {
  if (days >= 365) {
    const y = days / 365;
    return Number.isInteger(y) ? `${y} 年` : `${y.toFixed(1)} 年`;
  }
  return `${days} 天`;
};

const daysUntilMMDD = (mmdd: string): number => {
  const now = new Date();
  const [m, d] = mmdd.split('-').map(Number);
  let target = new Date(now.getFullYear(), m - 1, d);
  if (target < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
    target = new Date(now.getFullYear() + 1, m - 1, d);
  }
  return Math.ceil((target.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000);
};

const daysUntilDate = (dateStr: string, recurring: boolean): number => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (recurring) {
    const [, m, d] = dateStr.split('-').map(Number);
    let target = new Date(now.getFullYear(), m - 1, d);
    if (target < today) target = new Date(now.getFullYear() + 1, m - 1, d);
    return Math.ceil((target.getTime() - today.getTime()) / 86400000);
  }
  const target = new Date(dateStr);
  return Math.ceil((target.getTime() - today.getTime()) / 86400000);
};

export const AnniversaryPage: React.FC<Props> = ({ contacts, onContactClick }) => {
  const { privacyMode } = usePrivacyMode();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AnniversaryResponse | null>(null);
  const [custom, setCustom] = useState<CustomAnniversary[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newRecurring, setNewRecurring] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await anniversaryApi.getAll();
      setData(resp);
      setCustom(resp.custom || []);
    } catch {
      // ignore
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const handleAdd = async () => {
    if (!newTitle.trim() || !newDate) return;
    const entry: CustomAnniversary = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: newTitle.trim(),
      date: newDate,
      recurring: newRecurring,
    };
    const updated = [...custom, entry];
    setCustom(updated);
    setShowAdd(false);
    setNewTitle('');
    setNewDate('');
    setNewRecurring(true);
    await anniversaryApi.saveCustom(updated);
  };

  const handleDelete = async (id: string) => {
    const updated = custom.filter(c => c.id !== id);
    setCustom(updated);
    await anniversaryApi.saveCustom(updated);
  };

  const handleContactClick = (username: string) => {
    const c = contacts.find(ct => ct.username === username);
    if (c && onContactClick) onContactClick(c);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <Loader2 size={40} className="text-[#07c160] animate-spin" />
        <div className="text-center">
          <p className="text-sm font-semibold text-gray-500 dk-text">正在检测纪念日...</p>
          <p className="text-xs text-gray-400 mt-1">首次加载需要扫描聊天记录，请稍候</p>
        </div>
      </div>
    );
  }

  // 过滤掉被屏蔽的联系人（contacts 已经过屏蔽过滤）
  const allowedUsernames = new Set(contacts.map(c => c.username));
  const detected = (data?.detected || []).filter((e: { username: string }) => allowedUsernames.has(e.username));
  const milestones = (data?.milestones || []).filter((m: { username: string }) => allowedUsernames.has(m.username));

  // 构建"即将到来"的合并时间线
  type UpcomingItem = { type: string; title: string; subtitle: string; daysUntil: number; avatar?: string; username?: string };
  const upcoming: UpcomingItem[] = [];

  detected.forEach(e => {
    const days = daysUntilMMDD(e.date);
    upcoming.push({
      type: 'birthday',
      title: `${e.display_name} 的生日`,
      subtitle: `${e.date}${e.years.length > 1 ? ` (${e.years.length} 年记录)` : ''}`,
      daysUntil: days,
      avatar: e.avatar_url,
      username: e.username,
    });
  });

  milestones.forEach(m => {
    upcoming.push({
      type: 'milestone',
      title: `与 ${m.display_name} 相识 ${milestoneLabel(m.next_milestone)}`,
      subtitle: `已认识 ${m.days_known} 天`,
      daysUntil: m.days_until,
      avatar: m.avatar_url,
      username: m.username,
    });
  });

  custom.forEach(c => {
    const days = daysUntilDate(c.date, c.recurring);
    if (days >= 0) {
      upcoming.push({
        type: 'custom',
        title: c.title,
        subtitle: c.recurring ? `每年 ${c.date.slice(5)}` : c.date,
        daysUntil: days,
      });
    }
  });

  upcoming.sort((a, b) => a.daysUntil - b.daysUntil);

  const daysLabel = (d: number) => {
    if (d === 0) return '今天';
    if (d === 1) return '明天';
    if (d === 2) return '后天';
    return `${d} 天后`;
  };

  const daysColor = (d: number) => {
    if (d === 0) return 'bg-[#fa5151] text-white';
    if (d <= 3) return 'bg-[#ff9500] text-white';
    if (d <= 7) return 'bg-[#10aeff] text-white';
    return 'bg-gray-100 text-gray-500 dark:bg-white/10 dk-text';
  };

  const typeIcon = (t: string) => {
    if (t === 'birthday') return <Cake size={14} className="text-[#fa5151]" />;
    if (t === 'milestone') return <Target size={14} className="text-[#10aeff]" />;
    return <Heart size={14} className="text-[#ff9500]" />;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="dk-text text-3xl sm:text-5xl font-black tracking-tight text-[#1d1d1f] mb-1">纪念日</h1>
          <p className="text-gray-400 text-sm">自动检测生日、友谊里程碑，记录重要时刻</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetch}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-2xl text-sm font-bold text-gray-500 bg-gray-100 hover:bg-gray-200 dark:bg-white/10 dark:hover:bg-white/15 transition-colors"
          >
            <RotateCw size={14} /> 刷新
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-2xl text-sm font-bold text-white bg-[#07c160] hover:bg-[#06ad56] transition-colors"
          >
            <Plus size={14} /> 添加纪念日
          </button>
        </div>
      </div>

      {/* 即将到来 */}
      {upcoming.length > 0 && (
        <div className="dk-card bg-white dk-border border border-gray-100 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 dk-border">
            <div className="flex items-center gap-2">
              <Calendar size={16} className="text-[#07c160]" />
              <span className="text-sm font-bold text-[#1d1d1f] dk-text">即将到来</span>
              <span className="text-xs text-gray-400 ml-1">{upcoming.length} 个事件</span>
            </div>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-white/5">
            {upcoming.slice(0, 15).map((item, i) => (
              <div
                key={i}
                className={`flex items-center gap-3 px-5 py-3.5 ${item.username ? 'cursor-pointer hover:bg-[#f8f9fb] dark:hover:bg-white/5' : ''} transition-colors`}
                onClick={() => item.username && handleContactClick(item.username)}
              >
                <span className={`flex-shrink-0 px-2 py-1 rounded-lg text-[10px] font-bold min-w-[52px] text-center ${daysColor(item.daysUntil)}`}>
                  {daysLabel(item.daysUntil)}
                </span>
                {item.avatar ? (
                  <img loading="lazy" src={avatarSrc(item.avatar)} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#ff9500] to-[#fa5151] flex items-center justify-center text-white flex-shrink-0">
                    {typeIcon(item.type)}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-bold text-[#1d1d1f] dk-text truncate${privacyMode ? ' privacy-blur' : ''}`}>
                    {item.title}
                  </div>
                  <div className={`text-xs text-gray-400 mt-0.5${privacyMode ? ' privacy-blur' : ''}`}>{item.subtitle}</div>
                </div>
                <span className="flex-shrink-0">{typeIcon(item.type)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* 检测到的生日 */}
        <div className="dk-card bg-white dk-border border border-gray-100 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 dk-border">
            <div className="flex items-center gap-2">
              <Cake size={16} className="text-[#fa5151]" />
              <span className="text-sm font-bold text-[#1d1d1f] dk-text">检测到的生日</span>
              <span className="text-xs text-gray-400 ml-1">{detected.length} 个</span>
            </div>
          </div>
          {detected.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-gray-300">
              未检测到生日消息
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-white/5 max-h-80 overflow-y-auto">
              {detected.map((e, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-[#f8f9fb] dark:hover:bg-white/5 transition-colors"
                  onClick={() => handleContactClick(e.username)}
                >
                  {e.avatar_url ? (
                    <img loading="lazy" src={avatarSrc(e.avatar_url)} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-pink-50 flex items-center justify-center flex-shrink-0">
                      <Cake size={14} className="text-[#fa5151]" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-bold text-[#1d1d1f] dk-text truncate${privacyMode ? ' privacy-blur' : ''}`}>
                      {e.display_name}
                    </div>
                    <div className={`text-xs text-gray-400 mt-0.5 truncate${privacyMode ? ' privacy-blur' : ''}`}>
                      {e.evidence}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-bold text-[#fa5151]">{e.date}</div>
                    <div className="text-[10px] text-gray-300">{e.years.length} 次记录</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 友谊里程碑 */}
        <div className="dk-card bg-white dk-border border border-gray-100 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 dk-border">
            <div className="flex items-center gap-2">
              <Target size={16} className="text-[#10aeff]" />
              <span className="text-sm font-bold text-[#1d1d1f] dk-text">友谊里程碑</span>
              <span className="text-xs text-gray-400 ml-1">60 天内</span>
            </div>
          </div>
          {milestones.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-gray-300">
              近期没有即将达成的里程碑
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-white/5 max-h-80 overflow-y-auto">
              {milestones.map((m, i) => {
                const progress = (m.days_known / m.next_milestone) * 100;
                return (
                  <div
                    key={i}
                    className="px-5 py-3 cursor-pointer hover:bg-[#f8f9fb] dark:hover:bg-white/5 transition-colors"
                    onClick={() => handleContactClick(m.username)}
                  >
                    <div className="flex items-center gap-3">
                      {m.avatar_url ? (
                        <img loading="lazy" src={avatarSrc(m.avatar_url)} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center flex-shrink-0">
                          <Target size={14} className="text-[#10aeff]" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm font-bold text-[#1d1d1f] dk-text truncate${privacyMode ? ' privacy-blur' : ''}`}>
                          {m.display_name}
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          已认识 {m.days_known} 天 · 目标 {milestoneLabel(m.next_milestone)}
                        </div>
                      </div>
                      <span className={`flex-shrink-0 px-2 py-1 rounded-lg text-[10px] font-bold ${daysColor(m.days_until)}`}>
                        {daysLabel(m.days_until)}
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 bg-gray-100 dark:bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.min(100, progress)}%`,
                          background: 'linear-gradient(90deg, #10aeff, #07c160)',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 自定义纪念日 */}
      <div className="dk-card bg-white dk-border border border-gray-100 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 dk-border">
          <div className="flex items-center gap-2">
            <Heart size={16} className="text-[#ff9500]" />
            <span className="text-sm font-bold text-[#1d1d1f] dk-text">自定义纪念日</span>
          </div>
        </div>
        {custom.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm text-gray-300 mb-3">还没有自定义纪念日</p>
            <button
              onClick={() => setShowAdd(true)}
              className="text-sm font-bold text-[#07c160] hover:underline"
            >
              + 添加一个
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-white/5">
            {custom.map(c => {
              const days = daysUntilDate(c.date, c.recurring);
              return (
                <div key={c.id} className="flex items-center gap-3 px-5 py-3.5">
                  <div className="w-8 h-8 rounded-full bg-orange-50 dark:bg-orange-500/15 flex items-center justify-center flex-shrink-0">
                    <Heart size={14} className="text-[#ff9500]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-[#1d1d1f] dk-text truncate">{c.title}</div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {c.date} {c.recurring && '· 每年重复'}
                    </div>
                  </div>
                  {days >= 0 && (
                    <span className={`flex-shrink-0 px-2 py-1 rounded-lg text-[10px] font-bold ${daysColor(days)}`}>
                      {daysLabel(days)}
                    </span>
                  )}
                  <button
                    onClick={() => handleDelete(c.id)}
                    className="flex-shrink-0 p-1.5 rounded-lg text-gray-300 hover:text-[#fa5151] hover:bg-red-50 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 添加纪念日弹窗 */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => setShowAdd(false)}>
          <div className="bg-white dark:bg-[#1d1d1f] rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold text-[#1d1d1f] dk-text">添加纪念日</h3>
              <button onClick={() => setShowAdd(false)} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1.5">标题</label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  placeholder="例如：结婚纪念日"
                  className="dk-input w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#07c160]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1.5">日期</label>
                <input
                  type="date"
                  value={newDate}
                  onChange={e => setNewDate(e.target.value)}
                  className="dk-input w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#07c160]"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newRecurring}
                  onChange={e => setNewRecurring(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-[#07c160] focus:ring-[#07c160]"
                />
                <span className="text-sm text-gray-600 dk-text">每年重复</span>
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowAdd(false)}
                className="px-4 py-2 rounded-xl text-sm font-bold text-gray-500 hover:bg-gray-100 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleAdd}
                disabled={!newTitle.trim() || !newDate}
                className="px-5 py-2 rounded-xl text-sm font-bold text-white bg-[#07c160] hover:bg-[#06ad56] disabled:opacity-40 transition-colors"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
