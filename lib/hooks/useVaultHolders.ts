import { useQuery } from '@tanstack/react-query';
import type { VaultHoldersResponse } from '@/app/api/vaults/[id]/holders/route';

async function fetchVaultHolders(
  vaultAddress: string,
  first = 500
): Promise<VaultHoldersResponse> {
  const res = await fetch(
    `/api/vaults/${vaultAddress}/holders?first=${first}`,
    { credentials: 'omit' }
  );
  if (!res.ok) {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      throw new Error(json.message || json.error || 'Failed to fetch vault holders');
    } catch {
      throw new Error(text || 'Failed to fetch vault holders');
    }
  }
  return res.json();
}

export function useVaultHolders(vaultAddress: string | null | undefined, first = 500) {
  return useQuery({
    queryKey: ['vault-holders', vaultAddress, first],
    queryFn: () => {
      if (!vaultAddress) throw new Error('Vault address is required');
      return fetchVaultHolders(vaultAddress, first);
    },
    enabled: Boolean(vaultAddress),
    staleTime: 60_000,
  });
}
