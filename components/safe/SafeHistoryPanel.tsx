'use client';

import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  CuratorEmptyText,
  CuratorErrorText,
  CuratorPanel,
} from '@/components/morpho/CuratorChrome';
import { apiFetch } from '@/lib/data/api-fetch';
import { getScanUrlForChain, BASE_CHAIN_ID } from '@/lib/constants';
import type { SafeAccountConfig } from '@/lib/safe/config';
import type { ServiceHistoryTx } from '@/lib/safe/transaction-service';
import { isTransactionServiceConfigured } from '@/lib/safe/transaction-service';

export function SafeHistoryPanel({ account }: { account: SafeAccountConfig }) {
  const enabled = isTransactionServiceConfigured();
  const query = useQuery({
    queryKey: ['safe-history', account.address],
    queryFn: async () => {
      const res = await apiFetch(`/api/safe/${account.address}/history`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Failed to load history');
      }
      return (await res.json()) as { transactions: ServiceHistoryTx[] };
    },
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  return (
    <CuratorPanel
      title="Executed history"
      description="On-demand Transaction Service read (no background polling)."
      actions={
        enabled ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {query.isFetching ? 'Loading…' : 'Refresh'}
          </Button>
        ) : null
      }
    >
      <div className="space-y-3 p-4">
        {!enabled ? (
          <CuratorEmptyText>
            Set <code className="rounded bg-muted px-1 py-0.5 text-xs">NEXT_PUBLIC_SAFE_API_KEY</code>{' '}
            to load executed transactions.
          </CuratorEmptyText>
        ) : query.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : query.error ? (
          <CuratorErrorText>
            {query.error instanceof Error ? query.error.message : 'Failed to load history'}
          </CuratorErrorText>
        ) : !query.data?.transactions.length ? (
          <CuratorEmptyText>No executed transactions returned.</CuratorEmptyText>
        ) : (
          <ul className="divide-y divide-border">
            {query.data.transactions.map((tx) => (
              <li key={tx.safeTxHash} className="py-3">
                <p className="text-sm font-medium text-foreground">
                  Nonce {tx.nonce}
                  {tx.isSuccessful === false ? (
                    <span className="ml-2 text-xs text-red-600">failed</span>
                  ) : null}
                </p>
                <p className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">
                  {tx.to}
                </p>
                {tx.transactionHash ? (
                  <a
                    href={`${getScanUrlForChain(BASE_CHAIN_ID)}/tx/${tx.transactionHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
                  >
                    View tx
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </CuratorPanel>
  );
}
