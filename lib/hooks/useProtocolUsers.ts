import { useQuery } from '@tanstack/react-query';
import type { ProtocolUsersResponse } from '@/app/api/protocol-users/route';
import type { ProtocolTransactionsResponse } from '@/app/api/protocol-transactions/route';
import { apiFetch } from '@/lib/data/api-fetch';
import { INDEXED_VAULT_QUERY_OPTIONS } from '@/lib/data/query-config';

export function useProtocolUsers(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['protocol-users'],
    queryFn: async (): Promise<ProtocolUsersResponse> => {
      const res = await apiFetch('/api/protocol-users');
      if (!res.ok) throw new Error('Failed to fetch protocol users');
      return res.json();
    },
    enabled: options?.enabled ?? true,
    ...INDEXED_VAULT_QUERY_OPTIONS,
  });
}

export function useProtocolTransactions(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['protocol-transactions'],
    queryFn: async (): Promise<ProtocolTransactionsResponse> => {
      const res = await apiFetch('/api/protocol-transactions');
      if (!res.ok) throw new Error('Failed to fetch protocol transactions');
      return res.json();
    },
    enabled: options?.enabled ?? true,
    ...INDEXED_VAULT_QUERY_OPTIONS,
  });
}
