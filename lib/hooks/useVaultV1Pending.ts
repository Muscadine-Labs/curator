import { useQuery } from '@tanstack/react-query';
import type { VaultV1PendingResponse } from '@/app/api/vaults/v1/[id]/pending/route';

async function fetchVaultV1Pending(vaultAddress: string): Promise<VaultV1PendingResponse> {
  const res = await fetch(`/api/vaults/v1/${vaultAddress}/pending`, { credentials: 'omit' });

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

export function useVaultV1Pending(vaultAddress: string | null | undefined) {
  return useQuery({
    queryKey: ['vault-v1-pending', vaultAddress],
    queryFn: () => {
      if (!vaultAddress) {
        throw new Error('Vault address is required');
      }
      return fetchVaultV1Pending(vaultAddress);
    },
    enabled: Boolean(vaultAddress),
  });
}
