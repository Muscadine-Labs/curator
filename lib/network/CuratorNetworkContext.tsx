'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useAccount, useChainId, useSwitchChain } from 'wagmi';
import {
  BASE_CHAIN_ID,
  CURATOR_MARKET_NETWORKS,
  parseCuratorMarketChainId,
} from '@/lib/constants';

const STORAGE_KEY = 'curator-preferred-chain-id';

type CuratorNetworkContextValue = {
  chainId: number;
  networkName: string;
  setChainId: (chainId: number) => Promise<void>;
  isWalletOnSelectedChain: boolean;
  /** True after localStorage preference has been applied (avoids Base flash fetch). */
  ready: boolean;
};

const CuratorNetworkContext = createContext<CuratorNetworkContextValue | null>(null);

function readStoredChainId(): number {
  if (typeof window === 'undefined') return BASE_CHAIN_ID;
  try {
    return parseCuratorMarketChainId(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return BASE_CHAIN_ID;
  }
}

function persistChainId(chainId: number) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(chainId));
  } catch {
    /* ignore quota / private mode */
  }
}

export function CuratorNetworkProvider({ children }: { children: ReactNode }) {
  const { isConnected } = useAccount();
  const walletChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  // SSR + first client paint always Base to avoid hydration mismatch.
  const [chainId, setChainIdState] = useState(BASE_CHAIN_ID);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setChainIdState(readStoredChainId());
    setReady(true);
  }, []);

  // Preference drives browsing; wallet switch only on explicit NetworkSwitcher change
  // (setChainId). Do not auto-prompt switchChain on connect/mismatch — that spams wallets.
  const setChainId = useCallback(
    async (nextRaw: number) => {
      const next = parseCuratorMarketChainId(String(nextRaw));
      setChainIdState(next);
      persistChainId(next);
      if (isConnected && walletChainId !== next) {
        try {
          await switchChainAsync({ chainId: next });
        } catch {
          // Preference still updates for browsing / form; wallet may reject switch.
        }
      }
    },
    [isConnected, switchChainAsync, walletChainId]
  );

  const networkName =
    CURATOR_MARKET_NETWORKS.find((n) => n.chainId === chainId)?.name ?? 'network';

  const value = useMemo<CuratorNetworkContextValue>(
    () => ({
      chainId,
      networkName,
      setChainId,
      isWalletOnSelectedChain: !isConnected || walletChainId === chainId,
      ready,
    }),
    [chainId, networkName, setChainId, isConnected, walletChainId, ready]
  );

  return (
    <CuratorNetworkContext.Provider value={value}>
      {children}
    </CuratorNetworkContext.Provider>
  );
}

export function useCuratorNetwork(): CuratorNetworkContextValue {
  const ctx = useContext(CuratorNetworkContext);
  if (!ctx) {
    throw new Error('useCuratorNetwork must be used within CuratorNetworkProvider');
  }
  return ctx;
}
