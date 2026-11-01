import { useQuery } from '@tanstack/react-query';
import { apiErrorMessage, apiFetch } from '@/lib/data/api-fetch';
import { INDEXED_VAULT_QUERY_OPTIONS } from '@/lib/data/query-config';
import type { VaultActivityResponse } from '@/lib/morpho/vault-activity.server';

/** Vault activity feed: allocations + governance (`/api/vaults/[id]/activity`). */
export function useVaultActivity(
  vaultAddress: string | null | undefined,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: ['vault-activity', vaultAddress],
    queryFn: async (): Promise<VaultActivityResponse> => {
      if (!vaultAddress) throw new Error('Vault address is required');
      const res = await apiFetch(`/api/vaults/${vaultAddress}/activity`);
      if (!res.ok) {
        throw new Error(await apiErrorMessage(res, 'Failed to fetch vault activity'));
      }
      return res.json();
    },
    enabled: Boolean(vaultAddress) && (options?.enabled ?? true),
    ...INDEXED_VAULT_QUERY_OPTIONS,
  });
}
