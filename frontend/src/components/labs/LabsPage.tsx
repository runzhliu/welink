/**
 * 创意实验室 —— 尝试性功能的集合入口
 */

import React, { useState } from 'react';
import { FlaskConical, Users2, Sparkles, Dna, HelpCircle, Network, Atom, AlertCircle, Gift, Compass, Gauge, Search, Quote, HeartHandshake, TrendingUp, Globe2, HeartPulse, Flame, Zap, Hand } from 'lucide-react';
import type { ContactStats } from '../../types';
import { VirtualGroupChat } from './VirtualGroupChat';
import { Highlights } from './Highlights';
import { ChatDNA } from './ChatDNA';
import { SoulQuiz } from './SoulQuiz';
import { RelationGraph } from './RelationGraph';
import { ParallelChat } from './ParallelChat';
import { DriftAlert } from './DriftAlert';
import { GroupWrapped } from './GroupWrapped';
import { Milestones } from './Milestones';
import { GroupROI } from './GroupROI';
import { EchoSearch } from './EchoSearch';
import { GoldenQuotes } from './GoldenQuotes';
import { PromiseDebts } from './PromiseDebts';
import { LanguageEvolution } from './LanguageEvolution';
import { ChatGeography } from './ChatGeography';
import { HealthLog } from './HealthLog';
import { FlirtProbe } from './FlirtProbe';
import { ReplySpeed } from './ReplySpeed';
import { InitiativeRank } from './InitiativeRank';

interface Props {
  contacts: ContactStats[];
}

type LabKey = 'highlights' | 'dna' | 'drift' | 'echo' | 'golden-quotes' | 'promise-debts' | 'language-evolution' | 'chat-geography' | 'health-log' | 'flirt-probe' | 'reply-speed' | 'initiative' | 'group-roi' | 'group-wrapped' | 'milestones' | 'soul-quiz' | 'relation-graph' | 'parallel' | 'virtual-group';

interface LabDef {
  key: LabKey;
  label: string;
  icon: React.ReactNode;
  badge?: string;
  // 主功能会调 LLM / embedding API（产生外部请求 + 费用 + 等待时间）。
  // 在 tab 上用「AI」标提示用户，免得点进去才发现要等十几秒。
  llm?: boolean;
  desc: string;
}

