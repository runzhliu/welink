import { createContext, useContext } from 'react';
import type { SelfInfo } from '../services/appApi';

const SelfInfoContext = createContext<SelfInfo | null>(null);

export const SelfInfoProvider = SelfInfoContext.Provider;

export function useSelfInfo(): SelfInfo | null {
  return useContext(SelfInfoContext);
}
