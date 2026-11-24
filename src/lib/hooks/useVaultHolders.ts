import { useQuery } from '@tanstack/react-query';
import type { VaultHoldersResponse } from '@/app/api/vaults/[id]/holders/route';
import { apiErrorMessage, apiFetch } from '@/lib/data/api-fetch';
import { INDEXED_VAULT_QUERY_OPTIONS } from '@/lib/data/query-config';

async function fetchVaultHolders(
  vaultAddress: string,
  first = 500
): Promise<VaultHoldersResponse> {
  const res = await apiFetch(
    `/api/vaults/${vaultAddress}/holders?first=${first}`);
  if (!res.ok) {
    throw new Error(await apiErrorMessage(res, 'Failed to fetch vault holders'));
  }
  return res.json();
}

export function useVaultHolders(
  vaultAddress: string | null | undefined,
  first = 500,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: ['vault-holders', vaultAddress, first],
    queryFn: () => {
      if (!vaultAddress) throw new Error('Vault address is required');
      return fetchVaultHolders(vaultAddress, first);
    },
    enabled: Boolean(vaultAddress) && (options?.enabled ?? true),
    ...INDEXED_VAULT_QUERY_OPTIONS,
  });
}
