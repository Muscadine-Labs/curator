'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useVaultV2Risk } from '@/lib/hooks/useVaultV2Risk';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatCompactUSD, formatPercentage } from '@/lib/format/number';
import { MarketRiskDetailCard } from '@/components/morpho/MarketRiskDetailCard';
import {
  CuratorEmptyText,
  CuratorErrorText,
  CuratorKvList,
  CuratorKvRow,
  CuratorPageHeader,
  CuratorPanel,
  CuratorSectionHeader,
} from '@/components/morpho/CuratorChrome';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { curatorVaultHref } from '@/lib/morpho/morpho-app-links';
import { resolveUnderlyingVaultAddress } from '@/lib/config/vaults';
import { isMorphoVaultV2Adapter } from '@/lib/morpho/vault-v2-adapter';
import { shouldShowAdapterEntry, shouldShowMarketEntry } from '@/lib/morpho/format-risk';
import { getGradeColor, getScoreColor } from '@/lib/morpho/market-risk-display';

interface VaultRiskV2Props {
  vaultAddress: string;
  chainId?: number;
  preloadedData?: import('@/app/api/vaults/[id]/risk/route').V2VaultRiskResponse | null;
}

export function VaultRiskV2({ vaultAddress, chainId, preloadedData }: VaultRiskV2Props) {
  const { data: fetchedData, isLoading, error } = useVaultV2Risk(vaultAddress, {
    initialData: preloadedData ?? undefined,
  });
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
  const adapterCount = sortedAdapters.length + 1;
  const idleWeightPct =
    totalVaultAllocatedUsd > 0 ? (idleUsd / totalVaultAllocatedUsd) * 100 : 0;

  if (isActuallyLoading) {
    return (
      <div className="space-y-6">
        <CuratorPageHeader
          title="Risk"
          description="Market risk grades for this vault's allocations."
        />
        <CuratorPanel>
          <div className="space-y-3 p-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        </CuratorPanel>
      </div>
    );
  }

  if (error) {
    const isDeploymentProtection = error instanceof Error && 
      error.message.includes('Deployment protection');
    const apiUrl = `/api/vaults/${vaultAddress}/risk`;
    
    return (
      <div className="space-y-6">
        <CuratorPageHeader title="Risk" />
        <div className="space-y-3">
          <CuratorErrorText>
            Failed to load risk data: {error instanceof Error ? error.message : 'Unknown error'}
          </CuratorErrorText>
          {isDeploymentProtection && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/20">
              <p className="mb-2 text-xs text-amber-800 dark:text-amber-200">
                <strong>Preview Deployment Protection:</strong> This preview deployment requires authentication.
              </p>
              <p className="mb-2 text-xs text-amber-700 dark:text-amber-300">
                To fix this, open the API route directly in your browser to authenticate:
              </p>
              <a
                href={apiUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-xs text-amber-900 underline hover:text-amber-700 dark:text-amber-100 dark:hover:text-amber-300"
              >
                {typeof window !== 'undefined' ? window.location.origin + apiUrl : apiUrl}
              </a>
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                After authenticating, refresh this page. Production deployments don&apos;t require this step.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <CuratorPageHeader title="Risk" />
        <CuratorEmptyText>No adapter risk data found for this vault yet.</CuratorEmptyText>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <CuratorPageHeader
        title="Risk"
        description={
          data.adapters.some((a) => isMorphoVaultV2Adapter(a))
            ? 'Fee wrappers allocate to a single underlying vault. Market risk is scored on the underlying vault.'
            : "Weighted average across strategy adapters. Markets with a non-zero cap or allocation are shown."
        }
        actions={
          data.adapters.some((a) => a.adapterType === 'MorphoMarketV1Adapter') ? (
          <div className="flex items-center gap-2">
            <p className={cn('text-lg font-semibold tabular-nums', getScoreColor(data.vaultRiskScore))}>
              {data.vaultRiskScore.toFixed(2)}
            </p>
            <Badge
              variant="outline"
              className={cn('px-2 py-0.5 text-[10px] font-normal', getGradeColor(data.vaultRiskGrade))}
            >
              {data.vaultRiskGrade}
            </Badge>
          </div>
          ) : undefined
        }
      />

      <CuratorPanel>
        <CuratorKvList>
          <CuratorKvRow label="Total allocated">
            {formatCompactUSD(totalVaultAllocatedUsd)}
          </CuratorKvRow>
          <CuratorKvRow label="Adapters">{adapterCount}</CuratorKvRow>
        </CuratorKvList>
      </CuratorPanel>

      <div className="space-y-6">
        {idleUsd > 0 && (
          <div className="space-y-3">
            <CuratorSectionHeader
              title="Idle"
              description={`${formatCompactUSD(idleUsd)} · ${formatPercentage(idleWeightPct, 2)} of vault`}
            />
            <CuratorPanel>
              <p className="px-4 py-3 text-sm text-muted-foreground">
                Unallocated vault cash held in the contract. No market or adapter exposure.
              </p>
            </CuratorPanel>
          </div>
        )}

        {sortedAdapters.map((adapter) => {
            const adapterWeightPct =
              totalVaultAllocatedUsd > 0
                ? (adapter.allocationUsd / totalVaultAllocatedUsd) * 100
                : 0;
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
            const underlyingHref = curatorVaultHref(
              resolveUnderlyingVaultAddress(vaultAddress, adapter.underlying?.address)
            );
            const isWrapper = isMorphoVaultV2Adapter(adapter);

            return (
              <div key={adapter.adapterAddress} className="space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <CuratorSectionHeader
                    title={adapter.adapterLabel}
                    count={isWrapper ? undefined : markets.length}
                    description={`${formatCompactUSD(adapter.allocationUsd)} · ${formatPercentage(adapterWeightPct, 2)} of vault`}
                  />
                  {!isWrapper ? (
                  <div className="flex items-center gap-2">
                    <p className={cn('text-sm font-semibold tabular-nums', getScoreColor(adapter.riskScore))}>
                      {adapter.riskScore.toFixed(2)}
                    </p>
                    <Badge
                      variant="outline"
                      className={cn('text-[10px] font-normal', getGradeColor(adapter.riskGrade))}
                    >
                      {adapter.riskGrade}
                    </Badge>
                  </div>
                  ) : null}
                </div>
                {isWrapper ? (
                  <CuratorPanel>
                    <p className="px-4 py-3 text-sm text-muted-foreground">
                      Allocates only to{' '}
                      {underlyingHref ? (
                        <Link href={`${underlyingHref}/risk`} className="font-medium text-foreground underline-offset-2 hover:underline">
                          {adapter.underlying?.name || adapter.adapterLabel}
                        </Link>
                      ) : (
                        adapter.underlying?.name || adapter.adapterLabel
                      )}
                      . Market risk grades live on that vault.
                    </p>
                  </CuratorPanel>
                ) : (
                <div className="space-y-3">
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
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

