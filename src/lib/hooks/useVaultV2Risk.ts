import { useQuery } from '@tanstack/react-query';
import type { V2VaultRiskResponse } from '@/app/api/vaults/[id]/risk/route';
import { apiErrorMessage, apiFetch } from '@/lib/data/api-fetch';
import { ON_CHAIN_VAULT_QUERY_OPTIONS } from '@/lib/data/query-config';

async function fetchVaultV2Risk(vaultAddress: string): Promise<V2VaultRiskResponse> {
  const res = await apiFetch(`/api/vaults/${vaultAddress}/risk`);

  if (!res.ok) {
    throw new Error(await apiErrorMessage(res, 'Failed to fetch vault v2 risk data'));
  }

  return res.json();
}

export function useVaultV2Risk(
  vaultAddress: string | null | undefined,
  options?: { initialData?: V2VaultRiskResponse }
) {
  const hasInitial = options?.initialData !== undefined;
  return useQuery({
    queryKey: ['vault-v2-risk', vaultAddress],
    queryFn: () => {
      if (!vaultAddress) {
        throw new Error('Vault address is required');
      }
      return fetchVaultV2Risk(vaultAddress);
    },
    enabled: Boolean(vaultAddress),
    initialData: options?.initialData,
    ...ON_CHAIN_VAULT_QUERY_OPTIONS,
    refetchOnMount: hasInitial ? false : ON_CHAIN_VAULT_QUERY_OPTIONS.refetchOnMount,
  });
}

