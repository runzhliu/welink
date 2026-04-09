/**
 * WeLink - 微信聊天数据分析平台
 * 重构版本 - 组件化 + 微信风格设计
 */

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { PrivacyModeContext } from './contexts/PrivacyModeContext';

// Layout Components
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';

// Dashboard Components
import { AIHomePage } from './components/dashboard/AIHomePage';
import { StatsPage } from './components/dashboard/StatsPage';
import { ContactsPage } from './components/dashboard/ContactsPage';
import { URLCollectionPage } from './components/dashboard/URLCollectionPage';
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

function App() {
  const { dark, toggle: toggleDark } = useDarkMode();

  // 全局字号（rem 基准，默认 16px）
  const [fontSize, setFontSize] = useState(() => Number(localStorage.getItem('welink_fontSize')) || 16);
  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}px`;
    localStorage.setItem('welink_fontSize', String(fontSize));
  }, [fontSize]);

  // State — 从 URL hash 恢复当前 tab + 联系人/群聊弹窗
  // hash 格式：#/stats  #/stats/contact/wxid_abc  #/groups/group/xxx@chatroom
  const VALID_TABS: TabType[] = ['dashboard', 'stats', 'contacts', 'db', 'groups', 'search', 'timeline', 'calendar', 'anniversary', 'urls', 'skills', 'settings'];

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


  // App 模式检测
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  // Backend Status Hook
  const { isInitialized, isIndexing, backendReady, startPolling } = useBackendStatus(1000);

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

  // 后端就绪后获取 App 模式信息
  useEffect(() => {
    if (backendReady) {
      appApi.getInfo().then(setAppInfo).catch(() => setAppInfo({ app_mode: false, needs_setup: false, ready: true }));
    }
  }, [backendReady]);

  // 后端重启后自动重新触发索引（localStorage 有记录但后端尚未索引）
  useEffect(() => {
    if (backendReady && hasStarted && !isInitialized && !isIndexing && !initLoading) {
      globalApi.init(timeRange.from, timeRange.to).then(() => startPolling()).catch(console.error);
    }
  }, [backendReady]);

  // 后端未连通时等待
  if (!backendReady) {
    return <InitializingScreen message="正在连接后端服务..." />;
  }

  // 等待 app info 加载
  if (!appInfo) {
    return <InitializingScreen message="正在检测配置..." />;
  }

  // App 模式且未配置：显示 Setup 页面
  if (appInfo.app_mode && appInfo.needs_setup) {
    return (
      <AppSetupPage
        onSetupComplete={() => setAppInfo({ ...appInfo, needs_setup: false, ready: true })}
      />
    );
  }

  // 用户还没选时间范围，或主动点了「重新选择」
  if (!hasStarted) {
    return <WelcomePage onStart={handleStart} loading={initLoading} isAppMode={appInfo.app_mode} />;
  }

  // 已选择时间范围，等待索引完成
  if (!isInitialized || isIndexing) {
    return <InitializingScreen message={`正在建立索引（${timeRange.label}）...`} />;
  }

  return (
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
  );
}

export default App;
