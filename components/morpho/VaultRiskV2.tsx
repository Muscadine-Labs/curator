'use client';

import { useMemo } from 'react';
import { Shield } from 'lucide-react';
import { useVaultV2Risk } from '@/lib/hooks/useVaultV2Risk';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { formatCompactUSD, formatPercentage, formatRawTokenAmount } from '@/lib/format/number';
import {
  getTokenDisplayDecimals,
  resolveAssetDecimals,
} from '@/lib/format/asset-decimals';
import type { MarketRiskGrade } from '@/lib/morpho/compute-v1-market-risk';
import { MarketRiskDetailCard } from '@/components/morpho/MarketRiskDetailCard';
import { morphoVaultHref } from '@/lib/morpho/morpho-app-links';

interface VaultRiskV2Props {
  vaultAddress: string;
  preloadedData?: import('@/app/api/vaults/v2/[id]/risk/route').V2VaultRiskResponse | null;
}

function getGradeColor(grade: MarketRiskGrade): string {
  switch (grade) {
    case 'A+':
    case 'A':
    case 'A−':
      return 'border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-300';
    case 'B+':
    case 'B':
    case 'B−':
      return 'border-sky-500/30 bg-sky-500/15 text-sky-600 dark:border-sky-400/20 dark:bg-sky-500/10 dark:text-sky-300';
    case 'C+':
    case 'C':
    case 'C−':
      return 'border-amber-500/30 bg-amber-500/15 text-amber-600 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-300';
    case 'D':
      return 'border-orange-500/30 bg-orange-500/15 text-orange-600 dark:border-orange-400/20 dark:bg-orange-500/10 dark:text-orange-300';
    case 'F':
      return 'border-rose-500/30 bg-rose-500/15 text-rose-600 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-300';
    default:
      return 'border-gray-500/30 bg-gray-500/15 text-gray-600 dark:border-gray-400/20 dark:bg-gray-500/10 dark:text-gray-300';
  }
}

function getScoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 60) return 'text-sky-600 dark:text-sky-400';
  if (score >= 40) return 'text-amber-600 dark:text-amber-400';
  if (score >= 20) return 'text-orange-600 dark:text-orange-400';
  return 'text-rose-600 dark:text-rose-400';
}

function formatMarketIdentifier(
  loanAsset: string | undefined,
  collateralAsset: string | undefined
): string {
  if (loanAsset && collateralAsset) return `${collateralAsset}/${loanAsset}`;
  if (loanAsset) return loanAsset;
  if (collateralAsset) return collateralAsset;
  return 'Unknown Market';
}

export function VaultRiskV2({ vaultAddress, preloadedData }: VaultRiskV2Props) {
  const { data: fetchedData, isLoading, error } = useVaultV2Risk(vaultAddress);
  const data = preloadedData ?? fetchedData;
  const isActuallyLoading = !preloadedData && isLoading;

  const sortedAdapters = useMemo(() => {
    if (!data?.adapters) return [];
    return [...data.adapters].sort((a, b) => (b.allocationUsd ?? 0) - (a.allocationUsd ?? 0));
  }, [data?.adapters]);

  const totalAdapterAssets = data?.totalAdapterAssetsUsd ?? 0;
  const idleUsd = data?.idleAssetsUsd ?? 0;
  const totalVaultAllocatedUsd = totalAdapterAssets + idleUsd;
  const adapterCount = sortedAdapters.length + 1;
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
            Risk Management
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
            Risk Management
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
            Risk Management
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
            Risk Management
          </CardTitle>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Weighted average across adapters (including idle). V1 vault adapters show vault-level risk only.
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

          {sortedAdapters.map((adapter) => {
            const adapterWeightPct =
              totalVaultAllocatedUsd > 0
                ? (adapter.allocationUsd / totalVaultAllocatedUsd) * 100
                : 0;
            const isMetaMorpho = adapter.adapterType === 'MetaMorphoAdapter';
            const markets = isMetaMorpho
              ? []
              : [...adapter.markets].sort((a, b) => (b.allocationUsd ?? 0) - (a.allocationUsd ?? 0));
            const totalMarketAlloc = markets.reduce((sum, m) => sum + (m.allocationUsd ?? 0), 0);

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
                      <Link
                        href={`/vault/v1/${adapter.underlyingVaultAddress}`}
                        className="text-xs text-slate-500 hover:underline dark:text-slate-400"
                      >
                        View in Curator →
                      </Link>
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
                  {isMetaMorpho && (
                    <p className="rounded-md border border-dashed border-slate-200 bg-slate-50/60 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
                      Risk score is aggregated from the wrapped MetaMorpho vault. Open the
                      underlying V1 vault for per-market risk detail.
                    </p>
                  )}
                  {markets.map((m) => {
                    const allocPct =
                      totalMarketAlloc > 0
                        ? (m.allocationUsd / totalMarketAlloc) * 100
                        : 0;
                    const marketName = formatMarketIdentifier(
                      m.market.loanAsset?.symbol,
                      m.market.collateralAsset?.symbol
                    );

                    return (
                      <MarketRiskDetailCard
                        key={m.market.uniqueKey || m.market.id}
                        market={m.market}
                        scores={m.scores}
                        oracleTimestampData={m.oracleTimestampData}
                        allocationSubtitle={`Adapter allocation: ${formatCompactUSD(m.allocationUsd)} · ${formatPercentage(allocPct, 2)} of adapter · ${marketName}`}
                        className="shadow-none"
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

