'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { ExternalLink, ArrowLeft } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { MarketRiskDetailCard } from '@/components/morpho/MarketRiskDetailCard';
import { MarketOraclePanel } from '@/components/morpho/MarketOraclePanel';
import { useCuratorMarketDetail } from '@/lib/hooks/useCuratorMarkets';
import type { MarketBadDebtAmount } from '@/lib/morpho/curator-markets';
import { BASE_CHAIN_ID, CURATOR_MARKET_NETWORKS, parseCuratorMarketChainId } from '@/lib/constants';
import { morphoMarketHref } from '@/lib/morpho/morpho-app-links';
import { asBlueMarketData } from '@/lib/morpho/blue-market-data';
import {
  formatCompactUSD,
  formatFullUSD,
  formatPercentage,
  formatRawTokenAmount,
} from '@/lib/format/number';
import { formatLltvPill } from '@/components/morpho/AllocationListView';

function formatMorphoTokenAmount(usd: number | null, symbol: string): string {
  if (usd == null || usd === 0) return `0 ${symbol}`;
  const compact = new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(usd);
  return `${compact} ${symbol}`;
}

function formatBadDebtUsd(value: MarketBadDebtAmount | null | undefined): string {
  if (value?.usd == null) return '—';
  return formatFullUSD(value.usd);
}

function formatBadDebtUnderlying(
  value: MarketBadDebtAmount | null | undefined,
  loanSymbol: string,
  loanDecimals: number
): string {
  if (!value?.underlying) return '—';
  try {
    const raw = BigInt(value.underlying);
    if (raw === 0n) return `0 ${loanSymbol}`;
    return `${formatRawTokenAmount(raw, loanDecimals, 6)} ${loanSymbol}`;
  } catch {
    return '—';
  }
}

