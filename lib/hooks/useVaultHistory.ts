import { useQuery } from '@tanstack/react-query';
import type { VaultHistoryResponse } from '@/app/api/vaults/[id]/history/route';
import type { VaultHistorySeries } from '@/lib/morpho/vault-history';

const EMPTY_HISTORY_SERIES: VaultHistorySeries = {
  supplied: [],
  suppliedUsd: [],
  liquidityUsd: [],
  liquidity: [],
  apy: [],
  sharePrice: [],
  sharePriceUsd: [],
};

/** Backfill series added after initial deploy (stale React Query / CDN cache). */
export function normalizeVaultHistoryResponse(
  data: VaultHistoryResponse
): VaultHistoryResponse {
  return {
    ...data,
    series: { ...EMPTY_HISTORY_SERIES, ...data.series },
  };
}

async function fetchVaultHistory(vaultAddress: string): Promise<VaultHistoryResponse> {
  const res = await fetch(`/api/vaults/${vaultAddress}/history`, { credentials: 'omit' });
  if (!res.ok) {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      throw new Error(json.message || json.error || 'Failed to fetch vault history');
    } catch {
      throw new Error(text || 'Failed to fetch vault history');
    }
  }
  const json = (await res.json()) as VaultHistoryResponse;
  return normalizeVaultHistoryResponse(json);
}

export function useVaultHistory(vaultAddress: string | null | undefined) {
  return useQuery({
    queryKey: ['vault-history', vaultAddress, 'share-price-v1'],
    queryFn: () => {
      if (!vaultAddress) throw new Error('Vault address is required');
      return fetchVaultHistory(vaultAddress);
    },
    enabled: Boolean(vaultAddress),
    staleTime: 120_000,
  });
}
