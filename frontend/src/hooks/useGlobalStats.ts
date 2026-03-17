/**
 * 全局统计数据 Hook
 */

import { useState, useEffect, useCallback } from 'react';
import { globalApi } from '../services/api';
import type { GlobalStats } from '../types';

export const useGlobalStats = (autoRefresh = true, interval = 15000) => {
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true);
      const data = await globalApi.getStats();
      setStats(data);
      setError(null);
    } catch (err) {
      setError(err as Error);
      console.error('Failed to fetch global stats:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();

    if (autoRefresh) {
      const timer = setInterval(fetchStats, interval);
      return () => clearInterval(timer);
    }
  }, [fetchStats, autoRefresh, interval]);

  return {
    stats,
    loading,
    error,
    refresh: fetchStats,
  };
};
