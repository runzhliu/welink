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

  const fetchStatus = useCallback(async () => {
    try {
      const data = await globalApi.getStatus();
      setStatus(data);
      setBackendReady(true);
      setError(null);

      // 初始化完成后停止轮询
      if (data.is_initialized) {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      }
    } catch (err) {
      setError(err as Error);
      console.error('Failed to fetch backend status:', err);
    }
  }, []);

  const startPolling = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(fetchStatus, pollInterval);
  }, [fetchStatus, pollInterval]);

  useEffect(() => {
    fetchStatus();
    timerRef.current = setInterval(fetchStatus, pollInterval);
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [fetchStatus, pollInterval]);

  return {
    status,
    error,
    backendReady,
    startPolling,
    isInitialized: status?.is_initialized ?? false,
    isIndexing: status?.is_indexing ?? false,
    totalCached: status?.total_cached ?? 0,
  };
};
