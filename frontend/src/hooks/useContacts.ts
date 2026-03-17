/**
 * 联系人数据 Hook
 */

import { useState, useEffect, useCallback } from 'react';
import { contactsApi } from '../services/api';
import type { ContactStats, WordCount } from '../types';

export const useContacts = (autoRefresh = true, interval = 15000) => {
  const [contacts, setContacts] = useState<ContactStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchContacts = useCallback(async () => {
    try {
      setLoading(true);
      const data = await contactsApi.getStats();
      setContacts(data ?? []);
      setError(null);
    } catch (err) {
      setError(err as Error);
      console.error('Failed to fetch contacts:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContacts();

    if (autoRefresh) {
      const timer = setInterval(fetchContacts, interval);
      return () => clearInterval(timer);
    }
  }, [fetchContacts, autoRefresh, interval]);

  return {
    contacts,
    loading,
    error,
    refresh: fetchContacts,
  };
};

export const useWordCloud = () => {
  const [data, setData] = useState<WordCount[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchWordCloud = useCallback(async (username: string, includeMine = false) => {
    try {
      setLoading(true);
      setData([]);
      const result = await contactsApi.getWordCloud(username, includeMine);
      setData(result || []);
      setError(null);
    } catch (err) {
      setError(err as Error);
      console.error('Failed to fetch word cloud:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    data,
    loading,
    error,
    fetch: fetchWordCloud,
  };
};
