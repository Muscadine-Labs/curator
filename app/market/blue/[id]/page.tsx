'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { ExternalLink } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { MarketRiskDetailCard } from '@/components/morpho/MarketRiskDetailCard';
import { MarketOraclePanel } from '@/components/morpho/MarketOraclePanel';
import { MarketInteractButton } from '@/components/morpho/MarketInteractButton';
import { useCuratorMarketDetail } from '@/lib/hooks/useCuratorMarkets';
import { morphoMarketHref, safeReturnPath } from '@/lib/morpho/morpho-app-links';
import { asBlueMarketData } from '@/lib/morpho/blue-market-data';
import { formatPercentage } from '@/lib/format/number';
import { formatLltvPill } from '@/components/morpho/AllocationListView';
import { TokenUsdValue } from '@/components/morpho/TokenUsdValue';
import { resolveTokenDisplayProps } from '@/lib/format/asset-decimals';
import { BASE_CHAIN_ID, CURATOR_MARKET_NETWORKS, parseCuratorMarketChainId } from '@/lib/constants';
import {
  CuratorKvList,
  CuratorKvRow,
  CuratorPanel,
} from '@/components/morpho/CuratorChrome';

function MarketUsdValue({
  underlying,
  usd,
  assetSymbol,
  decimals,
  compactUsd = false,
}: {
  underlying: string | null | undefined;
  usd: number | null | undefined;
  assetSymbol: string;
  decimals: number;
  compactUsd?: boolean;
}) {
  const { chainDecimals, displayDecimals } = resolveTokenDisplayProps(assetSymbol, decimals);
  return (
    <TokenUsdValue
      underlying={underlying}
      usd={usd}
      assetSymbol={assetSymbol}
      chainDecimals={chainDecimals}
      displayDecimals={displayDecimals}
      compactUsd={compactUsd}
      align="right"
    />
  );
}