export default function CuratorBlueMarketPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const marketId = decodeURIComponent(params.id as string);
  const chainId = parseCuratorMarketChainId(searchParams.get('chainId'));

  const { data, isLoading, error } = useCuratorMarketDetail(marketId, chainId);
  const market = data?.market;
  const networkName =
    CURATOR_MARKET_NETWORKS.find((n) => n.chainId === chainId)?.name ?? `Chain ${chainId}`;

  const morphoHref = morphoMarketHref(marketId, chainId);
  const pairLabel = market
    ? `${market.collateralSymbol} / ${market.loanSymbol}`
    : 'Market';
  const headerDescription = `Morpho Blue · ${networkName}`;

  const riskMarket = market
    ? asBlueMarketData({
        id: market.marketId,
        marketId: market.marketId,
        loanAsset: {
          address: market.loanAddress ?? '',
          symbol: market.loanSymbol,
          decimals: market.loanDecimals ?? 18,
        },
        collateralAsset: {
          address: market.collateralAddress ?? '',
          symbol: market.collateralSymbol,
          decimals: market.collateralDecimals ?? 18,
        },
        oracleAddress: market.oracleAddress,
        oracle: null,
        irmAddress: market.irmAddress,
        lltv: market.lltv,
        realizedBadDebt:
          market.realizedBadDebt?.usd != null
            ? { usd: market.realizedBadDebt.usd }
            : null,
        state: {
          supplyAssetsUsd: market.supplyAssetsUsd,
          borrowAssetsUsd: market.borrowAssetsUsd,
          collateralAssetsUsd: market.collateralAssetsUsd,
          liquidityAssets: null,
          liquidityAssetsUsd: market.liquidityAssetsUsd,
          utilization: market.utilization,
          supplyApy: market.supplyApy,
          borrowApy: market.borrowApy,
        },
        vaultSupplyAssets: null,
        vaultSupplyAssetsUsd: null,
        vaultTotalAssetsUsd: null,
        marketTotalSupplyUsd: market.supplyAssetsUsd,
      })
    : null;

  return (
    <AppShell
      title={
        market && morphoHref ? (
          <a
            href={morphoHref}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors underline decoration-1 underline-offset-4"
          >
            {pairLabel}
          </a>
        ) : (
          pairLabel
        )
      }
      description={
        morphoHref ? (
          <a
            href={morphoHref}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
          >
            {headerDescription}
          </a>
        ) : (
          headerDescription
        )
      }
      actions={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/markets">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Morpho Markets
            </Link>
          </Button>
          {morphoHref && (
            <Button variant="outline" size="sm" asChild>
              <a href={morphoHref} target="_blank" rel="noopener noreferrer">
                Morpho app
                <ExternalLink className="ml-1 h-4 w-4" />
              </a>
            </Button>
          )}
        </div>
      }
    >
      {isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="pt-6 text-sm text-red-600 dark:text-red-400">
            {error instanceof Error ? error.message : 'Failed to load market'}
          </CardContent>
        </Card>
      )}

      {market && riskMarket && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Market overview</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs text-slate-500">Network</p>
                <p className="font-medium">{networkName}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">LLTV</p>
                <p className="font-medium">{formatLltvPill(market.lltv) ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Market size</p>
                <p className="font-medium">{formatCompactUSD(market.sizeUsd ?? 0)}</p>
                <p className="text-xs text-slate-500">
                  {formatMorphoTokenAmount(market.sizeUsd, market.loanSymbol)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Liquidity</p>
                <p className="font-medium">{formatCompactUSD(market.totalLiquidityUsd ?? 0)}</p>
                <p className="text-xs text-slate-500">
                  Available: {formatCompactUSD(market.liquidityAssetsUsd ?? 0)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Supply</p>
                <p className="font-medium">{formatCompactUSD(market.supplyAssetsUsd ?? 0)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Borrow</p>
                <p className="font-medium">{formatCompactUSD(market.borrowAssetsUsd ?? 0)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Collateral</p>
                <p className="font-medium">{formatCompactUSD(market.collateralAssetsUsd ?? 0)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Utilization</p>
                <p className="font-medium">
                  {market.utilization != null
                    ? formatPercentage(market.utilization * 100)
                    : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Supply APY</p>
                <p className="font-medium">
                  {market.supplyApy != null ? formatPercentage(market.supplyApy * 100) : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Borrow APY</p>
                <p className="font-medium">
                  {market.borrowApy != null ? formatPercentage(market.borrowApy * 100) : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">6H net supply APY</p>
                <p className="font-medium">
                  {market.avgNetSupplyApy != null
                    ? formatPercentage(market.avgNetSupplyApy * 100)
                    : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Spot net supply APY</p>
                <p className="font-medium">
                  {market.netSupplyApy != null
                    ? formatPercentage(market.netSupplyApy * 100)
                    : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Listed</p>
                <Badge variant={market.listed ? 'default' : 'secondary'}>
                  {market.listed ? 'Listed' : 'Not listed'}
                </Badge>
              </div>
              <div>
                <p className="text-xs text-slate-500">Realized bad debt</p>
                <p className="font-medium tabular-nums">
                  {formatBadDebtUsd(market.realizedBadDebt)}
                </p>
                <p className="text-xs text-slate-500 tabular-nums">
                  {formatBadDebtUnderlying(
                    market.realizedBadDebt,
                    market.loanSymbol,
                    market.loanDecimals ?? 18
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Unrealized bad debt</p>
                <p className="font-medium tabular-nums">
                  {formatBadDebtUsd(market.unrealizedBadDebt)}
                </p>
                <p className="text-xs text-slate-500 tabular-nums">
                  {formatBadDebtUnderlying(
                    market.unrealizedBadDebt,
                    market.loanSymbol,
                    market.loanDecimals ?? 18
                  )}
                </p>
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <p className="text-xs text-slate-500">Market ID</p>
                <p className="font-mono text-xs break-all text-slate-700 dark:text-slate-300">
                  {market.marketId}
                </p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs text-slate-500">Muscadine vault caps</p>
                {market.muscadineVaults.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-2">
                    {market.muscadineVaults.map((v) => (
                      <Button key={v.address} variant="secondary" size="sm" asChild>
                        <Link href={`/vault/${v.address}`}>{v.name}</Link>
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No Muscadine vault market cap enabled</p>
                )}
              </div>
            </CardContent>
          </Card>

          {chainId === BASE_CHAIN_ID && (
            <MarketOraclePanel
              collateralSymbol={market.collateralSymbol}
              loanSymbol={market.loanSymbol}
              chainId={chainId}
              oraclePrice={market.oraclePrice}
              oracleTimestampData={market.oracleTimestampData}
            />
          )}

          {chainId !== BASE_CHAIN_ID ? (
            <Card>
              <CardContent className="pt-6 text-sm text-slate-500 dark:text-slate-400">
                Full risk scoring (oracle freshness and IRM utilization target) is available on
                Base markets only. Switch the network filter on Morpho Markets to Base for this
                market if it exists there.
              </CardContent>
            </Card>
          ) : (
            <MarketRiskDetailCard
              market={riskMarket}
              scores={market.scores}
              oracleTimestampData={market.oracleTimestampData}
              chainId={chainId}
              marketTitleLink="morpho"
            />
          )}
        </div>
      )}
    </AppShell>
  );
}
