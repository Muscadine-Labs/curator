import { useQuery } from '@tanstack/react-query';
import type { VaultV2GovernanceResponse } from '@/app/api/vaults/[id]/governance/route';
import { apiErrorMessage, apiFetch } from '@/lib/data/api-fetch';
import { ON_CHAIN_VAULT_QUERY_OPTIONS } from '@/lib/data/query-config';

export function vaultV2GovernanceQueryKey(vaultAddress: string | null | undefined) {
  return ['vault-v2-governance', vaultAddress, 'caps-state-v2'] as const;
}

async function fetchVaultV2Governance(vaultAddress: string): Promise<VaultV2GovernanceResponse> {
  const res = await apiFetch(`/api/vaults/${vaultAddress}/governance`);

  if (!res.ok) {
    throw new Error(await apiErrorMessage(res, 'Failed to fetch vault governance data'));
  }

  return res.json();
}

export function useVaultV2Governance(
  vaultAddress: string | null | undefined,
  options?: { initialData?: VaultV2GovernanceResponse }
) {
  const hasInitial = options?.initialData !== undefined;
  return useQuery({
    queryKey: vaultV2GovernanceQueryKey(vaultAddress),
    queryFn: () => {
      if (!vaultAddress) {
        throw new Error('Vault address is required');
      }
      return fetchVaultV2Governance(vaultAddress);
    },
    enabled: Boolean(vaultAddress),
    initialData: options?.initialData,
    ...ON_CHAIN_VAULT_QUERY_OPTIONS,
    refetchOnMount: hasInitial ? false : ON_CHAIN_VAULT_QUERY_OPTIONS.refetchOnMount,
  });
}

