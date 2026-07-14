'use client';

import { ChevronDown } from 'lucide-react';
import { CURATOR_MARKET_NETWORKS } from '@/lib/constants';
import { useCuratorNetwork } from '@/lib/network/CuratorNetworkContext';
import { cn } from '@/lib/utils';

type NetworkSwitcherProps = {
  className?: string;
};

/** App network preference — works without a connected wallet. */
export function NetworkSwitcher({ className }: NetworkSwitcherProps) {
  const { chainId, setChainId, isWalletOnSelectedChain } = useCuratorNetwork();

  return (
    <div className={cn('relative', className)}>
      <select
        aria-label="Network"
        value={chainId}
        onChange={(e) => {
          void setChainId(Number(e.target.value));
        }}
        className={cn(
          'h-9 appearance-none rounded-md border border-slate-200 bg-white py-1 pl-2.5 pr-8 text-xs font-medium text-slate-800 shadow-sm',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100',
          !isWalletOnSelectedChain && 'border-amber-400 dark:border-amber-500'
        )}
      >
        {CURATOR_MARKET_NETWORKS.map((n) => (
          <option key={n.chainId} value={n.chainId}>
            {n.name}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
    </div>
  );
}
