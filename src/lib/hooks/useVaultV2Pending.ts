import { useQuery } from '@tanstack/react-query';
import type { VaultV2PendingResponse } from '@/app/api/vaults/[id]/pending/route';
import { apiErrorMessage, apiFetch } from '@/lib/data/api-fetch';
import { INDEXED_VAULT_QUERY_OPTIONS } from '@/lib/data/query-config';

async function fetchVaultV2Pending(vaultAddress: string): Promise<VaultV2PendingResponse> {
  const res = await apiFetch(`/api/vaults/${vaultAddress}/pending`);

  if (!res.ok) {
    throw new Error(await apiErrorMessage(res, 'Failed to fetch pending changes'));
  }

  return res.json();
}

export function useVaultV2Pending(vaultAddress: string | null | undefined) {
  return useQuery({
    queryKey: ['vault-v2-pending', vaultAddress, 'row-id'],
    queryFn: () => {
      if (!vaultAddress) {
        throw new Error('Vault address is required');
      }
      return fetchVaultV2Pending(vaultAddress);
    },
    enabled: Boolean(vaultAddress),
    ...INDEXED_VAULT_QUERY_OPTIONS,
  });
}
