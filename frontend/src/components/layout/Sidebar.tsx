/**
 * 侧边栏组件 - 桌面侧边 / 手机底部导航栏
 */

import { Users, Database, Sun, Moon, MessagesSquare, BookOpen, Github } from 'lucide-react';
import type { TabType } from '../../types';

interface SidebarProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  dark: boolean;
  onToggleDark: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange, dark, onToggleDark }) => {
  const navItems: { tab: TabType; icon: React.ReactNode; label: string }[] = [
    { tab: 'dashboard', icon: <Users size={22} strokeWidth={2} />, label: '好友' },
    { tab: 'groups', icon: <MessagesSquare size={22} strokeWidth={2} />, label: '群聊' },
    { tab: 'db', icon: <Database size={22} strokeWidth={2} />, label: '数据库' },
  ];

  return (
    <>
      {/* 桌面侧边栏 */}
      <aside className="hidden sm:flex w-20 dk-card bg-white dk-border border-r flex-col items-center py-8 gap-8 shadow-sm z-10">
        <div className="w-12 h-12 rounded-2xl overflow-hidden shadow-lg shadow-green-100/50">
          <img src="/favicon.svg" alt="WeLink" className="w-full h-full" />
        </div>
        <nav className="flex flex-col gap-4 flex-1">
          {navItems.map(({ tab, icon }) => (
            <button
              key={tab}
              onClick={() => onTabChange(tab)}
              className={`p-4 rounded-2xl transition-all duration-200 ${
                activeTab === tab
                  ? 'bg-[#e7f8f0] text-[#07c160] shadow-sm dark:bg-[#07c160]/20'
                  : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50 dark:hover:bg-white/5'
              }`}
            >
              {icon}
            </button>
          ))}
        </nav>
        {/* API 文档 */}
        <button
          onClick={() => window.open('/swagger/', '_blank')}
          className="p-3 rounded-2xl text-gray-400 hover:text-[#07c160] hover:bg-[#e7f8f0] transition-all duration-200"
          title="API 文档"
        >
          <BookOpen size={20} strokeWidth={2} />
        </button>
        {/* GitHub */}
        <button
          onClick={() => window.open('https://github.com/runzhliu/WeLink', '_blank')}
          className="p-3 rounded-2xl text-gray-400 hover:text-[#1d1d1f] hover:bg-gray-100 dark:hover:bg-white/5 transition-all duration-200"
          title="GitHub"
        >
          <Github size={20} strokeWidth={2} />
        </button>
        {/* 暗色切换 */}
        <button
          onClick={onToggleDark}
          className="p-3 rounded-2xl text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5 transition-all duration-200"
          title={dark ? '切换亮色' : '切换暗色'}
        >
          {dark ? <Sun size={20} strokeWidth={2} /> : <Moon size={20} strokeWidth={2} />}
        </button>
      </aside>

      {/* 手机底部导航栏 */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-50 dk-card bg-white dk-border border-t flex">
        {navItems.map(({ tab, icon, label }) => (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            className={`flex-1 flex flex-col items-center justify-center py-3 gap-1 text-xs font-semibold transition-colors ${
              activeTab === tab ? 'text-[#07c160]' : 'text-gray-400'
            }`}
          >
            {icon}
            <span>{label}</span>
          </button>
        ))}
        {/* API 文档 */}
        <button
          onClick={() => window.open('/swagger/', '_blank')}
          className="flex-1 flex flex-col items-center justify-center py-3 gap-1 text-xs font-semibold text-gray-400"
        >
          <BookOpen size={22} strokeWidth={2} />
          <span>文档</span>
        </button>
        {/* GitHub */}
        <button
          onClick={() => window.open('https://github.com/runzhliu/WeLink', '_blank')}
          className="flex-1 flex flex-col items-center justify-center py-3 gap-1 text-xs font-semibold text-gray-400"
        >
          <Github size={22} strokeWidth={2} />
          <span>GitHub</span>
        </button>
        {/* 暗色切换按钮 */}
        <button
          onClick={onToggleDark}
          className="flex-1 flex flex-col items-center justify-center py-3 gap-1 text-xs font-semibold text-gray-400"
        >
          {dark ? <Sun size={22} strokeWidth={2} /> : <Moon size={22} strokeWidth={2} />}
          <span>{dark ? '亮色' : '暗色'}</span>
        </button>
      </nav>
    </>
  );
};
