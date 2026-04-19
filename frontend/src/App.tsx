/**
 * WeLink - 微信聊天数据分析平台
 * 重构版本 - 组件化 + 微信风格设计
 */

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { PrivacyModeContext } from './contexts/PrivacyModeContext';
import { SelfInfoProvider } from './contexts/SelfInfoContext';
import { LockProvider, useLock } from './contexts/LockContext';
import { LockOverlay } from './components/common/LockOverlay';

// Layout Components
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';

// Dashboard Components
import { AIHomePage } from './components/dashboard/AIHomePage';
import { StatsPage } from './components/dashboard/StatsPage';
// FunStatsPage 已合并到 StatsPage 底部
import { ContactsPage } from './components/dashboard/ContactsPage';
import { URLCollectionPage } from './components/dashboard/URLCollectionPage';
import { ExportCenterPage } from './components/dashboard/ExportCenterPage';
import { DatabaseView } from './components/dashboard/DatabaseView';
import { SearchView } from './components/search/SearchView';
import { TimelineView } from './components/timeline/TimelineView';
import { ChatCalendarPage } from './components/calendar/ChatCalendarPage';
import { AnniversaryPage } from './components/anniversary/AnniversaryPage';
import { SkillsView } from './components/skills/SkillsView';
import { GroupsView, GroupDetailModal } from './components/groups/GroupsView';
import { useDarkMode } from './hooks/useDarkMode';

// Contact Components
import { ContactModal } from './components/contact/ContactModal';

// Common Components
import { InitializingScreen } from './components/common/InitializingScreen';
import { WelcomePage } from './components/common/WelcomePage';
import { AppSetupPage } from './components/common/AppSetupPage';
import { SetupRequiredPage } from './components/common/SetupRequiredPage';
import { CommandPalette } from './components/common/CommandPalette';
import { ReleaseNotesModal } from './components/common/ReleaseNotesModal';
import { SettingsPage } from './components/common/SettingsPage';

// App API
import { appApi } from './services/appApi';
import type { AppInfo } from './services/appApi';

// Hooks
import { useContacts } from './hooks/useContacts';
import { useGlobalStats } from './hooks/useGlobalStats';
import { useBackendStatus } from './hooks/useBackendStatus';
import { usePrivacySettings } from './hooks/usePrivacySettings';

// Types
import type { TabType, ContactStats, HealthStatus, TimeRange, GroupInfo } from './types';

import { globalApi, groupsApi } from './services/api';

const ALL_TIME: TimeRange = { from: null, to: null, label: '全部' };

