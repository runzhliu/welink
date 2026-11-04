/** Desktop navigation and a compact mobile dock with the full menu in a sheet. */
import { useState } from 'react';
import { Home, BarChart2, Database, Sun, Moon, MessagesSquare, MessageCircle, BookOpen, Github, Search, Hourglass, Heart, Link2, Settings, ChevronLeft, ChevronRight, Files, Download, Archive, Newspaper, FlaskConical, CalendarClock, Image as ImageIcon, Inbox, MoreHorizontal, SlidersHorizontal } from 'lucide-react';
import type { TabType } from '../../types';
import { Dialog } from '../common/Dialog';

interface SidebarProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  dark: boolean;
  onToggleDark: () => void;
  badges?: Partial<Record<TabType, number>>;
}

const NAV_ITEMS = [
  { tab: 'dashboard', icon: Home, label: 'AI 首页' },
  { tab: 'inbox', icon: Inbox, label: '关系收件箱' },
  { tab: 'digest', icon: Newspaper, label: '今日简报' },
  { tab: 'stats', icon: BarChart2, label: '洞察' },
  { tab: 'contacts', icon: MessageCircle, label: '私聊' },
  { tab: 'groups', icon: MessagesSquare, label: '群聊' },
  { tab: 'calendar', icon: Hourglass, label: '时光机' },
  { tab: 'anniversary', icon: Heart, label: '纪念日' },
  { tab: 'search', icon: Search, label: '搜索' },
  { tab: 'urls', icon: Link2, label: '链接' },
  { tab: 'skills', icon: Files, label: 'Skills' },
  { tab: 'sft', icon: SlidersHorizontal, label: '模型训练' },
  { tab: 'labs', icon: FlaskConical, label: '创意实验室' },
  { tab: 'gallery', icon: ImageIcon, label: 'AI 画廊' },
  { tab: 'memory', icon: Archive, label: '记忆库' },
  { tab: 'tasks', icon: CalendarClock, label: '定时任务' },
  { tab: 'export', icon: Download, label: '导出中心' },
  { tab: 'db', icon: Database, label: '数据库' },
  { tab: 'settings', icon: Settings, label: '设置' },
] satisfies { tab: TabType; icon: typeof Home; label: string }[];

const NAV_GROUPS: { label: string; tabs: TabType[] }[] = [
  { label: '概览', tabs: ['dashboard', 'inbox', 'digest', 'stats'] },
  { label: '关系与记录', tabs: ['contacts', 'groups', 'calendar', 'anniversary', 'search', 'urls'] },
  { label: 'AI 工作台', tabs: ['skills', 'sft', 'labs', 'gallery', 'memory', 'tasks'] },
  { label: '管理', tabs: ['export', 'db', 'settings'] },
];
const MOBILE_TABS: TabType[] = ['dashboard', 'contacts', 'groups', 'stats'];

const NavBadge: React.FC<{ count?: number }> = ({ count }) => count && count > 0 ? (
  <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-semibold flex items-center justify-center leading-none">
    {count > 99 ? '99+' : count}
  </span>
) : null;

