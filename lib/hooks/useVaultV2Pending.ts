import { useQuery } from '@tanstack/react-query';
import type { VaultV2PendingResponse } from '@/app/api/vaults/v2/[id]/pending/route';
import { apiFetch } from '@/lib/data/api-fetch';
import { INDEXED_VAULT_QUERY_OPTIONS } from '@/lib/data/query-config';

async function fetchVaultV2Pending(vaultAddress: string): Promise<VaultV2PendingResponse> {
  const res = await apiFetch(`/api/vaults/v2/${vaultAddress}/pending`, { credentials: 'omit' });

  if (!res.ok) {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      throw new Error(json.message || json.error || 'Failed to fetch pending changes');
    } catch {
      throw new Error(text || 'Failed to fetch pending changes');
    }
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
