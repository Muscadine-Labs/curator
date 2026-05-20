import { useQuery } from '@tanstack/react-query';
import type { VaultV2ParametersResponse } from '@/app/api/vaults/v2/[id]/parameters/route';

async function fetchVaultV2Parameters(vaultAddress: string): Promise<VaultV2ParametersResponse> {
  const res = await fetch(`/api/vaults/v2/${vaultAddress}/parameters`, { credentials: 'omit' });

  if (!res.ok) {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      throw new Error(json.message || json.error || 'Failed to fetch vault parameters');
    } catch {
      throw new Error(text || 'Failed to fetch vault parameters');
    }
  }

  return res.json();
}

export function useVaultV2Parameters(vaultAddress: string | null | undefined) {
  return useQuery({
    queryKey: ['vault-v2-parameters', vaultAddress],
    queryFn: () => {
      if (!vaultAddress) {
        throw new Error('Vault address is required');
      }
      return fetchVaultV2Parameters(vaultAddress);
    },
    enabled: Boolean(vaultAddress),
  });
}
