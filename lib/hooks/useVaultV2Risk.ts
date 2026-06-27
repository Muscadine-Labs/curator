import { useQuery } from '@tanstack/react-query';
import type { V2VaultRiskResponse } from '@/app/api/vaults/v2/[id]/risk/route';
import { apiFetch } from '@/lib/data/api-fetch';
import { ON_CHAIN_VAULT_QUERY_OPTIONS } from '@/lib/data/query-config';

async function fetchVaultV2Risk(vaultAddress: string): Promise<V2VaultRiskResponse> {
  const res = await apiFetch(`/api/vaults/v2/${vaultAddress}/risk`, {
    credentials: 'omit',
  });

  if (!res.ok) {
    const contentType = res.headers.get('content-type');
    const text = await res.text();
    
    // Check if we got HTML (likely Vercel deployment protection page)
    if (contentType?.includes('text/html') || text.trim().startsWith('<!')) {
      throw new Error('Deployment protection is blocking API access. Please authenticate or use production deployment.');
    }
    
    // Try to parse as JSON for structured error messages
    try {
      const json = JSON.parse(text);
      throw new Error(json.message || json.error || 'Failed to fetch vault v2 risk data');
    } catch {
      throw new Error(text || 'Failed to fetch vault v2 risk data');
    }
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

