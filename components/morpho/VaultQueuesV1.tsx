'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useVaultQueues } from '@/lib/hooks/useVaultQueues';
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import { formatUSD, formatTokenAmount } from '@/lib/format/number';
import { ExternalLink, ArrowDown, ArrowUp, Pencil, X } from 'lucide-react';
import { TransactionButton } from '@/components/TransactionButton';
import { v1WriteConfigs } from '@/lib/onchain/vault-writes';
import type { Address, Hex } from 'viem';
import type { VaultQueuesData } from '@/lib/hooks/useVaultQueues';

interface VaultQueuesV1Props {
  vaultAddress: Address | string;
  preloadedData?: VaultQueuesData | null;
}

function formatMarketName(loanAsset: string, collateralAsset: string): string {
  return `${loanAsset}/${collateralAsset}`;
}

export function VaultQueuesV1({ vaultAddress, preloadedData }: VaultQueuesV1Props) {
  const { data: fetchedData, isLoading, error } = useVaultQueues(vaultAddress);
  const data = preloadedData ?? fetchedData;

  if (!preloadedData && isLoading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Supply Queue</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Withdraw Queue</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Queues</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-600 dark:text-red-400">
            Failed to load queues: {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <SupplyQueueCard
        vaultAddress={vaultAddress}
        queue={data.supplyQueue}
      />
      <WithdrawQueueCard
        vaultAddress={vaultAddress}
        queue={data.withdrawQueue}
      />
    </div>
  );
}

function SupplyQueueCard({
  vaultAddress,
  queue,
}: {
  vaultAddress: Address | string;
  queue: VaultQueuesData['supplyQueue'];
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState(() => queue.map((m) => m.marketKey).join(', '));
  const write = useVaultWrite();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <ArrowDown className="h-5 w-5 text-green-600 dark:text-green-400" />
            Supply Queue
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {queue.length} {queue.length === 1 ? 'market' : 'markets'}
            </Badge>
            <Button size="sm" variant={open ? 'secondary' : 'outline'} onClick={() => setOpen((v) => !v)}>
              {open ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
              <span className="ml-1">{open ? 'Cancel' : 'Edit order'}</span>
            </Button>
          </div>
        </div>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Markets receive new deposits in this order. Lower positions are processed first.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {queue.length === 0 ? (
          <p className="py-8 text-center text-slate-500 dark:text-slate-400">No markets in supply queue</p>
        ) : (
          queue.map((market, index) => (
            <QueueRow key={market.marketKey} market={market} index={index} isFirst={index === 0} />
          ))
        )}
        {open && (
          <div className="mt-3 rounded-md border border-dashed border-slate-300 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40">
            <p className="mb-2 text-[11px] text-slate-500">
              Comma-separated market IDs (bytes32). Reorder, remove, or add IDs.
            </p>
            <Input
              type="text"
              placeholder="0xabc…, 0xdef…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <div className="mt-2">
              <TransactionButton
                label="Set Supply Queue"
                onClick={() => {
                  if (!input.trim()) return;
                  const ids = input.split(',').map((s) => s.trim() as Hex);
                  write.write(v1WriteConfigs.setSupplyQueue(vaultAddress as Address, ids));
                }}
                disabled={!input.trim()}
                isLoading={write.isLoading}
                isSuccess={write.isSuccess}
                error={write.error}
                txHash={write.txHash}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WithdrawQueueCard({
  vaultAddress,
  queue,
}: {
  vaultAddress: Address | string;
  queue: VaultQueuesData['withdrawQueue'];
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState(() => queue.map((_, i) => i).join(', '));
  const write = useVaultWrite();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <ArrowUp className="h-5 w-5 text-red-600 dark:text-red-400" />
            Withdraw Queue
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {queue.length} {queue.length === 1 ? 'market' : 'markets'}
            </Badge>
            <Button size="sm" variant={open ? 'secondary' : 'outline'} onClick={() => setOpen((v) => !v)}>
              {open ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
              <span className="ml-1">{open ? 'Cancel' : 'Edit order'}</span>
            </Button>
          </div>
        </div>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Markets are tapped for withdrawals in this order. Lower positions are processed first.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {queue.length === 0 ? (
          <p className="py-8 text-center text-slate-500 dark:text-slate-400">No markets in withdraw queue</p>
        ) : (
          queue.map((market, index) => (
            <QueueRow key={market.marketKey} market={market} index={index} isFirst={index === 0} />
          ))
        )}
        {open && (
          <div className="mt-3 rounded-md border border-dashed border-slate-300 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40">
            <p className="mb-2 text-[11px] text-slate-500">
              Comma-separated index permutation (e.g. &quot;2,0,1,3&quot;).
            </p>
            <Input
              type="text"
              placeholder="e.g. 2,0,1,3"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <div className="mt-2">
              <TransactionButton
                label="Update Withdraw Queue"
                onClick={() => {
                  if (!input.trim()) return;
                  const indexes = input.split(',').map((s) => BigInt(s.trim()));
                  write.write(v1WriteConfigs.updateWithdrawQueue(vaultAddress as Address, indexes));
                }}
                disabled={!input.trim()}
                isLoading={write.isLoading}
                isSuccess={write.isSuccess}
                error={write.error}
                txHash={write.txHash}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function QueueRow({
  market,
  index,
  isFirst,
}: {
  market: VaultQueuesData['supplyQueue'][number];
  index: number;
  isFirst: boolean;
}) {
  const marketName = formatMarketName(market.loanAsset.symbol, market.collateralAsset.symbol);
  return (
    <div
      className={`rounded-lg border p-4 transition-colors ${
        isFirst
          ? 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/20'
          : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <Badge
              variant={isFirst ? 'default' : 'outline'}
              className={`font-mono text-xs ${isFirst ? 'bg-blue-600 text-white' : ''}`}
            >
              #{index + 1}
            </Badge>
            <Badge variant="outline" className="text-sm font-medium">
              {marketName}
            </Badge>
            {isFirst && (
              <Badge variant="secondary" className="text-xs">
                Next
              </Badge>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-4 text-xs text-slate-600 dark:text-slate-400">
              {market.supplyAssets !== null && market.supplyAssets !== undefined && (
                <span>
                  Current: {formatTokenAmount(market.supplyAssets, market.loanAsset.decimals, 2)}{' '}
                  {market.loanAsset.symbol}
                </span>
              )}
              {market.supplyAssetsUsd !== null && market.supplyAssetsUsd !== undefined && (
                <span>{formatUSD(market.supplyAssetsUsd, 2)}</span>
              )}
            </div>
            <a
              href={`https://app.morpho.org/markets/${market.marketKey}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
            >
              View Market <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
