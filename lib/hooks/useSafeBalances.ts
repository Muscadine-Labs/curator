'use client';

import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Address } from 'viem';
import { apiFetch, apiErrorMessage } from '@/lib/data/api-fetch';
import type { SafeRole } from '@/lib/safe/config';
import { getCustomTokens, subscribeCustomTokens } from '@/lib/safe/custom-token-store';
import type { SafeTokenBalance } from '@/lib/safe/read-balances';
import type { SafeTokenAddress } from '@/lib/safe/tokens';

type BalancesResponse = {
  balances: Array<Omit<SafeTokenBalance, 'balance' | 'address'> & {
    address: SafeTokenAddress;
    balance: string;
  }>;
};

const NO_TOKENS: Address[] = [];

export function useCustomTokens(role: SafeRole): Address[] {
  return useSyncExternalStore(
    subscribeCustomTokens,
    () => getCustomTokens(role),
    () => NO_TOKENS
  );
}

export function safeBalancesQueryKey(safeAddress: string, extra: ReadonlyArray<Address>) {
  return ['safe-balances', safeAddress, extra.join(',')] as const;
}

export function useSafeBalances(safeAddress: string | undefined, role: SafeRole) {
  const extra = useCustomTokens(role);

  return useQuery({
    queryKey: safeBalancesQueryKey(safeAddress ?? '', extra),
    queryFn: async (): Promise<SafeTokenBalance[]> => {
      const query = extra.length > 0 ? `?tokens=${extra.join(',')}` : '';
      const res = await apiFetch(`/api/safe/${safeAddress}/balances${query}`);
      if (!res.ok) {
        throw new Error(await apiErrorMessage(res, `Request failed (${res.status})`));
      }
      const data = (await res.json()) as BalancesResponse;
      return data.balances.map((b) => ({ ...b, balance: BigInt(b.balance) }));
    },
    enabled: Boolean(safeAddress),
    staleTime: 15_000,
  });
}
