'use client';

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
import { useVaultV1Pending } from '@/lib/hooks/useVaultV1Pending';
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import { TransactionButton } from '@/components/TransactionButton';
import { v1WriteConfigs, type MarketParams } from '@/lib/onchain/vault-writes';
import { getScanUrlForChain } from '@/lib/constants';
import type { VaultV1PendingItem, VaultV1PendingResponse } from '@/app/api/vaults/v1/[id]/pending/route';
import type { Address } from 'viem';

interface VaultV1PendingProps {
  vaultAddress: string;
  chainId: number;
  preloadedData?: VaultV1PendingResponse | null;
}

function formatValidAt(ts: number): string {
  if (!ts) return '—';
  return format(new Date(ts * 1000), 'MMM d, yyyy HH:mm');
}

function V1PendingRowActions({
  vaultAddress,
  item,
  status,
}: {
  vaultAddress: string;
  item: VaultV1PendingItem;
  status: 'waiting' | 'ready';
}) {
  const acceptWrite = useVaultWrite();

  const handleAccept = () => {
    if (status !== 'ready') return;

    switch (item.decoded.type) {
      case 'SetCap': {
        if (!item.decoded.marketParams) return;
        const p = item.decoded.marketParams;
        const marketParams: MarketParams = {
          loanToken: p.loanToken as Address,
          collateralToken: p.collateralToken as Address,
          oracle: p.oracle as Address,
          irm: p.irm as Address,
          lltv: BigInt(p.lltv),
        };
        acceptWrite.write(v1WriteConfigs.acceptCap(vaultAddress as Address, marketParams));
        break;
      }
      case 'SetGuardian':
        acceptWrite.write(v1WriteConfigs.acceptGuardian(vaultAddress as Address));
        break;
      case 'SetTimelock':
        acceptWrite.write(v1WriteConfigs.acceptTimelock(vaultAddress as Address));
        break;
      default:
        break;
    }
  };

  const canAccept =
    status === 'ready' &&
    (item.decoded.type === 'SetGuardian' ||
      item.decoded.type === 'SetTimelock' ||
      (item.decoded.type === 'SetCap' && item.decoded.marketParams != null));

  return (
    <TransactionButton
      label="Accept"
      size="sm"
      onClick={handleAccept}
      disabled={!canAccept}
      isLoading={acceptWrite.isLoading}
      isSuccess={acceptWrite.isSuccess}
      error={acceptWrite.error}
      txHash={acceptWrite.txHash}
    />
  );
}

export function VaultV1Pending({ vaultAddress, chainId, preloadedData }: VaultV1PendingProps) {
  const { data: fetchedData, isLoading, error } = useVaultV1Pending(vaultAddress);
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
          Timelocked MetaMorpho actions from the Morpho API. Accept uses the vault&apos;s
          timelocked accept functions once <code className="text-xs">validAt</code> has passed.
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
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.functionName}</TableCell>
                    <TableCell className="max-w-[220px] truncate text-sm" title={item.summary}>
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
                      <V1PendingRowActions
                        vaultAddress={vaultAddress}
                        item={item}
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
