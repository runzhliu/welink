/**
 * 创意实验室 —— 尝试性功能的集合入口
 */

import React, { useState } from 'react';
import { FlaskConical, Users2, Sparkles, Dna, HelpCircle, Network, Atom } from 'lucide-react';
import type { ContactStats } from '../../types';
import { VirtualGroupChat } from './VirtualGroupChat';
import { Highlights } from './Highlights';
import { ChatDNA } from './ChatDNA';
import { SoulQuiz } from './SoulQuiz';
import { RelationGraph } from './RelationGraph';
import { ParallelChat } from './ParallelChat';

interface Props {
  contacts: ContactStats[];
}

type LabKey = 'highlights' | 'dna' | 'soul-quiz' | 'relation-graph' | 'parallel' | 'virtual-group';

interface LabDef {
  key: LabKey;
  label: string;
  icon: React.ReactNode;
  badge?: string;
  desc: string;
}

const LABS: LabDef[] = [
  {
    key: 'highlights',
    label: '高光瞬间',
    icon: <Sparkles size={14} />,
    desc: '挑一位联系人，AI 从全部聊天里挑出最有故事感的几段',
  },
  {
    key: 'dna',
    label: '聊天 DNA',
    icon: <Dna size={14} />,
    badge: 'NEW',
    desc: '把你的微信聊天浓缩成一张 Wrapped 风格的年度卡片',
  },
  {
    key: 'soul-quiz',
    label: '灵魂提问机',
    icon: <HelpCircle size={14} />,
    badge: 'NEW',
    desc: 'AI 出 5 道默契测试题，发给好友看 ta 还记得多少',
  },
  {
    key: 'relation-graph',
    label: '关系星图',
    icon: <Network size={14} />,
    badge: 'NEW',
    desc: '你的微信宇宙：联系人按共同群聚拢成星图',
  },
  {
    key: 'parallel',
    label: '平行宇宙',
    icon: <Atom size={14} />,
    badge: 'NEW',
    desc: '"如果……" 的虚构对话，AI 用 ta 的风格演一遍',
  },
  {
    key: 'virtual-group',
    label: 'AI 虚拟群聊',
    icon: <Users2 size={14} />,
    desc: '把任意联系人拉到一个虚拟群，AI 扮演每个人互相聊天',
  },
];

export const LabsPage: React.FC<Props> = ({ contacts }) => {
  const [active, setActive] = useState<LabKey>('highlights');

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

      {/* Lab 选择条 */}
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

      {active === 'highlights' && <Highlights contacts={contacts} />}
      {active === 'dna' && <ChatDNA />}
      {active === 'soul-quiz' && <SoulQuiz contacts={contacts} />}
      {active === 'relation-graph' && <RelationGraph />}
      {active === 'parallel' && <ParallelChat contacts={contacts} />}
      {active === 'virtual-group' && <VirtualGroupChat contacts={contacts} />}
    </div>
  );
};

export default LabsPage;
