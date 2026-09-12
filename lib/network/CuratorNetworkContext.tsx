'use client';

import {
  createContext,
  useCallback,
  useContext,
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

type CuratorNetworkContextValue = {
  chainId: number;
  networkName: string;
  setChainId: (chainId: number) => Promise<void>;
  isWalletOnSelectedChain: boolean;
  /** True when the selected network is ready for fetches. Always Base on load. */
  ready: boolean;
};

const CuratorNetworkContext = createContext<CuratorNetworkContextValue | null>(null);

export function CuratorNetworkProvider({ children }: { children: ReactNode }) {
  const { isConnected } = useAccount();
  const walletChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  // Always start on Base. Explicit NetworkSwitcher changes last for this session only.
  const [chainId, setChainIdState] = useState(BASE_CHAIN_ID);

  // Preference drives browsing; wallet switch only on explicit NetworkSwitcher change
  // (setChainId). Do not auto-prompt switchChain on connect/mismatch — that spams wallets.
  const setChainId = useCallback(
    async (nextRaw: number) => {
      const next = parseCuratorMarketChainId(String(nextRaw));
      setChainIdState(next);
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
      ready: true,
    }),
    [chainId, networkName, setChainId, isConnected, walletChainId]
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
