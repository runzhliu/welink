/**
 * 设置页 — 拆分版（按分类）
 *
 * 结构：
 *  - 左栏：2 级导航（分组 → section），从 nav.ts 自动生成
 *  - 主区：每个 section 是独立组件，按 nav.ts 中的顺序渲染
 *  - 搜索框：根据 section 的 data-settings-tags + 文本内容过滤
 *
 * 各 section 自管 state；本组件只负责：搜索/导航联动、props 透传、restart 全屏 UI。
 */

import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { ContactStats, GroupInfo } from '../../types';
import { SECTION_GROUPS, SECTIONS } from './nav';

// 通用 / 隐私
import { RecordingSection } from './privacy/RecordingSection';
import { DisplaySection } from './display/DisplaySection';
import { BlockedSection } from './privacy/BlockedSection';
import { LockSection } from './privacy/LockSection';
// AI
import { AIConfigGroup } from './ai/AIConfigGroup';
import { PromptTemplateSection } from './ai/PromptTemplateSection';
import { TtsSection } from './ai/TtsSection';
// 数据
import { DataProfilesSection } from './system/DataProfilesSection';
import { AIBackupSection } from './system/AIBackupSection';
import { ForecastIgnoreSection } from './system/ForecastIgnoreSection';
import { PreferencesSection } from './system/PreferencesSection';
// 系统
import { BasicConfigSection } from './system/BasicConfigSection';
import { AppConfigSection } from './system/AppConfigSection';
import { MobilePairingSection } from '../common/MobilePairingSection';
import { DiagnosticsSection } from './support/DiagnosticsSection';
import { UsageSection } from './support/UsageSection';
import { AboutSection } from './support/AboutSection';

// 共享 localStorage key —— GroupsView.tsx 还在用
export {
  MEMBER_RANK_LIMIT_KEY,
  MEMBER_NAME_WIDTH_KEY,
  DEFAULT_RANK_LIMIT,
  DEFAULT_NAME_WIDTH,
} from './constants';

