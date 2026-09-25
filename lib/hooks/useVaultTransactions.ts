import { useQuery } from '@tanstack/react-query';
import type { VaultTransactionsResponse } from '@/app/api/vaults/[id]/transactions/route';
import { apiErrorMessage, apiFetch } from '@/lib/data/api-fetch';
import { INDEXED_VAULT_QUERY_OPTIONS } from '@/lib/data/query-config';

async function fetchVaultTransactions(
  vaultAddress: string,
  first = 100
): Promise<VaultTransactionsResponse> {
  const res = await apiFetch(
    `/api/vaults/${vaultAddress}/transactions?first=${first}`);
  if (!res.ok) {
    throw new Error(await apiErrorMessage(res, 'Failed to fetch vault transactions'));
  }
  return res.json();
}

export function useVaultTransactions(
  vaultAddress: string | null | undefined,
  first = 100,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: ['vault-transactions', vaultAddress, first],
    queryFn: () => {
      if (!vaultAddress) throw new Error('Vault address is required');
      return fetchVaultTransactions(vaultAddress, first);
    },
    enabled: Boolean(vaultAddress) && (options?.enabled ?? true),
    ...INDEXED_VAULT_QUERY_OPTIONS,
  });
}
