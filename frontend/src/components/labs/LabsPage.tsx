/**
 * 创意实验室 —— 尝试性功能的集合入口
 *
 * 当前只挂 AI 虚拟群聊一个；以后可以往里加更多"好玩但还没到 tab 级"
 * 的创意功能（AI 话术教练 / 声音克隆试玩 / 情绪年度曲线 / 等）。
 */

import React, { useState } from 'react';
import { FlaskConical, Users2 } from 'lucide-react';
import type { ContactStats } from '../../types';
import { VirtualGroupChat } from './VirtualGroupChat';

interface Props {
  contacts: ContactStats[];
}

type LabKey = 'virtual-group';

interface LabDef {
  key: LabKey;
  label: string;
  icon: React.ReactNode;
  badge?: string;
  desc: string;
}

const LABS: LabDef[] = [
  {
    key: 'virtual-group',
    label: 'AI 虚拟群聊',
    icon: <Users2 size={14} />,
    badge: 'NEW',
    desc: '把任意联系人拉到一个虚拟群，AI 扮演每个人互相聊天',
  },
];

export const LabsPage: React.FC<Props> = ({ contacts }) => {
  const [active, setActive] = useState<LabKey>('virtual-group');

  return (
    <div className="min-h-full">
      <div className="flex items-center gap-2 mb-5">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#07c160] to-[#10aeff] flex items-center justify-center shadow-sm">
          <FlaskConical size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-xl font-black text-[#1d1d1f] dark:text-gray-100">创意实验室</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">试验中的好玩功能 · 未完全稳定也欢迎玩</p>
        </div>
      </div>

      {/* Lab 选择条（单选，多了再改成 grid） */}
      <div className="flex flex-wrap gap-2 mb-4">
        {LABS.map(lab => (
          <button
            key={lab.key}
            onClick={() => setActive(lab.key)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
              active === lab.key
                ? 'bg-gradient-to-r from-[#07c160] to-[#10aeff] text-white'
                : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10'
            }`}
          >
            {lab.icon}
            {lab.label}
            {lab.badge && (
              <span className={`ml-1 px-1 py-0.5 rounded text-[9px] font-black ${
                active === lab.key ? 'bg-white/30' : 'bg-[#07c160]/15 text-[#07c160]'
              }`}>
                {lab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {active === 'virtual-group' && <VirtualGroupChat contacts={contacts} />}
    </div>
  );
};

export default LabsPage;
