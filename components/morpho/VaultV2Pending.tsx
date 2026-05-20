'use client';

import { useCallback } from 'react';
import { format } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useSendTransaction, useWaitForTransactionReceipt } from 'wagmi';
import { useVaultV2Pending } from '@/lib/hooks/useVaultV2Pending';
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import { TransactionButton } from '@/components/TransactionButton';
import { v2WriteConfigs } from '@/lib/onchain/vault-writes';
import { getScanUrlForChain } from '@/lib/constants';
import type { VaultV2PendingResponse } from '@/app/api/vaults/v2/[id]/pending/route';
import type { Address, Hex } from 'viem';

interface VaultV2PendingProps {
  vaultAddress: string;
  chainId: number;
  preloadedData?: VaultV2PendingResponse | null;
}

function formatValidAt(ts: number): string {
  if (!ts) return '—';
  return format(new Date(ts * 1000), 'MMM d, yyyy HH:mm');
}

function PendingRowActions({
  vaultAddress,
  data,
  status,
}: {
  vaultAddress: string;
  data: string;
  status: 'waiting' | 'ready';
}) {
  const revokeWrite = useVaultWrite();
  const {
    sendTransaction,
    data: acceptTxHash,
    isPending: isAcceptSending,
    error: acceptSendError,
    reset: resetAccept,
  } = useSendTransaction();
  const {
    isLoading: isAcceptConfirming,
    isSuccess: isAcceptSuccess,
    error: acceptConfirmError,
  } = useWaitForTransactionReceipt({ hash: acceptTxHash });

  const handleAccept = useCallback(() => {
    resetAccept();
    sendTransaction({
      to: vaultAddress as Address,
      data: data as Hex,
    });
  }, [data, resetAccept, sendTransaction, vaultAddress]);

  return (
    <div className="flex flex-wrap gap-2">
      <TransactionButton
        label="Accept"
        size="sm"
        onClick={handleAccept}
        disabled={status !== 'ready'}
        isLoading={isAcceptSending || isAcceptConfirming}
        isSuccess={isAcceptSuccess}
        error={(acceptSendError || acceptConfirmError) as Error | null}
        txHash={acceptTxHash}
      />
      <TransactionButton
        label="Revoke"
        size="sm"
        variant="destructive"
        onClick={() => {
          revokeWrite.write(v2WriteConfigs.revoke(vaultAddress as Address, data as Hex));
        }}
        isLoading={revokeWrite.isLoading}
        isSuccess={revokeWrite.isSuccess}
        error={revokeWrite.error}
        txHash={revokeWrite.txHash}
      />
    </div>
  );
}

export function VaultV2Pending({ vaultAddress, chainId, preloadedData }: VaultV2PendingProps) {
  const { data: fetchedData, isLoading, error } = useVaultV2Pending(vaultAddress);
  const data = preloadedData ?? fetchedData;

  if (!preloadedData && isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Pending Changes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Pending Changes</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-600 dark:text-red-400">
            Failed to load pending changes: {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </CardContent>
      </Card>
    );
  }

  const pending = data.pending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pending Changes</CardTitle>
        <CardDescription>
          Timelocked governance actions indexed by the Morpho API. Accept sends the stored calldata to
          the vault after <code className="text-xs">validAt</code>; revoke cancels a pending action.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {pending.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">No pending timelocked changes.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Function</TableHead>
                  <TableHead>Summary</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Executable</TableHead>
                  <TableHead>Submit tx</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((item) => (
                  <TableRow key={item.data}>
                    <TableCell className="font-medium">{item.functionName}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-sm" title={item.summary}>
                      {item.summary}
                    </TableCell>
                    <TableCell>
                      <Badge variant={item.status === 'ready' ? 'default' : 'secondary'}>
                        {item.status === 'ready' ? 'Ready' : 'Waiting'}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{formatValidAt(item.validAt)}</TableCell>
                    <TableCell>
                      {item.txHash ? (
                        <a
                          href={`${getScanUrlForChain(chainId)}/tx/${item.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                        >
                          {item.txHash.slice(0, 10)}…
                        </a>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <PendingRowActions
                        vaultAddress={vaultAddress}
                        data={item.data}
                        status={item.status}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
