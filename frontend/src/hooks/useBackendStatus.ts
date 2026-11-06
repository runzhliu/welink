/**
 * 后端状态监控 Hook
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { globalApi } from '../services/api';
import type { BackendStatus } from '../types';

export const useBackendStatus = (pollInterval = 1000) => {
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [backendReady, setBackendReady] = useState(false); // 后端可连通
  const [error, setError] = useState<Error | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const interval = status?.is_initialized && !status?.is_indexing ? Math.max(5000, pollInterval) : pollInterval;

  const fetchStatus = useCallback(async () => {
    try {
      const data = await globalApi.getStatus();
      setStatus(data);
      setBackendReady(true);
      setError(null);

    } catch (err) {
      setError(err as Error);
      setBackendReady(false);
      console.error('Failed to fetch backend status:', err);
    }
  }, []);

  const startPolling = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    void fetchStatus();
    timerRef.current = setInterval(fetchStatus, pollInterval);
  }, [fetchStatus, pollInterval]);

  useEffect(() => {
    fetchStatus();
    timerRef.current = setInterval(fetchStatus, interval);
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [fetchStatus, interval]);

  return {
    status,
    error,
    backendReady,
    startPolling,
    isInitialized: status?.is_initialized ?? false,
    isIndexing: status?.is_indexing ?? false,
    totalCached: status?.total_cached ?? 0,
    progress: status?.progress,
    lastError: status?.last_error,
  };
};
