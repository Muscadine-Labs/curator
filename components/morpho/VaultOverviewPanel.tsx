'use client';

import { useMemo } from 'react';
import { KpiCard } from '@/components/KpiCard';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatFullUSD, formatPercentage, formatRawTokenAmount } from '@/lib/format/number';
import {
  getTokenDisplayDecimals,
  resolveAssetDecimals,
} from '@/lib/format/asset-decimals';
import type { VaultDetail } from '@/lib/hooks/useProtocolStats';
import { VaultOverviewHistoryChart } from '@/components/morpho/VaultOverviewHistoryChart';

interface VaultOverviewPanelProps {
  vault: VaultDetail;
  morphoUiUrl: string;
  vaultName: string;
  vaultSymbol: string;
  vaultAsset: string;
}

function warningBadgeClass(level: string): string {
  const l = level.toUpperCase();
  if (l === 'RED') return 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400';
  if (l === 'YELLOW') return 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-400';
  return 'border-emerald-500/30 text-emerald-700 dark:text-emerald-400';
}

function LiquidityBreakdownCell({
  label,
  usd,
  underlying,
  assetSymbol,
  chainDecimals,
  displayDecimals,
  usdClassName,
}: {
  label: string;
  usd: number | null | undefined;
  underlying: string | null | undefined;
  assetSymbol: string;
  chainDecimals: number;
  displayDecimals: number;
  usdClassName?: string;
}) {
  let nativeLine: string | null = null;
  if (underlying != null) {
    try {
      nativeLine = `${formatRawTokenAmount(BigInt(underlying), chainDecimals, displayDecimals)} ${assetSymbol}`;
    } catch {
      nativeLine = null;
    }
  }

  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-sm font-semibold tabular-nums ${usdClassName ?? ''}`}>
        {usd != null ? formatFullUSD(usd, 2) : '—'}
      </p>
      {nativeLine && (
        <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">{nativeLine}</p>
      )}
    </div>
  );
}

export function VaultOverviewPanel({
  vault,
  morphoUiUrl,
  vaultName,
  vaultSymbol,
  vaultAsset,
}: VaultOverviewPanelProps) {
  const analytics = vault.analytics;
  const warnings = vault.warnings ?? [];
  const chainDecimals = resolveAssetDecimals(vaultAsset, vault.assetDecimals);
  const displayDecimals = getTokenDisplayDecimals(vaultAsset, chainDecimals);

  const overviewKpis = useMemo(() => {
    const items: Array<{
      key: string;
      title: string;
      value: number | string | null;
      subtitle: string;
      format: 'usd' | 'number' | 'percentage';
    }> = [
      {
        key: 'apy',
        title: 'Net APY',
        value: vault.apy,
        subtitle:
          vault.apyBase != null && vault.apy !== vault.apyBase
            ? `Base ${formatPercentage(vault.apyBase, 2)}`
            : 'After fees & rewards',
        format: 'percentage',
      },
      {
        key: 'depositors',
        title: 'Depositors',
        value: vault.depositors,
        subtitle: 'Unique addresses',
        format: 'number',
      },
      {
        key: 'perf-fee',
        title: 'Perf. fee',
        value:
          vault.parameters?.performanceFeePercent ??
          (vault.parameters?.performanceFeeBps
            ? vault.parameters.performanceFeeBps / 100
            : null),
        subtitle: 'Curator rate',
        format: 'percentage',
      },
    ];

    if (analytics?.managementFeePercent != null) {
      items.push({
        key: 'mgmt-fee',
        title: 'Mgmt fee',
        value: analytics.managementFeePercent,
        subtitle: 'Annual management',
        format: 'percentage',
      });
    }

    items.push({
      key: 'revenue',
      title: 'Revenue',
      value: vault.revenueAllTime,
      subtitle: 'All time (statements)',
      format: 'usd',
    });

    return items;
  }, [vault, analytics?.managementFeePercent]);

  const kpiGridClass = cn(
    'grid auto-rows-fr gap-2 sm:gap-3',
    // Narrow: one column (4×1 / 5×1)
    'grid-cols-1',
    // Mobile landscape / phablet: 2×2
    'min-[440px]:grid-cols-2',
    // Desktop: single row
    overviewKpis.length <= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-5'
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <a
                href={morphoUiUrl}
                target="_blank"
                rel="noreferrer"
                className="text-lg font-semibold text-slate-900 hover:text-blue-600 dark:text-slate-100 dark:hover:text-blue-400 break-words"
              >
                {vaultName}
              </a>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="text-xs">
                  {vaultSymbol}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {vaultAsset}
                </Badge>
                {vault.version && (
                  <Badge variant="secondary" className="text-xs uppercase">
                    {vault.version}
                  </Badge>
                )}
              </div>
            </div>
            {warnings.length > 0 && (
              <div className="flex max-w-md flex-wrap justify-end gap-1">
                {warnings.slice(0, 4).map((w, i) => (
                  <Badge
                    key={`${w.type}-${i}`}
                    variant="outline"
                    className={`text-[10px] font-normal ${warningBadgeClass(w.level)}`}
                  >
                    {w.type.replace(/_/g, ' ')}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className={kpiGridClass}>
        {overviewKpis.map((kpi, index) => (
          <KpiCard
            key={kpi.key}
            compact
            className={cn(
              'min-h-[5.25rem]',
              // Odd count on 2-col mobile: last tile spans full width
              overviewKpis.length % 2 === 1 &&
                index === overviewKpis.length - 1 &&
                'min-[440px]:max-lg:col-span-2 lg:col-span-1'
            )}
            title={kpi.title}
            value={kpi.value}
            subtitle={kpi.subtitle}
            format={kpi.format}
          />
        ))}
      </div>

      {vault.tvl != null && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Liquidity breakdown</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid gap-4 sm:grid-cols-3">
              <LiquidityBreakdownCell
                label="Total TVL"
                usd={vault.tvl}
                underlying={analytics?.totalAssetsUnderlying}
                assetSymbol={vaultAsset}
                chainDecimals={chainDecimals}
                displayDecimals={displayDecimals}
              />
              <LiquidityBreakdownCell
                label="Withdrawable"
                usd={analytics?.liquidityUsd}
                underlying={analytics?.liquidityUnderlying}
                assetSymbol={vaultAsset}
                chainDecimals={chainDecimals}
                displayDecimals={displayDecimals}
                usdClassName="text-emerald-700 dark:text-emerald-400"
              />
              <LiquidityBreakdownCell
                label="Idle (vault)"
                usd={analytics?.idleAssetsUsd}
                underlying={analytics?.idleAssetsUnderlying}
                assetSymbol={vaultAsset}
                chainDecimals={chainDecimals}
                displayDecimals={displayDecimals}
              />
            </div>
            {analytics?.deployedPercent != null && (
              <p className="mt-3 text-[11px] text-muted-foreground">
                ~{analytics.deployedPercent.toFixed(1)}% of TVL is deployed to strategies; the remainder is idle or
                subject to adapter liquidity.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <VaultOverviewHistoryChart vaultAddress={vault.address} version={vault.version} />
    </div>
  );
}
