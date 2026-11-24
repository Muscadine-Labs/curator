import { getAddress, isAddress } from 'viem';
import {
  getConfiguredVaultDisplayName,
  getVaultByAddress,
} from '@/lib/config/vaults';
import { getTreasuryWatchAddress } from '@/lib/constants/bots';
import { fetchTreasuryVaultTransfers } from '@/lib/morpho/treasury-transfers';

export type RebaterActivityItem = {
  hash: string;
  timestamp: number;
  from: string;
  to: string | null;
  vaultAddress: string;
  vaultName: string;
  assetSymbol: string;
  assetDecimals: number;
  assets: string | null;
  shares: string;
  type: 'Transfer' | 'Withdraw';
};

export type RebaterWatcher = {
  address: string;
  label: string;
  kind: 'treasury_safe';
};

export async function fetchRebaterActivity(limit: number): Promise<{
  watchers: RebaterWatcher[];
  items: RebaterActivityItem[];
  truncated: boolean;
  error: string | null;
}> {
  const treasury = getTreasuryWatchAddress();
  const { transfers, truncated, error } = await fetchTreasuryVaultTransfers();
  const outflows = transfers
    .filter((t) => t.direction === 'out')
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);

  const items: RebaterActivityItem[] = outflows.map((t) => {
    const cfg = getVaultByAddress(t.vaultAddress);
    return {
      hash: t.hash,
      timestamp: t.timestamp,
      from: getAddress(treasury),
      to: t.counterparty && isAddress(t.counterparty) ? getAddress(t.counterparty) : t.counterparty,
      vaultAddress: t.vaultAddress,
      vaultName: cfg ? getConfiguredVaultDisplayName(cfg) : t.assetSymbol,
      assetSymbol: t.assetSymbol,
      assetDecimals: t.assetDecimals,
      assets: t.assetsRaw,
      shares: t.sharesRaw,
      type: t.type === 'Withdraw' ? 'Withdraw' : 'Transfer',
    };
  });

  return {
    watchers: [
      {
        address: getAddress(treasury),
        label: 'Treasury Safe',
        kind: 'treasury_safe',
      },
    ],
    items,
    truncated,
    error,
  };
}
