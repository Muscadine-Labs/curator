import { useQuery } from '@tanstack/react-query';
import type { VaultV1ParametersResponse } from '@/app/api/vaults/v1/[id]/parameters/route';

async function fetchVaultV1Parameters(vaultAddress: string): Promise<VaultV1ParametersResponse> {
  const res = await fetch(`/api/vaults/v1/${vaultAddress}/parameters`, { credentials: 'omit' });
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

export function useVaultV1Parameters(vaultAddress: string | null | undefined) {
  return useQuery({
    queryKey: ['vault-v1-parameters', vaultAddress],
    queryFn: () => {
      if (!vaultAddress) throw new Error('Vault address is required');
      return fetchVaultV1Parameters(vaultAddress);
    },
    enabled: Boolean(vaultAddress),
  });
}