const openExternal = (url: string) => {
  const ua = navigator.userAgent;
  if (ua.includes('AppleWebKit') && !ua.includes('Safari') && !ua.includes('Chrome') && !ua.includes('Firefox')) {
    void fetch('/api/open-url?url=' + encodeURIComponent(url));
  } else { window.open(url, '_blank', 'noopener,noreferrer'); }
};

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange, dark, onToggleDark, badges }) => {
  const [swaggerOpen, setSwaggerOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expanded, setExpanded] = useState(() => localStorage.getItem('welink_sidebar_expanded') !== 'false');
  const navigate = (tab: TabType) => { onTabChange(tab); setMobileOpen(false); };
  const toggleExpanded = () => {
    setExpanded(!expanded);
    localStorage.setItem('welink_sidebar_expanded', String(!expanded));
  };
  const tools = [
    { icon: BookOpen, label: 'API 文档', onClick: () => setSwaggerOpen(true) },
    { icon: Github, label: 'GitHub', onClick: () => openExternal('https://github.com/runzhliu/WeLink') },
    { icon: dark ? Sun : Moon, label: dark ? '亮色模式' : '暗色模式', onClick: onToggleDark },
  ];
  const moreActive = !MOBILE_TABS.includes(activeTab);
  const moreUnread = Math.max(...NAV_ITEMS.filter(item => !MOBILE_TABS.includes(item.tab)).map(item => badges?.[item.tab] ?? 0));

  return <>
    <Dialog open={swaggerOpen} title="API 文档" onClose={() => setSwaggerOpen(false)} className="!w-[min(96vw,80rem)]">
      <div className="flex items-center justify-between gap-3 mb-3 text-xs text-[var(--text-secondary)]">
        <span>WeLink 后端接口文档</span>
        <a href="/swagger/" target="_blank" rel="noopener noreferrer" className="ui-button ui-button-secondary !min-h-8 !text-xs">在新标签页打开</a>
      </div>
      <iframe title="WeLink API 文档" src="/swagger/" className="h-[75dvh] w-full border-0 rounded-xl" />
    </Dialog>

    <aside data-tour="sidebar" className={'app-sidebar hidden sm:flex flex-col z-10 transition-[width] duration-200 ' + (expanded ? '' : 'is-collapsed')}>
      <div className={'sidebar-brand shrink-0 ' + (expanded ? '' : 'flex-col')}>
        <button type="button" className="w-9 h-9 rounded-xl overflow-hidden shrink-0" onClick={() => openExternal('https://welink.click')} title="官方文档" aria-label="打开 WeLink 官方文档">
          <img src="/favicon.svg" alt="WeLink" className="w-full h-full" />
        </button>
        {expanded && <div className="min-w-0 flex-1"><div className="sidebar-brand-name">WeLink</div><div className="sidebar-brand-caption">让每段关系被看见</div></div>}
        <button type="button" onClick={toggleExpanded} aria-expanded={expanded} aria-label={expanded ? '收起侧边栏' : '展开侧边栏'} className="ui-icon-button !w-7 !h-7" title={expanded ? '收起侧边栏' : '展开侧边栏'}>
          {expanded ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}
        </button>
      </div>
      <nav aria-label="主导航" className="flex-1 min-h-0 overflow-y-auto">
        {NAV_GROUPS.map(group => <div key={group.label} className="sidebar-group">
          {expanded && <div className="sidebar-group-label">{group.label}</div>}
          {NAV_ITEMS.filter(item => group.tabs.includes(item.tab)).map(({ tab, icon: Icon, label }) => <button
            type="button" key={tab} data-tour={'nav-' + tab} onClick={() => navigate(tab)} aria-label={label}
            aria-current={activeTab === tab ? 'page' : undefined} title={expanded ? undefined : label} className="sidebar-nav-item"
          >
            <span className="shrink-0 relative"><Icon size={18} /><NavBadge count={badges?.[tab]} /></span>
            {expanded && <span className="sidebar-nav-label truncate">{label}</span>}
          </button>)}
        </div>)}
      </nav>
      <div className="sidebar-tools shrink-0">
        {tools.map(({ icon: Icon, label, onClick }) => <button type="button" key={label} className="ui-icon-button" onClick={onClick} title={label} aria-label={label}><Icon size={18} strokeWidth={1.8} /></button>)}
      </div>
    </aside>

    <nav aria-label="移动端主导航" data-tour="sidebar" className="mobile-nav sm:hidden fixed z-50 flex">
      {MOBILE_TABS.map(tab => {
        const item = NAV_ITEMS.find(item => item.tab === tab)!;
        return <button type="button" key={tab} onClick={() => navigate(tab)} aria-current={activeTab === tab ? 'page' : undefined} className="mobile-nav-item">
          <span className="relative"><item.icon size={19} strokeWidth={1.8} /><NavBadge count={badges?.[tab]} /></span>
          <span>{tab === 'dashboard' ? '首页' : item.label}</span>
        </button>;
      })}
      <button type="button" onClick={() => setMobileOpen(true)} aria-label="更多功能" aria-haspopup="dialog" aria-expanded={mobileOpen} aria-current={moreActive ? 'page' : undefined} className="mobile-nav-item">
        <span className="relative"><MoreHorizontal size={20} /><NavBadge count={moreUnread} /></span><span>更多</span>
      </button>
    </nav>

    <Dialog open={mobileOpen} title="全部功能" onClose={() => setMobileOpen(false)} className="ui-dialog-sheet">
      <div className="space-y-5">
        {NAV_GROUPS.map(group => <div key={group.label}>
          <div className="sidebar-group-label !px-0 !pb-2">{group.label}</div>
          <div className="mobile-menu-grid">{NAV_ITEMS.filter(item => group.tabs.includes(item.tab)).map(({ tab, icon: Icon, label }) => <button type="button" key={tab} onClick={() => navigate(tab)} aria-current={activeTab === tab ? 'page' : undefined} className="mobile-menu-item">
            <span className="relative"><Icon size={20} strokeWidth={1.8} /><NavBadge count={badges?.[tab]} /></span><span>{label}</span>
          </button>)}</div>
        </div>)}
        <div className="flex items-center justify-between border-t dk-border pt-3">
          {tools.map(({ icon: Icon, label, onClick }) => <button type="button" key={label} onClick={() => { setMobileOpen(false); onClick(); }} className="ui-button !px-2 !text-xs"><Icon size={16} />{label}</button>)}
        </div>
      </div>
    </Dialog>
  </>;
};
