import React from 'react';
import { ShieldOff, User, Users } from 'lucide-react';
import { TagList, AddInput } from '../shared';
import type { ContactStats, GroupInfo } from '../../../types';

export const BlockedSection: React.FC<{
  blockedUsers: string[];
  blockedGroups: string[];
  onAddBlockedUser: (v: string) => void;
  onRemoveBlockedUser: (v: string) => void;
  onAddBlockedGroup: (v: string) => void;
  onRemoveBlockedGroup: (v: string) => void;
  allContacts?: ContactStats[];
  allGroups?: GroupInfo[];
  privacyMode?: boolean;
}> = ({
  blockedUsers, blockedGroups,
  onAddBlockedUser, onRemoveBlockedUser, onAddBlockedGroup, onRemoveBlockedGroup,
  allContacts = [], allGroups = [], privacyMode = false,
}) => {
  const userLabelFor = (id: string): string => {
    const c = allContacts.find((c) => c.username === id || c.nickname === id || c.remark === id);
    return c ? (c.remark || c.nickname || id) : id;
  };
  const groupLabelFor = (id: string): string => {
    const g = allGroups.find((g) => g.username === id || g.name === id);
    return g ? g.name : id;
  };

  return (
    <section className="mb-8" data-section-id="blocked" data-settings-tags="隐私 屏蔽 blocked 黑名单 mask privacy">
      <div className="flex items-center gap-2 mb-3">
        <ShieldOff size={18} className="text-[#07c160]" />
        <h3 className="text-base font-bold text-[#1d1d1f] dk-text">隐私屏蔽</h3>
      </div>
      <p className="text-sm text-gray-400 mb-4">被屏蔽的联系人和群聊将从所有列表中隐藏，数据仍保留在数据库中。</p>

      <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-4 dk-card dk-border">
        <div className="flex items-center gap-2 mb-4">
          <User size={16} className="text-[#07c160]" />
          <h4 className="font-bold text-[#1d1d1f] dk-text">屏蔽联系人</h4>
          {blockedUsers.length > 0 && (
            <>
              <span className="ml-auto text-xs font-bold px-2.5 py-1 rounded-full bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400">
                {blockedUsers.length} 条
              </span>
              <button
                onClick={() => {
                  if (confirm(`确定清空全部 ${blockedUsers.length} 个屏蔽联系人？`)) {
                    blockedUsers.forEach(u => onRemoveBlockedUser(u));
                  }
                }}
                className="text-xs text-gray-400 hover:text-red-500 transition-colors"
              >
                清空
              </button>
            </>
          )}
        </div>
        <TagList items={blockedUsers} onRemove={onRemoveBlockedUser} emptyText="暂无屏蔽联系人" labelFor={userLabelFor} privacyMode={privacyMode} />
        <AddInput placeholder="输入微信ID、昵称或备注名，按回车添加" onAdd={onAddBlockedUser} />
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-6 dk-card dk-border">
        <div className="flex items-center gap-2 mb-4">
          <Users size={16} className="text-[#07c160]" />
          <h4 className="font-bold text-[#1d1d1f] dk-text">屏蔽群聊</h4>
          {blockedGroups.length > 0 && (
            <>
              <span className="ml-auto text-xs font-bold px-2.5 py-1 rounded-full bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400">
                {blockedGroups.length} 条
              </span>
              <button
                onClick={() => {
                  if (confirm(`确定清空全部 ${blockedGroups.length} 个屏蔽群聊？`)) {
                    blockedGroups.forEach(g => onRemoveBlockedGroup(g));
                  }
                }}
                className="text-xs text-gray-400 hover:text-red-500 transition-colors"
              >
                清空
              </button>
            </>
          )}
        </div>
        <TagList items={blockedGroups} onRemove={onRemoveBlockedGroup} emptyText="暂无屏蔽群聊" labelFor={groupLabelFor} privacyMode={privacyMode} />
        <AddInput placeholder="输入群名称或群ID（以 @chatroom 结尾），按回车添加" onAdd={onAddBlockedGroup} />
      </div>
    </section>
  );
};
