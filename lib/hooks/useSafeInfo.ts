'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/data/api-fetch';
import type { SafeOnChainInfo, SafeProposersInfo } from '@/lib/safe/types';
import type { SafeRole } from '@/lib/safe/config';

type SafeInfoResponse = Omit<SafeOnChainInfo, 'nonce' | 'ethBalance'> &
  SafeProposersInfo & {
    nonce: string;
    ethBalance: string;
    role: SafeRole | null;
    label: string | null;
  };

async function fetchJson<T>(url: string): Promise<T> {
  const res = await apiFetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export function useSafeInfo(safeAddress: string | undefined) {
  return useQuery({
    queryKey: ['safe-info', safeAddress],
    queryFn: async () => {
      const data = await fetchJson<SafeInfoResponse>(`/api/safe/${safeAddress}/info`);
      return {
        ...data,
        nonce: BigInt(data.nonce),
        ethBalance: BigInt(data.ethBalance),
      } satisfies SafeOnChainInfo &
        SafeProposersInfo & { role: SafeRole | null; label: string | null };
    },
    enabled: Boolean(safeAddress),
    staleTime: 15_000,
  });
}
