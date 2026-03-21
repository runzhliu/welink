import { createContext, useContext } from 'react';

interface PrivacyModeContextValue {
  privacyMode: boolean;
  setPrivacyMode: (v: boolean) => void;
}

export const PrivacyModeContext = createContext<PrivacyModeContextValue>({
  privacyMode: false,
  setPrivacyMode: () => {},
});

export function usePrivacyMode() {
  return useContext(PrivacyModeContext);
}
