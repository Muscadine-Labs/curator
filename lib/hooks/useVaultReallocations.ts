import { useQuery } from '@tanstack/react-query';
import type { ReallocationsResponse } from '@/app/api/vaults/[id]/reallocations/route';
import { apiFetch } from '@/lib/data/api-fetch';
import { INDEXED_VAULT_QUERY_OPTIONS } from '@/lib/data/query-config';

async function fetchVaultReallocations(
  vaultAddress: string,
  first = 100
): Promise<ReallocationsResponse> {
  const res = await apiFetch(
    `/api/vaults/${vaultAddress}/reallocations?first=${first}`,
    { credentials: 'omit' }
  );
  if (!res.ok) {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      throw new Error(json.message || json.error || 'Failed to fetch reallocations');
    } catch {
      throw new Error(text || 'Failed to fetch reallocations');
    }
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
