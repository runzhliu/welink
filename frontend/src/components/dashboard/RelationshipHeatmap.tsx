/**
 * 关系热度图组件
 */

import React, { useMemo } from 'react';
import type { HealthStatus, ContactStats } from '../../types';

const MAX_AVATARS_MOBILE = 4;
const MAX_AVATARS_DESKTOP = 8;

interface RelationshipHeatmapProps {
  health: HealthStatus;
  totalContacts: number;
  contacts?: ContactStats[];
  onContactClick?: (contact: ContactStats) => void;
}

const Avatar: React.FC<{ contact: ContactStats; onClick?: () => void }> = ({ contact, onClick }) => {
  const name = contact.remark || contact.nickname || contact.username;
  const url = contact.small_head_url || contact.big_head_url;
  return (
    <button
      onClick={onClick}
      title={name}
      className="w-8 h-8 rounded-full ring-2 ring-white flex-shrink-0 overflow-hidden -ml-2 first:ml-0 hover:ring-[#07c160] hover:z-10 relative transition-all"
    >
      {url ? (
        <img loading="lazy" src={url} alt={name} className="w-full h-full object-cover"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      ) : (
        <div className="w-full h-full bg-gradient-to-br from-[#07c160] to-[#06ad56] flex items-center justify-center text-white text-xs font-black">
          {name.charAt(0)}
        </div>
      )}
    </button>
  );
};

const AvatarStack: React.FC<{
  contacts: ContactStats[];
  maxAvatars: number;
  onContactClick?: (c: ContactStats) => void;
}> = ({ contacts, maxAvatars, onContactClick }) => {
  if (contacts.length === 0) return null;
  const shown = contacts.slice(0, maxAvatars);
  const overflow = contacts.length - shown.length;
  return (
    <div className="flex items-center">
      {shown.map((c) => (
        <Avatar key={c.username} contact={c} onClick={() => onContactClick?.(c)} />
      ))}
      {overflow > 0 && (
        <div className="w-8 h-8 rounded-full ring-2 ring-white -ml-2 bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500 flex-shrink-0">
          +{overflow}
        </div>
      )}
    </div>
  );
};

export const RelationshipHeatmap: React.FC<RelationshipHeatmapProps> = ({
  health,
  totalContacts,
  contacts = [],
  onContactClick,
}) => {
  const getPercentage = (value: number) =>
    totalContacts > 0 ? ((value / totalContacts) * 100).toFixed(1) : '0.0';

  const maxAvatars = typeof window !== 'undefined' && window.innerWidth < 640
    ? MAX_AVATARS_MOBILE
    : MAX_AVATARS_DESKTOP;

  // 按档位分组联系人，仅展示有头像的（有消息的档位按最后消息时间排序）
  const tierContacts = useMemo(() => {
    const now = Date.now() / 1000;
    const withMsg = contacts.filter(c => c.total_messages > 0);
    const sorted = [...withMsg].sort(
      (a, b) => new Date(b.last_message_time).getTime() - new Date(a.last_message_time).getTime()
    );
    return {
      hot:     sorted.filter(c => (now - new Date(c.last_message_time).getTime() / 1000) / 86400 < 7),
      warm:    sorted.filter(c => { const d = (now - new Date(c.last_message_time).getTime() / 1000) / 86400; return d >= 7 && d < 30; }),
      cooling: sorted.filter(c => { const d = (now - new Date(c.last_message_time).getTime() / 1000) / 86400; return d >= 30 && d < 180; }),
      silent:  sorted.filter(c => (now - new Date(c.last_message_time).getTime() / 1000) / 86400 >= 180),
      cold:    contacts.filter(c => c.total_messages === 0),
    };
  }, [contacts]);

  const categories = [
    { label: '活跃',  value: health.hot,     color: 'bg-[#07c160]', textColor: 'text-[#07c160]', description: '7 天内有消息',    tier: tierContacts.hot },
    { label: '温热',  value: health.warm,    color: 'bg-[#9be94a]', textColor: 'text-[#7bc934]', description: '7–30 天未联系',   tier: tierContacts.warm },
    { label: '渐冷',  value: health.cooling, color: 'bg-[#ff9500]', textColor: 'text-[#ff9500]', description: '30–180 天未联系', tier: tierContacts.cooling },
    { label: '沉寂',  value: health.silent,  color: 'bg-[#576b95]', textColor: 'text-[#576b95]', description: '超过 180 天',     tier: tierContacts.silent },
    { label: '零消息', value: health.cold,   color: 'bg-gray-300',  textColor: 'text-gray-400',  description: '从未聊天',        tier: [] as ContactStats[] },
  ];

  return (
    <div className="dk-card bg-white dk-border p-6 sm:p-8 rounded-3xl border border-gray-100">
      <h3 className="dk-text text-xl font-black text-[#1d1d1f] mb-6">关系热度分布</h3>

      <div className="space-y-5">
        {categories.map((category) => (
          <div key={category.label}>
            <div className="flex items-center justify-between mb-2 gap-2">
              <div className="flex items-center gap-3 flex-shrink-0">
                <div className={`w-3 h-3 rounded-full flex-shrink-0 ${category.color}`} />
                <span className="font-bold text-sm text-gray-700">{category.label}</span>
                <span className="text-xs text-gray-400 font-medium hidden sm:inline">{category.description}</span>
              </div>
              <div className="flex items-center gap-3 min-w-0">
                <AvatarStack
                  contacts={category.tier}
                  maxAvatars={maxAvatars}
                  onContactClick={onContactClick}
                />
                <div className="flex items-baseline gap-1.5 flex-shrink-0">
                  <span className={`text-xl sm:text-2xl font-black ${category.textColor}`}>{category.value}</span>
                  <span className="text-xs font-semibold text-gray-400">{getPercentage(category.value)}%</span>
                </div>
              </div>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full ${category.color} transition-all duration-500 ease-out`}
                style={{ width: `${getPercentage(category.value)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