export default function CuratorBlueMarketPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const marketId = decodeURIComponent(params.id as string);
  const chainId = parseCuratorMarketChainId(searchParams.get('chainId'));
  const backHref = safeReturnPath(searchParams.get('from')) ?? '/markets';
  const backLabel = backHref.startsWith('/vault/') ? 'Vault' : 'Morpho Markets';

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
          sizeUsd: market.sizeUsd,
          totalLiquidityUsd: market.totalLiquidityUsd,
          supplyAssetsUsd: market.supplyAssetsUsd,
          supplyAssets: market.supplyAssets,
          borrowAssetsUsd: market.borrowAssetsUsd,
          borrowAssets: market.borrowAssets,
          collateralAssetsUsd: market.collateralAssetsUsd,
          collateralAssets: market.collateralAssets,
          liquidityAssets: market.liquidityAssets,
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
      backHref={backHref}
      backLabel={backLabel}
      actions={
        market ? (
          <div className="flex flex-wrap items-center gap-2">
            <MarketInteractButton product="blue" marketId={marketId} chainId={chainId} />
            {morphoHref ? (
              <Button variant="outline" size="sm" asChild>
                <a href={morphoHref} target="_blank" rel="noopener noreferrer">
                  Morpho app
                  <ExternalLink className="ml-1 h-4 w-4" />
                </a>
              </Button>
            ) : null}
          </div>
        ) : morphoHref ? (
          <Button variant="outline" size="sm" asChild>
            <a href={morphoHref} target="_blank" rel="noopener noreferrer">
              Morpho app
              <ExternalLink className="ml-1 h-4 w-4" />
            </a>
          </Button>
        ) : null
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
          <CuratorPanel title="Market overview">
            <CuratorKvList>
              <CuratorKvRow label="Network">{networkName}</CuratorKvRow>
              <CuratorKvRow label="LLTV">{formatLltvPill(market.lltv) ?? '—'}</CuratorKvRow>
              <CuratorKvRow label="Market size">
                <MarketUsdValue
                  underlying={market.supplyAssets}
                  usd={market.sizeUsd}
                  assetSymbol={market.loanSymbol}
                  decimals={market.loanDecimals ?? 18}
                />
              </CuratorKvRow>
              <CuratorKvRow label="Total liquidity">
                <MarketUsdValue
                  underlying={null}
                  usd={market.totalLiquidityUsd}
                  assetSymbol={market.loanSymbol}
                  decimals={market.loanDecimals ?? 18}
                  compactUsd
                />
              </CuratorKvRow>
              <CuratorKvRow label="Available liquidity">
                <MarketUsdValue
                  underlying={market.liquidityAssets}
                  usd={market.liquidityAssetsUsd}
                  assetSymbol={market.loanSymbol}
                  decimals={market.loanDecimals ?? 18}
                />
              </CuratorKvRow>
              <CuratorKvRow label="Supply">
                <MarketUsdValue
                  underlying={market.supplyAssets}
                  usd={market.supplyAssetsUsd}
                  assetSymbol={market.loanSymbol}
                  decimals={market.loanDecimals ?? 18}
                />
              </CuratorKvRow>
              <CuratorKvRow label="Borrow">
                <MarketUsdValue
                  underlying={market.borrowAssets}
                  usd={market.borrowAssetsUsd}
                  assetSymbol={market.loanSymbol}
                  decimals={market.loanDecimals ?? 18}
                />
              </CuratorKvRow>
              <CuratorKvRow label="Collateral">
                <MarketUsdValue
                  underlying={market.collateralAssets}
                  usd={market.collateralAssetsUsd}
                  assetSymbol={market.collateralSymbol}
                  decimals={market.collateralDecimals ?? 18}
                />
              </CuratorKvRow>
              <CuratorKvRow label="Utilization">
                {market.utilization != null
                  ? formatPercentage(market.utilization * 100)
                  : '—'}
              </CuratorKvRow>
              <CuratorKvRow label="Supply APY">
                {market.supplyApy != null ? formatPercentage(market.supplyApy * 100) : '—'}
              </CuratorKvRow>
              <CuratorKvRow label="Borrow APY">
                {market.borrowApy != null ? formatPercentage(market.borrowApy * 100) : '—'}
              </CuratorKvRow>
              <CuratorKvRow label="6H net supply APY">
                {market.avgNetSupplyApy != null
                  ? formatPercentage(market.avgNetSupplyApy * 100)
                  : '—'}
              </CuratorKvRow>
              <CuratorKvRow label="Spot net supply APY">
                {market.netSupplyApy != null
                  ? formatPercentage(market.netSupplyApy * 100)
                  : '—'}
              </CuratorKvRow>
              <CuratorKvRow label="Listed">
                <Badge variant={market.listed ? 'default' : 'secondary'}>
                  {market.listed ? 'Listed' : 'Not listed'}
                </Badge>
              </CuratorKvRow>
              <CuratorKvRow label="Realized bad debt">
                <MarketUsdValue
                  underlying={market.realizedBadDebt?.underlying}
                  usd={market.realizedBadDebt?.usd}
                  assetSymbol={market.loanSymbol}
                  decimals={market.loanDecimals ?? 18}
                />
              </CuratorKvRow>
              <CuratorKvRow label="Unrealized bad debt">
                <MarketUsdValue
                  underlying={market.unrealizedBadDebt?.underlying}
                  usd={market.unrealizedBadDebt?.usd}
                  assetSymbol={market.loanSymbol}
                  decimals={market.loanDecimals ?? 18}
                />
              </CuratorKvRow>
              <CuratorKvRow label="Market ID">
                <p className="break-all font-mono text-xs font-normal">{market.marketId}</p>
              </CuratorKvRow>
              <CuratorKvRow label="Muscadine vault caps">
                {market.muscadineVaults.length > 0 ? (
                  <div className="flex flex-wrap justify-end gap-2">
                    {market.muscadineVaults.map((v) => (
                      <Button key={v.address} variant="secondary" size="sm" asChild>
                        <Link href={`/vault/${v.address}`}>{v.name}</Link>
                      </Button>
                    ))}
                  </div>
                ) : (
                  <span className="font-normal text-muted-foreground">
                    No Muscadine vault market cap enabled
                  </span>
                )}
              </CuratorKvRow>
            </CuratorKvList>
          </CuratorPanel>

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
              <CardContent className="text-sm text-muted-foreground">
                Oracle freshness, feed bounds, and IRM utilization targets still read via the{' '}
                <span className="font-medium text-foreground">Base RPC</span>{' '}
                only. To enable full risk scoring and the oracle panel on{' '}
                <span className="font-medium text-foreground">{networkName}</span>
                , add a {networkName} RPC to the website (server client + env).
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
