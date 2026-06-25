'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import SafeProvider, { useSafeAppsSDK } from '@safe-global/safe-apps-react-sdk';
import type SafeAppsSDK from '@safe-global/safe-apps-sdk';
import { getAddress, type Address } from 'viem';
import { getSafeByAddress, type SafeRole } from '@/lib/safe/config';

type CuratorSafeAppsContextValue = {
  connected: boolean;
  sdk: SafeAppsSDK | null;
  safeAddress: Address | null;
  safeRole: SafeRole | null;
};

const CuratorSafeAppsContext = createContext<CuratorSafeAppsContextValue>({
  connected: false,
  sdk: null,
  safeAddress: null,
  safeRole: null,
});

function CuratorSafeAppsBridge({ children }: { children: ReactNode }) {
  const { sdk, connected, safe } = useSafeAppsSDK();

  const value = useMemo((): CuratorSafeAppsContextValue => {
    if (!connected || !safe?.safeAddress) {
      return { connected: false, sdk: null, safeAddress: null, safeRole: null };
    }

    try {
      const safeAddress = getAddress(safe.safeAddress);
      const config = getSafeByAddress(safeAddress);
      return {
        connected: true,
        sdk,
        safeAddress,
        safeRole: config?.role ?? null,
      };
    } catch {
      return { connected: false, sdk: null, safeAddress: null, safeRole: null };
    }
  }, [connected, safe, sdk]);

  return (
    <CuratorSafeAppsContext.Provider value={value}>{children}</CuratorSafeAppsContext.Provider>
  );
}

export function CuratorSafeAppsProvider({ children }: { children: ReactNode }) {
  return (
    <SafeProvider>
      <CuratorSafeAppsBridge>{children}</CuratorSafeAppsBridge>
    </SafeProvider>
  );
}

export function useCuratorSafeApps() {
  return useContext(CuratorSafeAppsContext);
}

export function SafeAppModeBanner() {
  const { connected, safeAddress, safeRole } = useCuratorSafeApps();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted || !connected || !safeAddress) return null;

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-100">
      Running inside Safe App for{' '}
      <span className="font-mono text-xs">{safeAddress}</span>
      {safeRole ? ` (${safeRole})` : ''}. Queued txs can be sent through the Safe interface; this
      browser still keeps a local copy.
    </div>
  );
}
