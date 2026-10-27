'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { useCuratorAuth } from '@/lib/auth/CuratorAuthContext';

export type RevenueSource = 'defillama' | 'treasury';

const RevenueSourceContext = createContext<{
  revenueSource: RevenueSource;
  setRevenueSource: (s: RevenueSource) => void;
} | null>(null);

export function RevenueSourceProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useCuratorAuth();
  const [revenueSource, setRevenueSource] = useState<RevenueSource>('treasury');
  const shown: RevenueSource = isAuthenticated ? revenueSource : 'defillama';
  return (
    <RevenueSourceContext.Provider value={{ revenueSource: shown, setRevenueSource }}>
      {children}
    </RevenueSourceContext.Provider>
  );
}

export function useRevenueSource() {
  const ctx = useContext(RevenueSourceContext);
  return {
    revenueSource: ctx?.revenueSource ?? 'treasury',
    setRevenueSource: ctx?.setRevenueSource ?? (() => {}),
  };
}
