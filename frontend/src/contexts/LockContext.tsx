import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import axios from 'axios';

export type AutoLockMinutes = 0 | 30 | 60 | 120;

interface LockContextValue {
  enabled: boolean;
  locked: boolean;
  autoLockMinutes: AutoLockMinutes;
  lockOnStartup: boolean;
  loading: boolean;

  lock: () => void;
  unlock: (pin: string) => Promise<boolean>;
  setupPin: (pin: string) => Promise<{ ok: boolean; error?: string }>;
  changePin: (oldPin: string, newPin: string) => Promise<{ ok: boolean; error?: string }>;
  disable: (pin: string) => Promise<boolean>;
  updateSettings: (autoLockMinutes: AutoLockMinutes, lockOnStartup: boolean) => Promise<void>;
  refresh: () => Promise<void>;
}

const LOCK_STATE_KEY = 'welink_lock_locked';

const LockContext = createContext<LockContextValue>({
  enabled: false,
  locked: false,
  autoLockMinutes: 0,
  lockOnStartup: false,
  loading: true,
  lock: () => {},
  unlock: async () => false,
  setupPin: async () => ({ ok: false }),
  changePin: async () => ({ ok: false }),
  disable: async () => false,
  updateSettings: async () => {},
  refresh: async () => {},
});

export function useLock() {
  return useContext(LockContext);
}

export function LockProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  const [autoLockMinutes, setAutoLockMinutes] = useState<AutoLockMinutes>(0);
  const [lockOnStartup, setLockOnStartup] = useState(false);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const lastActivityRef = useRef(Date.now());
  const startupHandledRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const r = await axios.get<{ enabled: boolean; auto_lock_minutes: number; lock_on_startup: boolean }>(
        '/api/lock/status'
      );
      const m = (r.data.auto_lock_minutes as AutoLockMinutes) ?? 0;
      setEnabled(r.data.enabled);
      setAutoLockMinutes([0, 30, 60, 120].includes(m) ? m : 0);
      setLockOnStartup(!!r.data.lock_on_startup);
    } catch {
      // 未初始化或后端不通，保持禁用状态
    } finally {
      setLoading(false);
    }
  }, []);

  // 初次加载
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 启动/恢复时决定初始锁定状态
  useEffect(() => {
    if (loading || startupHandledRef.current) return;
    startupHandledRef.current = true;
    if (!enabled) {
      setLocked(false);
      sessionStorage.removeItem(LOCK_STATE_KEY);
      return;
    }
    // 已启用 PIN 时：lockOnStartup=true 每次启动都锁；否则沿用 sessionStorage 里的状态
    if (lockOnStartup) {
      setLocked(true);
      sessionStorage.setItem(LOCK_STATE_KEY, '1');
    } else {
      setLocked(sessionStorage.getItem(LOCK_STATE_KEY) === '1');
    }
  }, [loading, enabled, lockOnStartup]);

  const lock = useCallback(() => {
    if (!enabled) return;
    setLocked(true);
    sessionStorage.setItem(LOCK_STATE_KEY, '1');
  }, [enabled]);

  const unlock = useCallback(async (pin: string) => {
    try {
      const r = await axios.post<{ ok: boolean }>('/api/lock/verify', { pin });
      if (r.data.ok) {
        setLocked(false);
        sessionStorage.removeItem(LOCK_STATE_KEY);
        lastActivityRef.current = Date.now();
      }
      return r.data.ok;
    } catch {
      return false;
    }
  }, []);

  const setupPin = useCallback(async (pin: string) => {
    try {
      await axios.post('/api/lock/setup', { pin });
      await refresh();
      return { ok: true };
    } catch (e: unknown) {
      const anyE = e as { response?: { data?: { error?: string } }; message?: string };
      return { ok: false, error: anyE?.response?.data?.error || anyE?.message || '设置失败' };
    }
  }, [refresh]);

  const changePin = useCallback(async (oldPin: string, newPin: string) => {
    try {
      const r = await axios.post<{ ok: boolean }>('/api/lock/change', {
        old_pin: oldPin,
        new_pin: newPin,
      });
      return { ok: r.data.ok, error: r.data.ok ? undefined : '旧 PIN 错误' };
    } catch (e: unknown) {
      const anyE = e as { response?: { data?: { error?: string } }; message?: string };
      return { ok: false, error: anyE?.response?.data?.error || anyE?.message || '修改失败' };
    }
  }, []);

  const disable = useCallback(async (pin: string) => {
    try {
      const r = await axios.post<{ ok: boolean }>('/api/lock/disable', { pin });
      if (r.data.ok) {
        setLocked(false);
        sessionStorage.removeItem(LOCK_STATE_KEY);
        await refresh();
      }
      return r.data.ok;
    } catch {
      return false;
    }
  }, [refresh]);

  const updateSettings = useCallback(async (m: AutoLockMinutes, onStartup: boolean) => {
    await axios.put('/api/lock/settings', {
      auto_lock_minutes: m,
      lock_on_startup: onStartup,
    });
    setAutoLockMinutes(m);
    setLockOnStartup(onStartup);
  }, []);

  // 空闲检测：监听用户活动，超过 autoLockMinutes 未活动就自动锁
  useEffect(() => {
    if (!enabled || autoLockMinutes === 0 || locked) return;

    const touch = () => {
      lastActivityRef.current = Date.now();
    };
    const events: (keyof WindowEventMap)[] = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'];
    events.forEach((ev) => window.addEventListener(ev, touch, { passive: true }));

    const timeoutMs = autoLockMinutes * 60 * 1000;
    const tick = setInterval(() => {
      if (Date.now() - lastActivityRef.current >= timeoutMs) {
        setLocked(true);
        sessionStorage.setItem(LOCK_STATE_KEY, '1');
      }
    }, 15_000); // 15s 粒度，对一小时/两小时的 idle 够用

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, touch));
      clearInterval(tick);
    };
  }, [enabled, autoLockMinutes, locked]);

  return (
    <LockContext.Provider
      value={{
        enabled,
        locked,
        autoLockMinutes,
        lockOnStartup,
        loading,
        lock,
        unlock,
        setupPin,
        changePin,
        disable,
        updateSettings,
        refresh,
      }}
    >
      {children}
    </LockContext.Provider>
  );
}
