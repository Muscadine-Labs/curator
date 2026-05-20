import { useQuery } from '@tanstack/react-query';
import type { VaultHistoryResponse } from '@/app/api/vaults/[id]/history/route';

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
  return res.json();
}

export function useVaultHistory(vaultAddress: string | null | undefined) {
  return useQuery({
    queryKey: ['vault-history', vaultAddress],
    queryFn: () => {
      if (!vaultAddress) throw new Error('Vault address is required');
      return fetchVaultHistory(vaultAddress);
    },
    enabled: Boolean(vaultAddress),
    staleTime: 120_000,
  });
}