function AppInner() {
  const { lock: lockScreen, enabled: lockEnabled } = useLock();
  const { dark, toggle: toggleDark } = useDarkMode();

  // 全局字号（rem 基准，默认 16px）
  const [fontSize, setFontSize] = useState(() => Number(localStorage.getItem('welink_fontSize')) || 16);
  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}px`;
    localStorage.setItem('welink_fontSize', String(fontSize));
  }, [fontSize]);

  // State — 从 URL hash 恢复当前 tab + 联系人/群聊弹窗
  // hash 格式：#/stats  #/stats/contact/wxid_abc  #/groups/group/xxx@chatroom
  const VALID_TABS: TabType[] = ['dashboard', 'stats', 'contacts', 'db', 'groups', 'search', 'timeline', 'calendar', 'anniversary', 'urls', 'skills', 'export', 'settings'];

  const parseHash = (): { tab: TabType; contactId?: string; groupId?: string } => {
    const raw = window.location.hash.replace('#/', '').replace('#', '');
    const parts = raw.split('/');
    const tab = VALID_TABS.includes(parts[0] as TabType) ? parts[0] as TabType : 'dashboard';
    let contactId: string | undefined;
    let groupId: string | undefined;
    if (parts[1] === 'contact' && parts[2]) contactId = decodeURIComponent(parts[2]);
    if (parts[1] === 'group' && parts[2]) groupId = decodeURIComponent(parts[2]);
    return { tab, contactId, groupId };
  };

  const [activeTab, setActiveTabRaw] = useState<TabType>(() => parseHash().tab);

  const setActiveTab = useCallback((tab: TabType) => {
    setActiveTabRaw(tab);
    window.history.pushState(null, '', `#/${tab}`);
  }, []);

  // 监听浏览器前进/后退
  useEffect(() => {
    const onPop = () => {
      const { tab } = parseHash();
      setActiveTabRaw(tab);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const [search, setSearch] = useState('');
  const [selectedContact, setSelectedContactRaw] = useState<ContactStats | null>(null);
  const [selectedGroup, setSelectedGroupRaw] = useState<GroupInfo | null>(null);

  // 打开联系人弹窗时写入 hash
  const setSelectedContact = useCallback((contact: ContactStats | null) => {
    setSelectedContactRaw(contact);
    if (contact) {
      window.history.pushState(null, '', `#/${activeTab}/contact/${encodeURIComponent(contact.username)}`);
    } else {
      window.history.pushState(null, '', `#/${activeTab}`);
    }
  }, [activeTab]);

  // 打开群聊弹窗时写入 hash
  const setSelectedGroup = useCallback((group: GroupInfo | null) => {
    setSelectedGroupRaw(group);
    if (group) {
      window.history.pushState(null, '', `#/${activeTab}/group/${encodeURIComponent(group.username)}`);
    } else {
      window.history.pushState(null, '', `#/${activeTab}`);
    }
  }, [activeTab]);
  const [timeRange, setTimeRange] = useState<TimeRange>(() => {
    try {
      const saved = localStorage.getItem('welink_timeRange');
      return saved ? JSON.parse(saved) : ALL_TIME;
    } catch { return ALL_TIME; }
  });
  const [initLoading, setInitLoading] = useState(false);
  const [hasStarted, setHasStarted] = useState(() => {
    return localStorage.getItem('welink_hasStarted') === 'true';
  });

  // Cmd+K 命令面板 + Cmd/Ctrl+1..9 tab 切换
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Release notes：启动时后台检查，有新版本且用户没 dismiss 过就弹 Modal
  const [releaseInfo, setReleaseInfo] = useState<{ current: string; latest: string; changelog: string; url: string } | null>(null);
  useEffect(() => {
    // ⌘1..⌘9 映射到 VALID_TABS 的前 9 项；顺序对应 Sidebar 上的常用 tab
    const TAB_ORDER: TabType[] = ['dashboard', 'stats', 'contacts', 'groups', 'search', 'timeline', 'calendar', 'skills', 'settings'];
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      // 在输入框里按 ⌘1 之类不拦截（浏览器默认也会被某些组件拦截）
      const target = e.target as HTMLElement | null;
      const isEditable = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(p => !p);
        return;
      }
      if (e.key.toLowerCase() === 'l' && lockEnabled) {
        e.preventDefault();
        lockScreen();
        return;
      }
      if (!isEditable && /^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1;
        const t = TAB_ORDER[idx];
        if (t) {
          e.preventDefault();
          setActiveTab(t);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lockEnabled, lockScreen]);


  // App 模式检测
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  // Backend Status Hook
  const { isInitialized, isIndexing, backendReady, startPolling, progress } = useBackendStatus(1000);

  // Privacy settings
  const {
    blockedUsers,
    blockedGroups,
    privacyMode,
    setPrivacyMode,
    addBlockedUser,
    removeBlockedUser,
    addBlockedGroup,
    removeBlockedGroup,
  } = usePrivacySettings();

  // Data Hooks (只在初始化完成后启动)
  const { contacts: allContacts, loading: contactsLoading } = useContacts(isInitialized, 15000);
  const { stats: rawGlobalStats } = useGlobalStats(isInitialized, 15000);
  const [allGroups, setAllGroups] = useState<GroupInfo[]>([]);
  useEffect(() => {
    if (isInitialized) groupsApi.getList().then((d) => setAllGroups(d || [])).catch(() => {});
  }, [isInitialized]);
  const statsLoading = contactsLoading;

  // 屏蔽过滤后的联系人列表
  const contacts = useMemo(() => {
    if (blockedUsers.length === 0) return allContacts;
    return allContacts.filter(
      (c) => !blockedUsers.some(
        (b) => b === c.username || b === c.nickname || b === c.remark
      )
    );
  }, [allContacts, blockedUsers]);

  // 从 URL hash 恢复联系人弹窗
  const contactRestoredRef = useRef(false);
  useEffect(() => {
    if (contactRestoredRef.current || allContacts.length === 0) return;
    const { contactId } = parseHash();
    if (contactId) {
      const c = allContacts.find(cc => cc.username === contactId);
      if (c) setSelectedContactRaw(c);
    }
    contactRestoredRef.current = true;
  }, [allContacts]);

  // 从 URL hash 恢复群聊弹窗
  const groupRestoredRef = useRef(false);
  useEffect(() => {
    if (groupRestoredRef.current || allGroups.length === 0) return;
    const { groupId } = parseHash();
    if (groupId) {
      const g = allGroups.find(gg => gg.username === groupId);
      if (g) setSelectedGroupRaw(g);
    }
    groupRestoredRef.current = true;
  }, [allGroups]);

  // 被屏蔽联系人的显示名集合（用于过滤深夜排行，排行只有 name 无 username）
  const blockedDisplayNames = useMemo(() => {
    if (blockedUsers.length === 0) return new Set<string>();
    return new Set(
      allContacts
        .filter((c) => blockedUsers.some((b) => b === c.username || b === c.nickname || b === c.remark))
        .map((c) => c.remark || c.nickname || c.username)
    );
  }, [allContacts, blockedUsers]);

  // 屏蔽过滤后的全局统计（深夜排行中过滤被屏蔽联系人）
  const globalStats = useMemo(() => {
    if (!rawGlobalStats || blockedDisplayNames.size === 0) return rawGlobalStats;
    return {
      ...rawGlobalStats,
      late_night_ranking: rawGlobalStats.late_night_ranking.filter(
        (e) => !blockedDisplayNames.has(e.name)
      ),
    };
  }, [rawGlobalStats, blockedDisplayNames]);

  // Computed Values
  const filteredContacts = useMemo(() => {
    if (!search) return contacts;
    const searchLower = search.toLowerCase();
    return contacts.filter(
      (c) =>
        (c.remark + c.nickname + c.username).toLowerCase().includes(searchLower)
    );
  }, [contacts, search]);

  const healthStatus: HealthStatus = useMemo(() => {
    if (!contacts.length) return { hot: 0, warm: 0, cooling: 0, silent: 0, cold: 0 };

    const now = Date.now() / 1000;
    let hot = 0, warm = 0, cooling = 0, silent = 0, cold = 0;

    contacts.forEach((c) => {
      if (c.total_messages === 0) {
        cold++;
      } else {
        const ts = new Date(c.last_message_time).getTime() / 1000;
        const days = (now - ts) / 86400;
        if (days < 7) hot++;
        else if (days < 30) warm++;
        else if (days < 180) cooling++;
        else silent++;
      }
    });

    return { hot, warm, cooling, silent, cold };
  }, [contacts]);

  // Handlers
  const handleContactClick = (contact: ContactStats) => {
    setSelectedContact(contact);
  };

  const handleCloseModal = () => {
    setSelectedContact(null);
  };

  const handleStart = async (from: number | null, to: number | null, label: string) => {
    setInitLoading(true);
    try {
      await globalApi.init(from, to);
      const range = { from, to, label };
      setTimeRange(range);
      setHasStarted(true);
      localStorage.setItem('welink_hasStarted', 'true');
      localStorage.setItem('welink_timeRange', JSON.stringify(range));
      startPolling(); // 重新开始轮询，等待 is_initialized 变为 true
    } catch (e) {
      console.error('Init failed', e);
    } finally {
      setInitLoading(false);
    }
  };

  const handleReselect = () => {
    setHasStarted(false);
    setTimeRange(ALL_TIME);
    localStorage.removeItem('welink_hasStarted');
    localStorage.removeItem('welink_timeRange');
  };

  // 启动后 5s 检查一次新版本（避免与首次索引抢带宽）
  useEffect(() => {
    if (!backendReady || !appInfo?.ready) return;
    const timer = setTimeout(async () => {
      try {
        const r = await fetch('/api/app/check-update');
        const d = await r.json() as { has_update?: boolean; current?: string; latest?: string; changelog?: string; url?: string };
        if (!d.has_update || !d.latest) return;
        const dismissed = localStorage.getItem('welink_dismissed_version');
        if (dismissed === d.latest) return;
        setReleaseInfo({
          current: d.current || appInfo.version || '',
          latest: d.latest,
          changelog: d.changelog || '',
          url: d.url || `https://github.com/runzhliu/welink/releases/tag/${d.latest}`,
        });
      } catch { /* 网络挂了静默 */ }
    }, 5000);
    return () => clearTimeout(timer);
  }, [backendReady, appInfo?.ready, appInfo?.version]);

  // 后端就绪后获取 App 模式信息
  useEffect(() => {
    if (backendReady) {
      appApi.getInfo().then(setAppInfo).catch(() => setAppInfo({ app_mode: false, needs_setup: false, ready: true }));
    }
  }, [backendReady]);

  // 后端就绪后自动触发索引：覆盖两个场景
  //   1. 后端重启（backendReady 翻 true）但 localStorage 记得用户已选过时间范围
  //   2. 用户刚 setup 完真实数据目录（appInfo.ready 翻 true），但 hasStarted 已是 true，
  //      会直接跳过 WelcomePage —— 必须由前端补一次 /api/init，否则后端永远不会开始 performAnalysis
  useEffect(() => {
    if (appInfo?.ready && hasStarted && !isInitialized && !isIndexing && !initLoading) {
      globalApi.init(timeRange.from, timeRange.to).then(() => startPolling()).catch(console.error);
    }
  }, [backendReady, appInfo?.ready]);

  // 后端未连通时等待
  if (!backendReady) {
    return <InitializingScreen message="正在连接后端服务..." />;
  }

  // 等待 app info 加载
  if (!appInfo) {
    return <InitializingScreen message="正在检测配置..." />;
  }

  // App 模式且未配置：显示 Setup 页面（可选目录 / 切 Demo）
  if (appInfo.app_mode && appInfo.needs_setup) {
    return (
      <AppSetupPage
        onSetupComplete={() => setAppInfo({ ...appInfo, needs_setup: false, ready: true })}
      />
    );
  }

  // Docker / 本地模式未就绪：展示运维引导页，持续轮询后端
  if (!appInfo.app_mode && appInfo.needs_setup) {
    return <SetupRequiredPage info={appInfo} onReady={(next) => setAppInfo(next)} />;
  }

  // 用户还没选时间范围，或主动点了「重新选择」
  if (!hasStarted) {
    return <WelcomePage onStart={handleStart} loading={initLoading} isAppMode={appInfo.app_mode} />;
  }

  // 已选择时间范围，等待索引完成
  if (!isInitialized || isIndexing) {
    return (
      <InitializingScreen
        message={`正在建立索引（${timeRange.label}）...`}
        progress={progress}
        cancellable
      />
    );
  }

  return (
    <SelfInfoProvider value={appInfo?.self_info ?? null}>
    <PrivacyModeContext.Provider value={{ privacyMode, setPrivacyMode }}>
    <div className="flex h-screen dk-page bg-[#f8f9fb] dk-text text-[#1d1d1f] font-sans overflow-hidden">
      {/* Sidebar */}
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} dark={dark} onToggleDark={toggleDark} />

      {/* Main Content */}
      <main className={`flex-1 overflow-y-auto dk-page ${activeTab === 'dashboard' ? 'pb-16 sm:pb-0' : 'p-4 sm:p-10 pb-20 sm:pb-10'}`}>
        {activeTab === 'dashboard' ? (
          <AIHomePage
            contacts={contacts}
            timeRange={timeRange}
            onReselect={handleReselect}
            onContactClick={handleContactClick}
            onGroupClick={(g) => setSelectedGroup(g)}
            onNavigateToAnniversary={() => setActiveTab('anniversary')}
          />
        ) : activeTab === 'stats' ? (
          <StatsPage
            contacts={contacts}
            globalStats={globalStats}
            healthStatus={healthStatus}
            onContactClick={handleContactClick}
            blockedUsers={blockedUsers}
            blockedDisplayNames={blockedDisplayNames}
          />
        ) : activeTab === 'contacts' ? (
          <ContactsPage
            contacts={contacts}
            filteredContacts={filteredContacts}
            statsLoading={statsLoading}
            search={search}
            onSearchChange={setSearch}
            onContactClick={handleContactClick}
          />
        ) : activeTab === 'groups' ? (
          <GroupsView allContacts={allContacts} onContactClick={handleContactClick} onGroupClick={(g) => setSelectedGroup(g)} blockedGroups={blockedGroups} onBlockGroup={addBlockedGroup} onOpenSettings={() => setActiveTab('settings')} />
        ) : activeTab === 'timeline' ? (
          <TimelineView contacts={contacts} onContactClick={handleContactClick} />
        ) : activeTab === 'calendar' ? (
          <ChatCalendarPage contacts={contacts} onContactClick={handleContactClick} />
        ) : activeTab === 'anniversary' ? (
          <AnniversaryPage contacts={contacts} onContactClick={handleContactClick} />
        ) : activeTab === 'skills' ? (
          <SkillsView />
        ) : activeTab === 'search' ? (
          <SearchView
            contacts={contacts}
            onContactClick={handleContactClick}
            onGroupClick={(username) => {
              const group = allGroups.find(g => g.username === username);
              if (group) setSelectedGroup(group);
            }}
            blockedGroups={blockedGroups}
          />
        ) : activeTab === 'urls' ? (
          <URLCollectionPage blockedUsers={blockedUsers} blockedDisplayNames={blockedDisplayNames} />
        ) : activeTab === 'export' ? (
          <ExportCenterPage contacts={contacts} groups={allGroups} />
        ) : activeTab === 'settings' ? (
          <SettingsPage
            isAppMode={appInfo.app_mode}
            appVersion={appInfo.version}
            blockedUsers={blockedUsers}
            blockedGroups={blockedGroups}
            onAddBlockedUser={addBlockedUser}
            onRemoveBlockedUser={removeBlockedUser}
            onAddBlockedGroup={addBlockedGroup}
            onRemoveBlockedGroup={removeBlockedGroup}
            allContacts={allContacts}
            allGroups={allGroups}
            privacyMode={privacyMode}
            onTogglePrivacyMode={setPrivacyMode}
            dark={dark}
            onToggleDark={toggleDark}
            fontSize={fontSize}
            onFontSizeChange={setFontSize}
          />
        ) : (
          <div>
            <Header title="Database" subtitle="数据库管理" />
            <DatabaseView />
          </div>
        )}
      </main>

      {/* Release notes */}
      {releaseInfo && (
        <ReleaseNotesModal
          open={!!releaseInfo}
          onClose={() => setReleaseInfo(null)}
          currentVersion={releaseInfo.current}
          latestVersion={releaseInfo.latest}
          changelog={releaseInfo.changelog}
          url={releaseInfo.url}
        />
      )}

      {/* Cmd+K 命令面板 */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        contacts={allContacts}
        groups={allGroups}
        onContactClick={setSelectedContact}
        onGroupClick={setSelectedGroup}
        onTabChange={setActiveTab}
        dark={dark}
        onToggleDark={toggleDark}
      />

      {/* Contact Detail Modal */}
      <ContactModal
        contact={selectedContact}
        onClose={handleCloseModal}
        onGroupClick={(g) => { setSelectedContact(null); setSelectedGroup(g); }}
        onBlock={(username) => { addBlockedUser(username); }}
        onOpenSettings={() => { handleCloseModal(); setActiveTab('settings'); }}
      />

      {/* Group Detail Modal (triggered from contact modal) */}
      {selectedGroup && (
        <GroupDetailModal
          group={selectedGroup}
          onClose={() => setSelectedGroup(null)}
          allContacts={allContacts}
          onContactClick={(c) => { setSelectedGroup(null); setSelectedContact(c); }}
          onBlock={(username) => { addBlockedGroup(username); }}
          onOpenSettings={() => { setSelectedGroup(null); setActiveTab('settings'); }}
        />
      )}
    </div>
    </PrivacyModeContext.Provider>
    </SelfInfoProvider>
  );
}

function App() {
  return (
    <LockProvider>
      <AppInner />
      <LockOverlay />
    </LockProvider>
  );
}

export default App;
