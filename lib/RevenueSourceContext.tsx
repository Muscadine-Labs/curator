'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

export type RevenueSource = 'defillama' | 'treasury';

const RevenueSourceContext = createContext<{
  revenueSource: RevenueSource;
  setRevenueSource: (s: RevenueSource) => void;
} | null>(null);

export function RevenueSourceProvider({ children }: { children: ReactNode }) {
  const [revenueSource, setRevenueSource] = useState<RevenueSource>('defillama');
  return (
    <RevenueSourceContext.Provider value={{ revenueSource, setRevenueSource }}>
      {children}
    </RevenueSourceContext.Provider>
  );
}

export function useRevenueSource() {
  const ctx = useContext(RevenueSourceContext);
  return {
    revenueSource: ctx?.revenueSource ?? 'defillama',
    setRevenueSource: ctx?.setRevenueSource ?? (() => {}),
  };
}
