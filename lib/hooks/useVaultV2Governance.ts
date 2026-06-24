import { useQuery } from '@tanstack/react-query';
import type { VaultV2GovernanceResponse } from '@/app/api/vaults/v2/[id]/governance/route';
import { apiFetch } from '@/lib/data/api-fetch';
import { ON_CHAIN_VAULT_QUERY_OPTIONS } from '@/lib/data/query-config';

async function fetchVaultV2Governance(vaultAddress: string): Promise<VaultV2GovernanceResponse> {
  const res = await apiFetch(`/api/vaults/v2/${vaultAddress}/governance`, {
    credentials: 'omit',
  });

  if (!res.ok) {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      throw new Error(json.message || json.error || 'Failed to fetch vault governance data');
    } catch {
      throw new Error(text || 'Failed to fetch vault governance data');
    }
  }

  return res.json();
}

export function useVaultV2Governance(vaultAddress: string | null | undefined) {
  return useQuery({
    queryKey: ['vault-v2-governance', vaultAddress, 'caps-state-v2'],
    queryFn: () => {
      if (!vaultAddress) {
        throw new Error('Vault address is required');
      }
      return fetchVaultV2Governance(vaultAddress);
    },
    enabled: Boolean(vaultAddress),
    ...ON_CHAIN_VAULT_QUERY_OPTIONS,
  });
}

