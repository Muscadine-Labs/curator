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
import { useCuratorMarketDetail } from '@/lib/hooks/useCuratorMarkets';
import { BASE_CHAIN_ID, CURATOR_MARKET_NETWORKS } from '@/lib/constants';
import { morphoMarketHref } from '@/lib/morpho/morpho-app-links';
import { asV1VaultMarketData } from '@/lib/morpho/query-v1-vault-markets';
import { formatCompactUSD, formatPercentage } from '@/lib/format/number';
import { formatLltvPill } from '@/components/morpho/AllocationListView';

export default function CuratorBlueMarketPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const marketId = decodeURIComponent(params.id as string);
  const chainId = Number(searchParams.get('chainId') ?? BASE_CHAIN_ID);

  const { data, isLoading, error } = useCuratorMarketDetail(marketId, chainId);
  const market = data?.market;
  const networkName =
    CURATOR_MARKET_NETWORKS.find((n) => n.chainId === chainId)?.name ?? `Chain ${chainId}`;

  const morphoHref = morphoMarketHref(marketId, chainId);

  const riskMarket = market
    ? asV1VaultMarketData({
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
          market.realizedBadDebtUsd != null ? { usd: market.realizedBadDebtUsd } : null,
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
      title={market ? `${market.collateralSymbol} / ${market.loanSymbol}` : 'Market'}
      description={`Morpho Blue · ${networkName}`}
      actions={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/curator/markets">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Markets
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
                <p className="font-medium">{formatCompactUSD(market.supplyAssetsUsd ?? 0)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Liquidity</p>
                <p className="font-medium">{formatCompactUSD(market.liquidityAssetsUsd ?? 0)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">6H net APY</p>
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
              <div className="sm:col-span-2">
                <p className="text-xs text-slate-500">Muscadine vault caps</p>
                {market.muscadineVaults.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-2">
                    {market.muscadineVaults.map((v) => (
                      <Button key={v.address} variant="secondary" size="sm" asChild>
                        <Link href={`/vault/v2/${v.address}`}>{v.name}</Link>
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No Muscadine vault market cap enabled</p>
                )}
              </div>
            </CardContent>
          </Card>

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
            />
          )}
        </div>
      )}
    </AppShell>
  );
}
