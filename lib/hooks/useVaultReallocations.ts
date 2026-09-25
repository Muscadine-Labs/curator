import { useQuery } from '@tanstack/react-query';
import type { ReallocationsResponse } from '@/app/api/vaults/[id]/reallocations/route';
import { apiErrorMessage, apiFetch } from '@/lib/data/api-fetch';
import { INDEXED_VAULT_QUERY_OPTIONS } from '@/lib/data/query-config';

async function fetchVaultReallocations(
  vaultAddress: string,
  first = 100
): Promise<ReallocationsResponse> {
  const res = await apiFetch(
    `/api/vaults/${vaultAddress}/reallocations?first=${first}`);
  if (!res.ok) {
    throw new Error(await apiErrorMessage(res, 'Failed to fetch reallocations'));
  }
  return res.json();
}

export function useVaultReallocations(vaultAddress: string | null | undefined, first = 100) {
  return useQuery({
    queryKey: ['vault-reallocations', vaultAddress, first],
    queryFn: () => {
      if (!vaultAddress) throw new Error('Vault address is required');
      return fetchVaultReallocations(vaultAddress, first);
    },
    enabled: Boolean(vaultAddress),
    ...INDEXED_VAULT_QUERY_OPTIONS,
  });
}
