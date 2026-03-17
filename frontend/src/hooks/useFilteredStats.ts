import { useState, useEffect, useRef } from 'react';
import type { FilteredStats, TimeRange } from '../types';
import { statsApi } from '../services/api';

export function useFilteredStats(isInitialized: boolean, timeRange: TimeRange) {
  const [data, setData] = useState<FilteredStats | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isInitialized) return;

    // Cancel previous request
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setLoading(true);
    statsApi
      .filter(timeRange.from, timeRange.to)
      .then((result) => {
        setData(result);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [isInitialized, timeRange.from, timeRange.to]);

  return { data, loading };
}
