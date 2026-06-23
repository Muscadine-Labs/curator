'use client';

import { useMemo, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useVaultV2Pending } from '@/lib/hooks/useVaultV2Pending';
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import { v2WriteConfigs } from '@/lib/onchain/vault-writes';
import { getScanUrlForChain } from '@/lib/constants';
import { TransactionButton } from '@/components/TransactionButton';
import type { VaultV2PendingResponse } from '@/app/api/vaults/v2/[id]/pending/route';
import type { Address, Hex } from 'viem';

interface VaultV2PendingProps {
  vaultAddress: string;
  chainId: number;
  preloadedData?: VaultV2PendingResponse | null;
  /** Hide card wrapper when embedded in Sentinel tab */
  embedded?: boolean;
  /** Simpler empty state for Sentinel page */
  sentinelEmpty?: boolean;
  /** Show revoke button (Sentinel / curator) */
  allowRevoke?: boolean;
}

type PendingFilter = 'all' | 'ready' | 'waiting';

function formatValidAt(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  const dist = formatDistanceToNow(d, { addSuffix: true });
  return ts * 1000 > Date.now() ? dist : `since ${format(d, 'MMM d, yyyy')}`;
}

export function VaultV2Pending({
  vaultAddress,
  chainId,
  preloadedData,
  embedded,
  sentinelEmpty,
  allowRevoke,
}: VaultV2PendingProps) {
  const { data: fetchedData, isLoading, error } = useVaultV2Pending(vaultAddress);
  const data = preloadedData ?? fetchedData;
  const [filter, setFilter] = useState<PendingFilter>('all');
  const revokeWrite = useVaultWrite();

  const filtered = useMemo(() => {
    const items = data?.pending ?? [];
    if (filter === 'ready') return items.filter((p) => p.status === 'ready');
    if (filter === 'waiting') return items.filter((p) => p.status === 'waiting');
    return items;
  }, [data?.pending, filter]);

  const handleRevoke = (dataHex: string) => {
    revokeWrite.write(
      v2WriteConfigs.revoke(vaultAddress as Address, dataHex as Hex)
    );
  };

  if (!preloadedData && isLoading) {
    const skeleton = (
      <div className="space-y-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
    if (embedded) return skeleton;
    return (
      <Card>
        <CardHeader>
          <CardTitle>Vault Pending Actions</CardTitle>
        </CardHeader>
        <CardContent>{skeleton}</CardContent>
      </Card>
    );
  }

  if (error || !data) {
    const err = (
      <p className="text-sm text-red-600 dark:text-red-400">
        Failed to load pending actions: {error instanceof Error ? error.message : 'Unknown error'}
      </p>
    );
    if (embedded) return err;
    return (
      <Card>
        <CardHeader>
          <CardTitle>Vault Pending Actions</CardTitle>
        </CardHeader>
        <CardContent>{err}</CardContent>
      </Card>
    );
  }

  const body = (
  <>
      {!sentinelEmpty && (
        <div className="flex flex-wrap gap-2">
          {(['all', 'ready', 'waiting'] as PendingFilter[]).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? 'default' : 'outline'}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All' : f === 'ready' ? 'Executable now' : 'Pending'}
            </Button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {sentinelEmpty ? 'No pending actions' : 'No pending timelocked actions.'}
        </p>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => (
            <div
              key={item.data}
              className="rounded-md border border-slate-200 p-4 dark:border-slate-800"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-slate-900 dark:text-slate-100">{item.functionName}</p>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{item.summary}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={item.status === 'ready' ? 'default' : 'secondary'}>
                    {item.status === 'ready' ? 'Executable' : 'Pending'}
                  </Badge>
                  {allowRevoke && (
                    <TransactionButton
                      label="Revoke"
                      size="sm"
                      variant="outline"
                      suppressConnectPrompt
                      onClick={() => handleRevoke(item.data)}
                      isLoading={revokeWrite.isLoading}
                      isSuccess={revokeWrite.isSuccess}
                      error={revokeWrite.error}
                      txHash={revokeWrite.txHash}
                    />
                  )}
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
                <div>
                  <dt className="text-slate-500 dark:text-slate-400">Executable at</dt>
                  <dd className="font-medium text-slate-800 dark:text-slate-200">
                    {formatValidAt(item.validAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500 dark:text-slate-400">Submit tx</dt>
                  <dd>
                    {item.txHash ? (
                      <a
                        href={`${getScanUrlForChain(chainId)}/tx/${item.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                      >
                        {item.txHash.slice(0, 10)}…
                      </a>
                    ) : (
                      '—'
                    )}
                  </dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      )}
  </>
  );

  if (embedded) {
    if (sentinelEmpty && (data?.pending?.length ?? 0) === 0) {
      return (
        <p className="text-sm text-slate-600 dark:text-slate-400">No pending actions</p>
      );
    }
    return (
      <div className="space-y-4">
        {!sentinelEmpty && (
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Vault Pending Actions ({data.pending.length})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Pending timelock actions queued on this vault.
            </p>
          </div>
        )}
        {body}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Vault Pending Actions ({data.pending.length})</CardTitle>
        <CardDescription>
          Pending timelock actions queued on this vault. Revoke cancels a queued action before it
          executes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">{body}</CardContent>
    </Card>
  );
}
