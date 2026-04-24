import { useQuery } from '@tanstack/react-query';
import type { VaultTransactionsResponse } from '@/app/api/vaults/[id]/transactions/route';

async function fetchVaultTransactions(
  vaultAddress: string,
  first = 100
): Promise<VaultTransactionsResponse> {
  const res = await fetch(
    `/api/vaults/${vaultAddress}/transactions?first=${first}`,
    { credentials: 'omit' }
  );
  if (!res.ok) {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      throw new Error(json.message || json.error || 'Failed to fetch vault transactions');
    } catch {
      throw new Error(text || 'Failed to fetch vault transactions');
    }
  }
  return res.json();
}

export function useVaultTransactions(vaultAddress: string | null | undefined, first = 100) {
  return useQuery({
    queryKey: ['vault-transactions', vaultAddress, first],
    queryFn: () => {
      if (!vaultAddress) throw new Error('Vault address is required');
      return fetchVaultTransactions(vaultAddress, first);
    },
    enabled: Boolean(vaultAddress),
    staleTime: 30_000,
  });
}
