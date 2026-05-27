// 左栏导航 / 渲染顺序的元数据来源
// 新增 section：在这里加一行；index.tsx 里在对应 group 渲染该组件即可

import type { LucideIcon } from 'lucide-react';
import {
  EyeOff, BarChart2, Bot, Sparkles, ShieldOff, Lock,
  Users, Database, Settings, Stethoscope, FileText, Smartphone,
} from 'lucide-react';

export interface SectionGroup {
  id: string;
  title: string;
}

export interface SectionMeta {
  id: string;        // 与组件 <section data-section-id="..."> 对应，用于左栏滚动定位
  title: string;     // 左栏显示文字
  icon: LucideIcon;
  groupId: string;   // 所属分组
  appOnly?: boolean; // 仅 App 模式可见（如"应用配置"）
}

export const SECTION_GROUPS: SectionGroup[] = [
  { id: 'general',  title: '通用' },
  { id: 'ai',       title: 'AI 模型' },
  { id: 'privacy',  title: '隐私与安全' },
  { id: 'data',     title: '数据' },
  { id: 'system',   title: '系统' },
];

export const SECTIONS: SectionMeta[] = [
  // 通用
  { id: 'recording', title: '录屏模式',   icon: EyeOff,     groupId: 'general' },
  { id: 'display',   title: '显示设置',   icon: BarChart2,  groupId: 'general' },

  // AI
  { id: 'ai-config', title: 'AI 配置',    icon: Bot,        groupId: 'ai' },
  { id: 'prompt',    title: 'Prompt 模板', icon: Bot,        groupId: 'ai' },
  { id: 'tts',       title: '朗读 TTS',   icon: Sparkles,   groupId: 'ai' },

  // 隐私与安全
  { id: 'blocked',   title: '隐私屏蔽',   icon: ShieldOff,  groupId: 'privacy' },
  { id: 'lock',      title: '屏幕锁定',   icon: Lock,       groupId: 'privacy' },

  // 数据
  { id: 'profiles',  title: '多账号',     icon: Users,      groupId: 'data' },
  { id: 'backup',    title: 'AI 备份',    icon: Bot,        groupId: 'data' },
  { id: 'forecast',  title: '关系预测忽略', icon: Sparkles,   groupId: 'data' },
  { id: 'preferences', title: '配置管理', icon: Settings,   groupId: 'data' },

  // 系统
  { id: 'basic',     title: '服务配置',   icon: Settings,   groupId: 'system' },
  { id: 'app',       title: '应用配置',   icon: Database,   groupId: 'system', appOnly: true },
  { id: 'mobile',    title: '移动端配对', icon: Smartphone, groupId: 'system' },
  { id: 'diag',      title: '诊断',       icon: Stethoscope, groupId: 'system' },
  { id: 'usage',     title: 'LLM 用量',   icon: Bot,        groupId: 'system' },
  { id: 'about',     title: '关于',       icon: FileText,   groupId: 'system' },
];
