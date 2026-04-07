'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { useVaultQueues } from '@/lib/hooks/useVaultQueues';
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import { formatUSD, formatTokenAmount } from '@/lib/format/number';
import { ExternalLink, ArrowDown, ArrowUp, ChevronDown, ChevronUp } from 'lucide-react';
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

  const [showManage, setShowManage] = useState(false);
  const [supplyQueueInput, setSupplyQueueInput] = useState('');
  const [withdrawIndexesInput, setWithdrawIndexesInput] = useState('');
  const supplyQueueWrite = useVaultWrite();
  const withdrawQueueWrite = useVaultWrite();

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

  const renderQueue = (queue: typeof data.supplyQueue, title: string, icon: React.ReactNode, description: string) => {
    if (queue.length === 0) {
      return (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {icon}
              {title}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-center py-8 text-slate-500 dark:text-slate-400">
              No markets in {title.toLowerCase()}
            </p>
          </CardContent>
        </Card>
      );
    }

    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              {icon}
              {title}
            </CardTitle>
            <Badge variant="outline" className="text-xs">
              {queue.length} {queue.length === 1 ? 'market' : 'markets'}
            </Badge>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">{description}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {queue.map((market, index) => {
            const marketName = formatMarketName(market.loanAsset.symbol, market.collateralAsset.symbol);
            const isFirst = index === 0;
            
            return (
              <div
                key={market.marketKey}
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
                        className={`font-mono text-xs ${
                          isFirst ? 'bg-blue-600 text-white' : ''
                        }`}
                      >
                        #{market.queueIndex + 1}
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
                            Current: {formatTokenAmount(market.supplyAssets, market.loanAsset.decimals, 2)} {market.loanAsset.symbol}
                          </span>
                        )}
                        {market.supplyAssetsUsd !== null && market.supplyAssetsUsd !== undefined && (
                          <span>
                            {formatUSD(market.supplyAssetsUsd, 2)}
                          </span>
                        )}
                      </div>
                      <a
                        href={`https://app.morpho.org/markets/${market.marketKey}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 flex items-center gap-1 text-xs"
                      >
                        View Market <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      {renderQueue(
        data.supplyQueue,
        'Supply Queue',
        <ArrowDown className="h-5 w-5 text-green-600 dark:text-green-400" />,
        'Markets receive new deposits in this order. Lower positions are processed first.'
      )}
      {renderQueue(
        data.withdrawQueue,
        'Withdraw Queue',
        <ArrowUp className="h-5 w-5 text-red-600 dark:text-red-400" />,
        'Markets are tapped for withdrawals in this order. Lower positions are processed first.'
      )}

      {/* Manage Queues */}
      <Card>
        <CardHeader>
          <button
            onClick={() => setShowManage(!showManage)}
            className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
          >
            {showManage ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            Manage Queues
          </button>
        </CardHeader>
        {showManage && (
          <CardContent className="space-y-6">
            {/* Set Supply Queue */}
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-4">
              <h4 className="text-sm font-semibold">Set Supply Queue</h4>
              <p className="text-xs text-muted-foreground">Comma-separated market IDs (bytes32 hex values)</p>
              <div className="space-y-2">
                <Input
                  type="text"
                  placeholder="0xabc...,0xdef..."
                  value={supplyQueueInput}
                  onChange={(e) => setSupplyQueueInput(e.target.value)}
                />
              </div>
              <TransactionButton
                label="Set Supply Queue"
                onClick={() => {
                  if (!supplyQueueInput.trim()) return;
                  const ids = supplyQueueInput.split(',').map((s) => s.trim() as Hex);
                  const config = v1WriteConfigs.setSupplyQueue(vaultAddress as Address, ids);
                  supplyQueueWrite.write(config);
                }}
                disabled={!supplyQueueInput.trim()}
                isLoading={supplyQueueWrite.isLoading}
                isSuccess={supplyQueueWrite.isSuccess}
                error={supplyQueueWrite.error}
                txHash={supplyQueueWrite.txHash}
              />
            </div>

            {/* Update Withdraw Queue */}
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-4">
              <h4 className="text-sm font-semibold">Update Withdraw Queue</h4>
              <p className="text-xs text-muted-foreground">Comma-separated index permutation (e.g., &quot;2,0,1,3&quot;)</p>
              <div className="space-y-2">
                <Input
                  type="text"
                  placeholder="e.g. 2,0,1,3"
                  value={withdrawIndexesInput}
                  onChange={(e) => setWithdrawIndexesInput(e.target.value)}
                />
              </div>
              <TransactionButton
                label="Update Withdraw Queue"
                onClick={() => {
                  if (!withdrawIndexesInput.trim()) return;
                  const indexes = withdrawIndexesInput.split(',').map((s) => BigInt(s.trim()));
                  const config = v1WriteConfigs.updateWithdrawQueue(vaultAddress as Address, indexes);
                  withdrawQueueWrite.write(config);
                }}
                disabled={!withdrawIndexesInput.trim()}
                isLoading={withdrawQueueWrite.isLoading}
                isSuccess={withdrawQueueWrite.isSuccess}
                error={withdrawQueueWrite.error}
                txHash={withdrawQueueWrite.txHash}
              />
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

