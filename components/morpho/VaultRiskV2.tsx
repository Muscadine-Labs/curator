'use client';

import { useMemo } from 'react';
import { Shield } from 'lucide-react';
import { useVaultV2Risk } from '@/lib/hooks/useVaultV2Risk';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatCompactUSD, formatPercentage, formatRawTokenAmount } from '@/lib/format/number';
import {
  getTokenDisplayDecimals,
  resolveAssetDecimals,
} from '@/lib/format/asset-decimals';
import { MarketRiskDetailCard } from '@/components/morpho/MarketRiskDetailCard';
import { morphoVaultHref } from '@/lib/morpho/morpho-app-links';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { shouldShowAdapterEntry, shouldShowMarketEntry } from '@/lib/morpho/format-risk';
import { getGradeColor, getScoreColor } from '@/lib/morpho/market-risk-display';

interface VaultRiskV2Props {
  vaultAddress: string;
  chainId?: number;
  preloadedData?: import('@/app/api/vaults/v2/[id]/risk/route').V2VaultRiskResponse | null;
}

export function VaultRiskV2({ vaultAddress, chainId, preloadedData }: VaultRiskV2Props) {
  const { data: fetchedData, isLoading, error } = useVaultV2Risk(preloadedData ? undefined : vaultAddress);
  const data = preloadedData ?? fetchedData;
  const isActuallyLoading = !preloadedData && isLoading;
  const resolvedChainId = chainId ?? BASE_CHAIN_ID;

  const sortedAdapters = useMemo(() => {
    if (!data?.adapters) return [];
    return [...data.adapters]
      .filter((adapter) => {
        const markets = (adapter.markets ?? []).filter((m) =>
          shouldShowMarketEntry(
            m.allocationUsd,
            m.allocationAssets,
            m.absoluteCap,
            m.relativeCap
          )
        );
        return shouldShowAdapterEntry(
          adapter.allocationUsd,
          adapter.allocationAssets,
          adapter.absoluteCap,
          adapter.relativeCap,
          markets.length > 0
        );
      })
      .sort((a, b) => (b.allocationUsd ?? 0) - (a.allocationUsd ?? 0));
  }, [data?.adapters]);

  const totalAdapterAssets = data?.totalAdapterAssetsUsd ?? 0;
  const idleUsd = data?.idleAssetsUsd ?? 0;
  const totalVaultAllocatedUsd = totalAdapterAssets + idleUsd;
  const adapterCount = sortedAdapters.length + (idleUsd > 0 ? 1 : 0);
  const idleWeightPct =
    totalVaultAllocatedUsd > 0 ? (idleUsd / totalVaultAllocatedUsd) * 100 : 0;

  const vaultDecimals = data?.vaultAsset
    ? resolveAssetDecimals(data.vaultAsset.symbol, data.vaultAsset.decimals)
    : 18;
  const vaultDisplayDecimals = data?.vaultAsset
    ? getTokenDisplayDecimals(data.vaultAsset.symbol, vaultDecimals)
    : 6;
  const vaultSymbol = data?.vaultAsset?.symbol ?? '';

  if (isActuallyLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Risk
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    const isDeploymentProtection = error instanceof Error && 
      error.message.includes('Deployment protection');
    const apiUrl = `/api/vaults/v2/${vaultAddress}/risk`;
    
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Risk
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-red-600 dark:text-red-400">
            Failed to load risk data: {error instanceof Error ? error.message : 'Unknown error'}
          </p>
          {isDeploymentProtection && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20 p-3">
              <p className="text-xs text-amber-800 dark:text-amber-200 mb-2">
                <strong>Preview Deployment Protection:</strong> This preview deployment requires authentication.
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-300 mb-2">
                To fix this, open the API route directly in your browser to authenticate:
              </p>
              <a
                href={apiUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-amber-900 dark:text-amber-100 underline hover:text-amber-700 dark:hover:text-amber-300 break-all"
              >
                {typeof window !== 'undefined' ? window.location.origin + apiUrl : apiUrl}
              </a>
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-2">
                After authenticating, refresh this page. Production deployments don&apos;t require this step.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Risk
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-center py-8 text-slate-500 dark:text-slate-400">
            No adapter risk data found for this vault yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Risk
          </CardTitle>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Weighted average across strategy adapters. Markets with a non-zero cap or allocation are shown.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <p className={cn('text-xl font-semibold', getScoreColor(data.vaultRiskScore))}>
            {data.vaultRiskScore.toFixed(2)}
          </p>
          <Badge
            variant="outline"
            className={cn('text-xs font-semibold px-2 py-1', getGradeColor(data.vaultRiskGrade))}
          >
            {data.vaultRiskGrade}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-lg border p-4 bg-slate-50/60 dark:bg-slate-900/50">
            <p className="text-xs text-slate-500 dark:text-slate-400">Total Allocated (Adapters + Idle)</p>
            <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {formatCompactUSD(totalVaultAllocatedUsd)}
            </p>
          </div>
          <div className="rounded-lg border p-4 bg-slate-50/60 dark:bg-slate-900/50">
            <p className="text-xs text-slate-500 dark:text-slate-400">Adapters Count</p>
            <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {adapterCount}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {idleUsd > 0 && (
            <div className="rounded-lg border border-dashed p-4 bg-slate-50/80 dark:bg-slate-900/50 shadow-sm space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-base font-semibold">Idle</p>
                    <Badge variant="outline" className="text-xs">
                      Idle Adapter
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Allocation: {formatCompactUSD(idleUsd)} · {formatPercentage(idleWeightPct, 2)} of vault
                  </p>
                </div>
                <Badge variant="outline" className="text-xs">
                  No strategy risk
                </Badge>
              </div>
              <p className="rounded-md border border-dashed border-slate-200 bg-white/60 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300">
                Unallocated vault cash held in the contract. No market or adapter exposure.
              </p>
            </div>
          )}

          {sortedAdapters.map((adapter) => {
            const adapterWeightPct =
              totalVaultAllocatedUsd > 0
                ? (adapter.allocationUsd / totalVaultAllocatedUsd) * 100
                : 0;
            const isMetaMorpho = adapter.adapterType === 'MetaMorphoAdapter';
            const markets = [...adapter.markets]
              .filter((m) =>
                shouldShowMarketEntry(
                  m.allocationUsd,
                  m.allocationAssets,
                  m.absoluteCap,
                  m.relativeCap
                )
              )
              .sort((a, b) => (b.allocationUsd ?? 0) - (a.allocationUsd ?? 0));

            return (
              <div
                key={adapter.adapterAddress}
                className="rounded-lg border p-4 bg-white dark:bg-slate-950 shadow-sm space-y-3"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {isMetaMorpho && adapter.underlyingVaultAddress ? (
                        <a
                          href={morphoVaultHref(adapter.underlyingVaultAddress) ?? undefined}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-base font-semibold hover:text-blue-600 dark:hover:text-blue-400 transition-colors underline decoration-1 underline-offset-2"
                        >
                          {adapter.adapterLabel}
                        </a>
                      ) : (
                        <p className="text-base font-semibold">{adapter.adapterLabel}</p>
                      )}
                      <Badge variant="outline" className="text-xs">
                        {adapter.adapterType === 'MetaMorphoAdapter'
                          ? 'MetaMorpho'
                          : 'Morpho Blue'}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Allocation: {formatCompactUSD(adapter.allocationUsd)} ·{' '}
                      {formatPercentage(adapterWeightPct, 2)} of vault
                    </p>
                    {isMetaMorpho && adapter.underlyingVaultAddress && (
                      <a
                        href={morphoVaultHref(adapter.underlyingVaultAddress) ?? '#'}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-slate-500 hover:underline dark:text-slate-400"
                      >
                        View on Morpho →
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <p className={cn('text-lg font-semibold', getScoreColor(adapter.riskScore))}>
                      {adapter.riskScore.toFixed(2)}
                    </p>
                    <Badge
                      variant="outline"
                      className={cn('text-xs font-semibold px-2 py-1', getGradeColor(adapter.riskGrade))}
                    >
                      {adapter.riskGrade}
                    </Badge>
                  </div>
                </div>

                <div className="space-y-3">
                  {isMetaMorpho && adapter.underlyingVaultStats && (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="rounded-md border bg-slate-50/60 p-3 dark:bg-slate-900/40">
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                          Underlying Vault Liquidity
                        </p>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {adapter.underlyingVaultStats.liquidityUsd != null
                            ? formatCompactUSD(adapter.underlyingVaultStats.liquidityUsd)
                            : '—'}
                        </p>
                        {adapter.underlyingVaultStats.liquidityUnderlying != null && (() => {
                          try {
                            return (
                              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
                                {formatRawTokenAmount(
                                  BigInt(adapter.underlyingVaultStats.liquidityUnderlying),
                                  vaultDecimals,
                                  vaultDisplayDecimals
                                )}{' '}
                                {vaultSymbol}
                              </p>
                            );
                          } catch {
                            return null;
                          }
                        })()}
                        {adapter.underlyingVaultStats.totalAssetsUsd != null &&
                          adapter.underlyingVaultStats.totalAssetsUsd > 0 &&
                          adapter.underlyingVaultStats.liquidityUsd != null && (
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                              {formatPercentage(
                                (adapter.underlyingVaultStats.liquidityUsd /
                                  adapter.underlyingVaultStats.totalAssetsUsd) *
                                  100,
                                2
                              )}{' '}
                              of underlying TVL
                            </p>
                          )}
                      </div>
                      <div className="rounded-md border bg-slate-50/60 p-3 dark:bg-slate-900/40">
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                          Underlying Vault TVL
                        </p>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {adapter.underlyingVaultStats.totalAssetsUsd != null
                            ? formatCompactUSD(adapter.underlyingVaultStats.totalAssetsUsd)
                            : '—'}
                        </p>
                        {adapter.underlyingVaultStats.totalAssets != null && (() => {
                          try {
                            return (
                              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
                                {formatRawTokenAmount(
                                  BigInt(adapter.underlyingVaultStats.totalAssets),
                                  vaultDecimals,
                                  vaultDisplayDecimals
                                )}{' '}
                                {vaultSymbol}
                              </p>
                            );
                          } catch {
                            return null;
                          }
                        })()}
                      </div>
                    </div>
                  )}
                  {markets.map((m) => (
                      <MarketRiskDetailCard
                        key={m.market.marketKey || m.market.id}
                        market={m.market}
                        scores={m.scores}
                        oracleTimestampData={m.oracleTimestampData}
                        supplyUsd={m.allocationUsd}
                        vaultTotalUsd={totalVaultAllocatedUsd}
                        chainId={resolvedChainId}
                        marketTitleLink="curator"
                        className="shadow-none"
                      />
                    ))}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

