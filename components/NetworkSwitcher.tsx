'use client';

import { ChevronDown } from 'lucide-react';
import { CURATOR_MARKET_NETWORKS } from '@/lib/constants';
import { useCuratorNetwork } from '@/lib/network/CuratorNetworkContext';
import { cn } from '@/lib/utils';

type NetworkSwitcherProps = {
  className?: string;
  /** Stretch to container width (account sheet). */
  fullWidth?: boolean;
};

/** App network. Base is the only choice, so this is a label, not a menu. */
export function NetworkSwitcher({ className, fullWidth = false }: NetworkSwitcherProps) {
  const { chainId, setChainId, isWalletOnSelectedChain, networkName } = useCuratorNetwork();

  if (CURATOR_MARKET_NETWORKS.length < 2) {
    return (
      <div className={cn(fullWidth && 'w-full', className)}>
        <p
          className={cn(
            'flex items-center rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100',
            fullWidth ? 'h-11' : 'h-9 px-2.5 text-xs'
          )}
        >
          {networkName}
        </p>
        {!isWalletOnSelectedChain ? (
          <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-400">
            Wallet not on {networkName} — switch wallet chain to sign.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={cn('relative', fullWidth && 'w-full', className)}>
      <select
        aria-label="Network"
        value={chainId}
        onChange={(e) => {
          void setChainId(Number(e.target.value));
        }}
        className={cn(
          'appearance-none rounded-md border border-slate-200 bg-white py-2 pl-3 pr-9 text-sm font-medium text-slate-800 shadow-sm',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100',
          fullWidth ? 'h-11 min-h-[44px] w-full touch-manipulation' : 'h-9 py-1 pl-2.5 pr-8 text-xs',
          !isWalletOnSelectedChain && 'border-amber-400 dark:border-amber-500'
        )}
      >
        {CURATOR_MARKET_NETWORKS.map((n) => (
          <option key={n.chainId} value={n.chainId}>
            {n.name}
          </option>
        ))}
      </select>
      <ChevronDown
        className={cn(
          'pointer-events-none absolute top-1/2 -translate-y-1/2 text-slate-400',
          fullWidth ? 'right-3 h-4 w-4' : 'right-2 h-3.5 w-3.5'
        )}
      />
      {!isWalletOnSelectedChain ? (
        <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-400">
          Wallet not on {networkName} — switch wallet chain to sign.
        </p>
      ) : null}
    </div>
  );
}
