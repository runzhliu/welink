/**
 * 隐私屏蔽设置 Hook
 * 屏蔽名单持久化在后端 preferences.json，App 和 Docker 模式行为一致。
 */

import { useState, useCallback, useEffect } from 'react';
import axios from 'axios';

interface Preferences {
  blocked_users: string[];
  blocked_groups: string[];
  privacy_mode?: boolean;
}

async function fetchPreferences(): Promise<Preferences> {
  const r = await axios.get<Preferences>('/api/preferences');
  return r.data;
}

async function putPreferences(p: Preferences): Promise<void> {
  await axios.put('/api/preferences', p);
}

export function usePrivacySettings() {
  const [blockedUsers, setBlockedUsers] = useState<string[]>([]);
  const [blockedGroups, setBlockedGroups] = useState<string[]>([]);
  const [privacyMode, setPrivacyModeState] = useState(false);

  // 初始化：从后端加载
  useEffect(() => {
    fetchPreferences().then((p) => {
      setBlockedUsers(p.blocked_users ?? []);
      setBlockedGroups(p.blocked_groups ?? []);
      setPrivacyModeState(p.privacy_mode ?? false);
    }).catch(() => {});
  }, []);

  const addBlockedUser = useCallback((value: string) => {
    const v = value.trim();
    if (!v) return;
    setBlockedUsers((prev) => {
      if (prev.includes(v)) return prev;
      const next = [...prev, v];
      putPreferences({ blocked_users: next, blocked_groups: blockedGroups, privacy_mode: privacyMode }).catch(() => {});
      return next;
    });
  }, [blockedGroups, privacyMode]);

  const removeBlockedUser = useCallback((value: string) => {
    setBlockedUsers((prev) => {
      const next = prev.filter((x) => x !== value);
      putPreferences({ blocked_users: next, blocked_groups: blockedGroups, privacy_mode: privacyMode }).catch(() => {});
      return next;
    });
  }, [blockedGroups, privacyMode]);

  const addBlockedGroup = useCallback((value: string) => {
    const v = value.trim();
    if (!v) return;
    setBlockedGroups((prev) => {
      if (prev.includes(v)) return prev;
      const next = [...prev, v];
      putPreferences({ blocked_users: blockedUsers, blocked_groups: next, privacy_mode: privacyMode }).catch(() => {});
      return next;
    });
  }, [blockedUsers, privacyMode]);

  const removeBlockedGroup = useCallback((value: string) => {
    setBlockedGroups((prev) => {
      const next = prev.filter((x) => x !== value);
      putPreferences({ blocked_users: blockedUsers, blocked_groups: next, privacy_mode: privacyMode }).catch(() => {});
      return next;
    });
  }, [blockedUsers, privacyMode]);

  const setPrivacyMode = useCallback((value: boolean) => {
    setPrivacyModeState(value);
    putPreferences({ blocked_users: blockedUsers, blocked_groups: blockedGroups, privacy_mode: value }).catch(() => {});
  }, [blockedUsers, blockedGroups]);

  return {
    blockedUsers,
    blockedGroups,
    privacyMode,
    setPrivacyMode,
    addBlockedUser,
    removeBlockedUser,
    addBlockedGroup,
    removeBlockedGroup,
  };
}
