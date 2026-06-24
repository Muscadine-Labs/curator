import { useQuery } from '@tanstack/react-query';
import type { SentinelHistoryResponse } from '@/lib/morpho/v2-sentinel-history';
import { apiFetch } from '@/lib/data/api-fetch';

async function fetchVaultSentinelHistory(
  vaultAddress: string,
  first = 100
): Promise<SentinelHistoryResponse> {
  const res = await apiFetch(
    `/api/vaults/v2/${vaultAddress}/sentinel-history?first=${first}`,
    { credentials: 'omit' }
  );
  if (!res.ok) {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      throw new Error(json.message || json.error || 'Failed to fetch sentinel history');
    } catch {
      throw new Error(text || 'Failed to fetch sentinel history');
    }
  }
  return res.json();
}

export function useVaultSentinelHistory(vaultAddress: string | null | undefined, first = 100) {
  return useQuery({
    queryKey: ['vault-sentinel-history', vaultAddress, first],
    queryFn: () => {
      if (!vaultAddress) throw new Error('Vault address is required');
      return fetchVaultSentinelHistory(vaultAddress, first);
    },
    enabled: Boolean(vaultAddress),
    staleTime: 120_000,
    refetchInterval: false,
  });
}