interface SettingsPageProps {
  isAppMode: boolean;
  appVersion?: string;
  blockedUsers: string[];
  blockedGroups: string[];
  onAddBlockedUser: (v: string) => void;
  onRemoveBlockedUser: (v: string) => void;
  onAddBlockedGroup: (v: string) => void;
  onRemoveBlockedGroup: (v: string) => void;
  allContacts?: ContactStats[];
  allGroups?: GroupInfo[];
  privacyMode?: boolean;
  onTogglePrivacyMode?: (v: boolean) => void;
  dark?: boolean;
  onToggleDark?: () => void;
  fontSize?: number;
  onFontSizeChange?: (size: number) => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  isAppMode,
  appVersion,
  blockedUsers,
  blockedGroups,
  onAddBlockedUser,
  onRemoveBlockedUser,
  onAddBlockedGroup,
  onRemoveBlockedGroup,
  allContacts = [],
  allGroups = [],
  privacyMode = false,
  onTogglePrivacyMode,
  dark = false,
  onToggleDark,
  fontSize = 16,
  onFontSizeChange,
}) => {
  const [settingsQuery, setSettingsQuery] = useState('');
  const settingsRootRef = useRef<HTMLDivElement | null>(null);

  // 搜索：扫描所有 [data-settings-tags] section，根据 tags + 文本内容过滤
  useEffect(() => {
    const root = settingsRootRef.current;
    if (!root) return;
    const q = settingsQuery.trim().toLowerCase();
    const sections = root.querySelectorAll<HTMLElement>('[data-settings-tags]');
    sections.forEach(s => {
      const tags = (s.dataset.settingsTags || '').toLowerCase();
      // 不光搜 tags，也搜 section 内部的文本（隐私屏蔽里的姓名字段除外）
      const text = tags + ' ' + (s.textContent || '').toLowerCase();
      s.style.display = !q || text.includes(q) ? '' : 'none';
    });
  }, [settingsQuery]);

  const visibleSections = SECTIONS.filter(s => !s.appOnly || isAppMode);

  // 滚动定位
  const jumpToSection = (sectionId: string) => {
    const el = settingsRootRef.current?.querySelector<HTMLElement>(`[data-section-id="${sectionId}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // IntersectionObserver 高亮当前 section
  const [activeSectionId, setActiveSectionId] = useState<string>('');
  useEffect(() => {
    const root = settingsRootRef.current;
    if (!root) return;
    const sectionEls: { id: string; el: HTMLElement }[] = [];
    for (const s of visibleSections) {
      const el = root.querySelector<HTMLElement>(`[data-section-id="${s.id}"]`);
      if (el) sectionEls.push({ id: s.id, el });
    }
    if (sectionEls.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .map(e => ({ id: sectionEls.find(s => s.el === e.target)?.id ?? '', y: (e.target as HTMLElement).offsetTop }))
          .filter(x => x.id !== '')
          .sort((a, b) => a.y - b.y);
        if (visible.length > 0) setActiveSectionId(visible[0].id);
      },
      { rootMargin: '-20% 0px -60% 0px', threshold: 0 }
    );
    sectionEls.forEach(s => io.observe(s.el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAppMode]);

  // App 重启：AppConfigSection 触发后，整页切到等待状态
  const [restarting, setRestarting] = useState(false);
  if (restarting) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 text-gray-500 dark:text-gray-400">
        <CheckCircle2 size={40} className="text-[#07c160]" />
        <p className="font-semibold text-[#1d1d1f] dk-text">配置已保存，应用正在重启…</p>
        <p className="text-sm text-gray-400">稍后新窗口会自动打开</p>
      </div>
    );
  }

  // 按 section id 渲染对应组件 —— 让"渲染顺序"和"导航顺序"共享 nav.ts 的单一事实源
  const renderSection = (id: string) => {
    switch (id) {
      case 'recording':
        return <RecordingSection key={id} privacyMode={privacyMode} onTogglePrivacyMode={onTogglePrivacyMode} />;
      case 'display':
        return <DisplaySection key={id} dark={dark} onToggleDark={onToggleDark} fontSize={fontSize} onFontSizeChange={onFontSizeChange} />;
      case 'ai-config':
        return <AIConfigGroup key={id} />;
      case 'prompt':
        return <PromptTemplateSection key={id} />;
      case 'tts':
        return <TtsSection key={id} />;
      case 'blocked':
        return (
          <BlockedSection
            key={id}
            blockedUsers={blockedUsers}
            blockedGroups={blockedGroups}
            onAddBlockedUser={onAddBlockedUser}
            onRemoveBlockedUser={onRemoveBlockedUser}
            onAddBlockedGroup={onAddBlockedGroup}
            onRemoveBlockedGroup={onRemoveBlockedGroup}
            allContacts={allContacts}
            allGroups={allGroups}
            privacyMode={privacyMode}
          />
        );
      case 'lock':
        return <LockSection key={id} />;
      case 'profiles':
        return <DataProfilesSection key={id} isAppMode={isAppMode} />;
      case 'backup':
        return <AIBackupSection key={id} isAppMode={isAppMode} />;
      case 'forecast':
        return <ForecastIgnoreSection key={id} allContacts={allContacts} privacyMode={privacyMode} />;
      case 'preferences':
        return <PreferencesSection key={id} />;
      case 'basic':
        return <BasicConfigSection key={id} />;
      case 'app':
        return <AppConfigSection key={id} onRestartStart={() => setRestarting(true)} />;
      case 'mobile':
        return <MobilePairingSection key={id} />;
      case 'diag':
        return <DiagnosticsSection key={id} appVersion={appVersion} />;
      case 'usage':
        return <UsageSection key={id} />;
      case 'about':
        return <AboutSection key={id} isAppMode={isAppMode} appVersion={appVersion} />;
      default:
        return null;
    }
  };

  return (
    <div className="lg:flex lg:gap-6" ref={settingsRootRef}>
      {/* 左栏导航（lg+ sticky）—— 按 group 分组展示 */}
      <aside className="hidden lg:block w-48 flex-shrink-0 sticky top-0 self-start pt-2 pb-6 max-h-[calc(100vh-2rem)] overflow-y-auto">
        <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2 px-2">设置目录</div>
        <nav className="flex flex-col gap-3">
          {SECTION_GROUPS.map(g => {
            const groupSections = visibleSections.filter(s => s.groupId === g.id);
            if (groupSections.length === 0) return null;
            return (
              <div key={g.id}>
                <div className="text-[10px] font-bold text-gray-400 px-2.5 py-1 uppercase tracking-wider">
                  {g.title}
                </div>
                <div className="flex flex-col gap-0.5">
                  {groupSections.map(s => {
                    const active = activeSectionId === s.id;
                    return (
                      <button
                        key={s.id}
                        onClick={() => jumpToSection(s.id)}
                        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-left transition-colors ${
                          active
                            ? 'bg-[#07c160]/10 text-[#07c160]'
                            : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-700 dk-text'
                        }`}
                      >
                        <span className={`w-1 h-4 rounded-full transition-colors ${active ? 'bg-[#07c160]' : 'bg-transparent'}`} />
                        {s.title}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
      </aside>

      {/* 主内容区 */}
      <div className="max-w-2xl flex-1 min-w-0">
        <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
          <h2 className="text-2xl font-black text-[#1d1d1f] dk-text">设置</h2>
          <div className="relative flex-1 max-w-xs">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" strokeLinecap="round" />
            </svg>
            <input
              value={settingsQuery}
              onChange={e => setSettingsQuery(e.target.value)}
              placeholder="搜索设置项…（例：下载 / 诊断 / LLM）"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-[#f8f9fb] dk-input focus:outline-none focus:border-[#07c160]"
            />
          </div>
        </div>

        {/* 小屏兼容：横向快速跳转栏（sticky，lg+ 隐藏） */}
        <div className="lg:hidden sticky top-0 z-10 bg-white dark:bg-[#1c1c1e] -mx-2 px-2 py-2 mb-6 border-b border-gray-100 dark:border-white/5 overflow-x-auto whitespace-nowrap">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-bold text-gray-400 flex-shrink-0">快速跳转</span>
            {visibleSections.map(s => (
              <button
                key={s.id}
                onClick={() => jumpToSection(s.id)}
                className="flex-shrink-0 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-gray-400 hover:bg-[#07c160]/10 hover:text-[#07c160] transition-colors"
              >
                {s.title}
              </button>
            ))}
          </div>
        </div>

        {/* 按 nav.ts 顺序渲染所有 section */}
        {visibleSections.map(s => renderSection(s.id))}
      </div>
    </div>
  );
};
