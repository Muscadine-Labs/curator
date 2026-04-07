'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useVaultCaps } from '@/lib/hooks/useVaultCaps';
import { formatUSD, formatTokenAmount } from '@/lib/format/number';
import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import { TransactionButton } from '@/components/TransactionButton';
import { v1WriteConfigs } from '@/lib/onchain/vault-writes';
import { parseUnits } from 'viem';
import type { Address } from 'viem';
import type { VaultCapsData } from '@/lib/hooks/useVaultCaps';

interface VaultCapsV1Props {
  vaultAddress: Address | string;
  preloadedData?: VaultCapsData | null;
}

function formatMarketName(loanAsset: string, collateralAsset: string): string {
  return `${loanAsset}/${collateralAsset}`;
}

export function VaultCapsV1({ vaultAddress, preloadedData }: VaultCapsV1Props) {
  const [showManage, setShowManage] = useState(false);
  const [selectedMarketKey, setSelectedMarketKey] = useState('');
  const [newCapAmount, setNewCapAmount] = useState('');
  const [oracleAddr, setOracleAddr] = useState('');
  const [irmAddr, setIrmAddr] = useState('');
  const [lltvInput, setLltvInput] = useState('');
  const submitCapWrite = useVaultWrite();
  const acceptCapWrite = useVaultWrite();

  const { data: fetchedData, isLoading, error } = useVaultCaps(vaultAddress);
  const data = preloadedData ?? fetchedData;

  if (!preloadedData && isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Market Caps</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Market Caps</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-600 dark:text-red-400">
            Failed to load market caps: {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (data.markets.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Market Caps</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-center py-8 text-slate-500 dark:text-slate-400">
            No market caps found for this vault.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Sort markets by supply amount (descending) - prefer USD if available, otherwise raw amount
  const sortedMarkets = [...data.markets].sort((a, b) => {
    const aAmount = a.supplyAssetsUsd ?? a.supplyAssets ?? 0;
    const bAmount = b.supplyAssetsUsd ?? b.supplyAssets ?? 0;
    return bAmount - aAmount;
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Market Caps</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {sortedMarkets.map((market) => {
          const marketName = formatMarketName(market.loanAsset.symbol, market.collateralAsset.symbol);
          const hasPending = (market.supplyQueueIndex !== null && market.supplyQueueIndex !== undefined) ||
                            (market.withdrawQueueIndex !== null && market.withdrawQueueIndex !== undefined);
          
          // Convert raw token amounts to human-readable using decimals
          const decimals = market.loanAsset.decimals;
          const supplyCapTokens = market.supplyCap !== null 
            ? market.supplyCap / Math.pow(10, decimals)
            : null;
          const supplyAssetsTokens = market.supplyAssets !== null
            ? market.supplyAssets / Math.pow(10, decimals)
            : null;

          // Calculate USD value for supply cap using price from supplyAssets
          const supplyCapUsd = supplyCapTokens !== null && supplyAssetsTokens !== null && 
            market.supplyAssetsUsd !== null && supplyAssetsTokens > 0
            ? (supplyCapTokens / supplyAssetsTokens) * market.supplyAssetsUsd
            : null;

          // Calculate utilization if we have both supply and cap (in token units)
          const utilization = supplyCapTokens !== null && supplyAssetsTokens !== null
            ? (supplyAssetsTokens / supplyCapTokens) * 100
            : null;

          // Calculate Max In: remaining capacity (supplyCap - supplyAssets) in tokens
          const maxInTokens = supplyCapTokens !== null && supplyAssetsTokens !== null
            ? supplyCapTokens - supplyAssetsTokens
            : null;

          // Max Out: current supply that can be withdrawn in tokens
          const maxOutTokens = supplyAssetsTokens;

          return (
            <div key={market.marketKey} className="border-b border-slate-200 dark:border-slate-700 pb-6 last:border-0 last:pb-0">
              <div className="space-y-4">
                {/* Market Header */}
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-sm font-medium">
                    {marketName}
                  </Badge>
                  <a
                    href={`https://app.morpho.org/markets/${market.marketKey}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 flex items-center gap-1"
                  >
                    View Market <ExternalLink className="h-3 w-3" />
                  </a>
                </div>

                {/* Cap Information */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      Supply Cap
                    </div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {supplyCapTokens !== null
                        ? formatTokenAmount(market.supplyCap, decimals, 2) + ' ' + market.loanAsset.symbol
                        : 'Unlimited'}
                    </div>
                    {supplyCapUsd !== null && (
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {formatUSD(supplyCapUsd, 2)}
                      </div>
                    )}
                  </div>

                  <div className="space-y-1">
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      Current Supply
                    </div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {supplyAssetsTokens !== null
                        ? formatTokenAmount(market.supplyAssets, decimals, 2) + ' ' + market.loanAsset.symbol
                        : 'N/A'}
                    </div>
                    {supplyAssetsTokens !== null && market.supplyAssetsUsd !== null && (
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {formatUSD(market.supplyAssetsUsd, 2)}
                      </div>
                    )}
                    {utilization !== null && (
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {utilization.toFixed(2)}% utilized
                      </div>
                    )}
                  </div>

                  <div className="space-y-1">
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      Max In
                    </div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {maxInTokens !== null && maxInTokens > 0
                        ? new Intl.NumberFormat('en-US', { 
                            minimumFractionDigits: 2, 
                            maximumFractionDigits: 2 
                          }).format(maxInTokens) + ' ' + market.loanAsset.symbol
                        : market.supplyCap === null
                        ? 'Unlimited'
                        : '0.00 ' + market.loanAsset.symbol}
                    </div>
                    {maxInTokens !== null && maxInTokens > 0 && market.supplyAssetsUsd !== null && supplyAssetsTokens !== null && supplyAssetsTokens > 0 && (
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {formatUSD((maxInTokens / supplyAssetsTokens) * market.supplyAssetsUsd, 2)}
                      </div>
                    )}
                  </div>

                  <div className="space-y-1">
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      Max Out
                    </div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {maxOutTokens !== null
                        ? formatTokenAmount(market.supplyAssets, decimals, 2) + ' ' + market.loanAsset.symbol
                        : 'N/A'}
                    </div>
                    {maxOutTokens !== null && market.supplyAssetsUsd !== null && (
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {formatUSD(market.supplyAssetsUsd, 2)}
                      </div>
                    )}
                  </div>
                </div>

                {/* Pending Badge */}
                {hasPending && (
                  <div className="flex justify-end">
                    <Badge variant="secondary" className="text-xs">
                      Pending
                    </Badge>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Manage Section */}
        <div className="border-t pt-4">
          <button
            onClick={() => setShowManage(!showManage)}
            className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
          >
            {showManage ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            Manage Caps
          </button>

          {showManage && (
            <div className="mt-4 space-y-6">
              {/* Submit Cap */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-4">
                <h4 className="text-sm font-semibold">Submit New Cap</h4>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Market</label>
                  <select
                    value={selectedMarketKey}
                    onChange={(e) => setSelectedMarketKey(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">Select market...</option>
                    {data.markets.map((m) => (
                      <option key={m.marketKey} value={m.marketKey}>
                        {formatMarketName(m.loanAsset.symbol, m.collateralAsset.symbol)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Oracle Address</label>
                  <Input type="text" placeholder="0x..." value={oracleAddr} onChange={(e) => setOracleAddr(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">IRM Address</label>
                  <Input type="text" placeholder="0x..." value={irmAddr} onChange={(e) => setIrmAddr(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">LLTV (in WAD, e.g. 860000000000000000 for 86%)</label>
                  <Input type="text" placeholder="e.g. 860000000000000000" value={lltvInput} onChange={(e) => setLltvInput(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">New Supply Cap (in token units)</label>
                  <Input
                    type="text"
                    placeholder="e.g. 1000000"
                    value={newCapAmount}
                    onChange={(e) => setNewCapAmount(e.target.value)}
                  />
                </div>
                <TransactionButton
                  label="Submit Cap"
                  onClick={() => {
                    const market = data.markets.find((m) => m.marketKey === selectedMarketKey);
                    if (!market || !newCapAmount || !oracleAddr || !irmAddr || !lltvInput) return;
                    const decimals = market.loanAsset.decimals;
                    const capBigInt = parseUnits(newCapAmount, decimals);
                    const marketParams = {
                      loanToken: market.loanAsset.address as Address,
                      collateralToken: market.collateralAsset.address as Address,
                      oracle: oracleAddr as Address,
                      irm: irmAddr as Address,
                      lltv: BigInt(lltvInput),
                    };
                    const config = v1WriteConfigs.submitCap(vaultAddress as Address, marketParams, capBigInt);
                    submitCapWrite.write(config);
                  }}
                  disabled={!selectedMarketKey || !newCapAmount || !oracleAddr || !irmAddr || !lltvInput}
                  isLoading={submitCapWrite.isLoading}
                  isSuccess={submitCapWrite.isSuccess}
                  error={submitCapWrite.error}
                  txHash={submitCapWrite.txHash}
                />
              </div>

              {/* Accept Cap - per market buttons */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-4">
                <h4 className="text-sm font-semibold">Accept Pending Cap</h4>
                <p className="text-xs text-muted-foreground">Accept a pending cap after its timelock has elapsed.</p>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Market</label>
                  <select
                    value={selectedMarketKey}
                    onChange={(e) => setSelectedMarketKey(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">Select market...</option>
                    {data.markets.map((m) => (
                      <option key={`accept-${m.marketKey}`} value={m.marketKey}>
                        {formatMarketName(m.loanAsset.symbol, m.collateralAsset.symbol)}
                      </option>
                    ))}
                  </select>
                </div>
                <TransactionButton
                  label="Accept Cap"
                  onClick={() => {
                    const market = data.markets.find((m) => m.marketKey === selectedMarketKey);
                    if (!market || !oracleAddr || !irmAddr || !lltvInput) return;
                    const marketParams = {
                      loanToken: market.loanAsset.address as Address,
                      collateralToken: market.collateralAsset.address as Address,
                      oracle: oracleAddr as Address,
                      irm: irmAddr as Address,
                      lltv: BigInt(lltvInput),
                    };
                    const config = v1WriteConfigs.acceptCap(vaultAddress as Address, marketParams);
                    acceptCapWrite.write(config);
                  }}
                  disabled={!selectedMarketKey || !oracleAddr || !irmAddr || !lltvInput}
                  isLoading={acceptCapWrite.isLoading}
                  isSuccess={acceptCapWrite.isSuccess}
                  error={acceptCapWrite.error}
                  txHash={acceptCapWrite.txHash}
                />
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