const LABS: LabDef[] = [
  {
    key: 'highlights',
    label: '高光瞬间',
    icon: <Sparkles size={14} />,
    llm: true,
    desc: '挑一位联系人，AI 从全部聊天里挑出最有故事感的几段',
  },
  {
    key: 'dna',
    label: '聊天 DNA',
    icon: <Dna size={14} />,
    desc: '把你的微信聊天浓缩成一张 Wrapped 风格的年度卡片',
  },
  {
    key: 'drift',
    label: '断联预警',
    icon: <AlertCircle size={14} />,
    desc: '找出消息频率从高变低、超过 30 天没说话的老朋友',
  },
  {
    key: 'echo',
    label: '这句话谁说过',
    icon: <Search size={14} />,
    llm: true,
    desc: '输入一句话，跨全库语义反查谁说过最像的话——找回那句"我记得有人说过"',
  },
  {
    key: 'golden-quotes',
    label: '群金句榜',
    icon: <Quote size={14} />,
    desc: '扫群里所有「引用回复」，按原文被翻牌次数排出 Top 10 名场面 / 梗 —— 零 LLM 即时返回',
  },
  {
    key: 'promise-debts',
    label: '人情债',
    icon: <HeartHandshake size={14} />,
    llm: true,
    desc: 'AI 挖出"答应了但没做"的承诺与邀约：下次约饭 / 改天找时间 / 我寄给你 ……看看 TA 欠你 vs 你欠 TA',
  },
  {
    key: 'language-evolution',
    label: '语言进化史',
    icon: <TrendingUp size={14} />,
    desc: '按年画"我"说话风格的 4 条曲线：句长 / emoji 浓度 / 英文夹杂率 / 日均产量 —— 你这些年话变了吗？',
  },
  {
    key: 'chat-geography',
    label: '聊天地图',
    icon: <Globe2 size={14} />,
    desc: '从所有私聊里抽出地名（中国城市 / 景点 / 海外城市 / 国家），bubble cloud 看你聊起最多的地方',
  },
  {
    key: 'health-log',
    label: '健康日记',
    icon: <HeartPulse size={14} />,
    desc: '扫聊天记录里"感冒/发烧/医院/吃药……"的提及，7 天合并成一次发作，看「我」vs「TA 们」谁更常生病',
  },
  {
    key: 'flirt-probe',
    label: '暧昧探测',
    icon: <Flame size={14} />,
    badge: 'NEW',
    desc: '扫私聊里的 5 类暧昧痕迹（亲昵称呼 / 想念 / 深夜亲密 / 暧昧动作 / 暧昧表情），看跟谁聊得最有"暧昧浓度"',
  },
  {
    key: 'reply-speed',
    label: '回复速度榜',
    icon: <Zap size={14} />,
    badge: 'NEW',
    desc: '双向回复延迟中位数：谁秒回你（TA 把你当回事）/ 你秒回谁（你把 TA 当回事）/ 最不对等。纯时间戳，零 LLM',
  },
  {
    key: 'initiative',
    label: '主动指数榜',
    icon: <Hand size={14} />,
    badge: 'NEW',
    desc: '谁先开口？统计每段对话的开场方：你主动找的人 / 主动找你的人 / 最不对等。和回复速度榜互补，零 LLM',
  },
  {
    key: 'group-roi',
    label: '群语料 ROI',
    icon: <Gauge size={14} />,
    desc: '给每个群打分：值得多看 / 可以静音 / 可以放手，告别"加了 200 个群不知道留谁"',
  },
  {
    key: 'group-wrapped',
    label: '群聊 Wrapped',
    icon: <Gift size={14} />,
    desc: '挑一个群浓缩成一张 Wrapped 卡：发言榜、最常被 @、媒体大王、群口头禅',
  },
  {
    key: 'milestones',
    label: '关系考古',
    icon: <Compass size={14} />,
    desc: '单联系人时间轴：首次互动、首次深夜、最长断联、重联、周年',
  },
  {
    key: 'soul-quiz',
    label: '灵魂提问机',
    icon: <HelpCircle size={14} />,
    llm: true,
    desc: 'AI 出 5 道默契测试题，发给好友看 ta 还记得多少',
  },
  {
    key: 'relation-graph',
    label: '关系星图',
    icon: <Network size={14} />,
    desc: '你的微信宇宙：联系人按共同群聚拢成星图',
  },
  {
    key: 'parallel',
    label: '平行宇宙',
    icon: <Atom size={14} />,
    llm: true,
    desc: '"如果……" 的虚构对话，AI 用 ta 的风格演一遍',
  },
  {
    key: 'virtual-group',
    label: 'AI 虚拟群聊',
    icon: <Users2 size={14} />,
    llm: true,
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
            {lab.llm && (
              <span
                title="主功能会调用 LLM / embedding API（产生外部请求与等待时间）"
                className={`ml-1 px-1 py-0.5 rounded text-[9px] font-black ${
                  active === lab.key ? 'bg-white/30' : 'bg-purple-500/15 text-purple-600 dark:text-purple-300'
                }`}
              >
                AI
              </span>
            )}
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
      {active === 'drift' && <DriftAlert />}
      {active === 'echo' && <EchoSearch />}
      {active === 'golden-quotes' && <GoldenQuotes />}
      {active === 'promise-debts' && <PromiseDebts contacts={contacts} />}
      {active === 'language-evolution' && <LanguageEvolution />}
      {active === 'chat-geography' && <ChatGeography />}
      {active === 'health-log' && <HealthLog />}
      {active === 'flirt-probe' && <FlirtProbe />}
      {active === 'reply-speed' && <ReplySpeed />}
      {active === 'initiative' && <InitiativeRank />}
      {active === 'group-roi' && <GroupROI />}
      {active === 'group-wrapped' && <GroupWrapped />}
      {active === 'milestones' && <Milestones contacts={contacts} />}
      {active === 'soul-quiz' && <SoulQuiz contacts={contacts} />}
      {active === 'relation-graph' && <RelationGraph />}
      {active === 'parallel' && <ParallelChat contacts={contacts} />}
      {active === 'virtual-group' && <VirtualGroupChat contacts={contacts} />}
    </div>
  );
};

export default LabsPage;
