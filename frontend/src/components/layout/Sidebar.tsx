/**
 * 侧边栏组件 - 桌面侧边 / 手机底部导航栏
 */

import { useState } from 'react';
import { Users, Database, Sun, Moon, MessagesSquare, BookOpen, Github, Search, GitCommitHorizontal, X, Settings } from 'lucide-react';
import type { TabType } from '../../types';

interface SidebarProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  dark: boolean;
  onToggleDark: () => void;
}

// WKWebView UA 含 AppleWebKit 但不含 Safari / Chrome / Firefox
const isWebView = () => {
  const ua = navigator.userAgent;
  return ua.includes('AppleWebKit') && !ua.includes('Safari') && !ua.includes('Chrome') && !ua.includes('Firefox');
};

const openExternal = (url: string) => {
  if (isWebView()) {
    // App 模式：调用后端接口用系统浏览器打开
    fetch(`/api/open-url?url=${encodeURIComponent(url)}`);
  } else {
    window.open(url, '_blank');
  }
};

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange, dark, onToggleDark }) => {
  const [swaggerOpen, setSwaggerOpen] = useState(false);
  const navItems: { tab: TabType; icon: React.ReactNode; label: string }[] = [
    { tab: 'dashboard', icon: <Users size={22} strokeWidth={2} />, label: '好友' },
    { tab: 'groups', icon: <MessagesSquare size={22} strokeWidth={2} />, label: '群聊' },
    { tab: 'timeline', icon: <GitCommitHorizontal size={22} strokeWidth={2} />, label: '时间线' },
    { tab: 'search', icon: <Search size={22} strokeWidth={2} />, label: '搜索' },
    { tab: 'db', icon: <Database size={22} strokeWidth={2} />, label: '数据库' },
    { tab: 'settings', icon: <Settings size={22} strokeWidth={2} />, label: '设置' },
  ];

  return (
    <>
      {swaggerOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-[#1d1d1f]">
          <div className="flex items-center justify-between px-4 py-2 border-b dk-border">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">API 文档</span>
            <button
              onClick={() => setSwaggerOpen(false)}
              className="p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-white/10 transition-all"
            >
              <X size={18} />
            </button>
          </div>
          <iframe src="/swagger/" className="flex-1 w-full border-0" />
        </div>
      )}
      {/* 桌面侧边栏 */}
      <aside className="hidden sm:flex w-20 dk-card bg-white dk-border border-r flex-col items-center py-8 gap-8 shadow-sm z-10">
        <div
          className="w-12 h-12 rounded-2xl overflow-hidden shadow-lg shadow-green-100/50 cursor-pointer hover:opacity-80 transition-opacity"
          onClick={() => openExternal('https://welink.click')}
          title="官方文档"
        >
          <img src="/favicon.svg" alt="WeLink" className="w-full h-full" />
        </div>
        <nav className="flex flex-col gap-4 flex-1">
          {navItems.map(({ tab, icon, label }) => (
            <button
              key={tab}
              onClick={() => onTabChange(tab)}
              title={label}
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
        {/* 底部操作按钮组（收拢间距，避免小屏溢出截断） */}
        <div className="flex flex-col gap-2">
          {/* API 文档 */}
          <button
            onClick={() => setSwaggerOpen(true)}
            className="p-3 rounded-2xl text-gray-400 hover:text-[#07c160] hover:bg-[#e7f8f0] transition-all duration-200"
            title="API 文档"
          >
            <BookOpen size={20} strokeWidth={2} />
          </button>
          {/* GitHub */}
          <button
            onClick={() => openExternal('https://github.com/runzhliu/WeLink')}
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
        </div>
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
          onClick={() => setSwaggerOpen(true)}
          className="flex-1 flex flex-col items-center justify-center py-3 gap-1 text-xs font-semibold text-gray-400"
        >
          <BookOpen size={22} strokeWidth={2} />
          <span>文档</span>
        </button>
        {/* GitHub */}
        <button
          onClick={() => openExternal('https://github.com/runzhliu/WeLink')}
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

