import { useQuery } from '@tanstack/react-query';
import type { VaultV2GatesResponse } from '@/app/api/vaults/[id]/gates/route';
import { apiErrorMessage, apiFetch } from '@/lib/data/api-fetch';
import { ON_CHAIN_VAULT_QUERY_OPTIONS } from '@/lib/data/query-config';

export function vaultV2GatesQueryKey(vaultAddress: string | null | undefined) {
  return ['vault-v2-gates', vaultAddress] as const;
}

async function fetchVaultV2Gates(vaultAddress: string): Promise<VaultV2GatesResponse> {
  const res = await apiFetch(`/api/vaults/${vaultAddress}/gates`);

  if (!res.ok) {
    throw new Error(await apiErrorMessage(res, 'Failed to fetch vault gates'));
  }

  return res.json();
}

export function useVaultV2Gates(vaultAddress: string | null | undefined) {
  return useQuery({
    queryKey: vaultV2GatesQueryKey(vaultAddress),
    queryFn: () => {
      if (!vaultAddress) {
        throw new Error('Vault address is required');
      }
      return fetchVaultV2Gates(vaultAddress);
    },
    enabled: Boolean(vaultAddress),
    ...ON_CHAIN_VAULT_QUERY_OPTIONS,
  });
}
