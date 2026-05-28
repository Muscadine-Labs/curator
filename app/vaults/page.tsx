'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ExternalLink } from 'lucide-react';
import { useMemo } from 'react';
import { useMorphoMarkets } from '@/lib/hooks/useMorphoMarkets';
import { useMarketsSupplied } from '@/lib/hooks/useMarkets';
import type { MorphoMarketMetrics } from '@/lib/morpho/types';
import type { SuppliedMarket } from '@/lib/hooks/useMarkets';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { RatingBadge } from '@/components/morpho/RatingBadge';
import { formatCompactUSD, formatPercentage } from '@/lib/format/number';
import { useVaultList } from '@/lib/hooks/useProtocolStats';
import { marketKeyFromGraphQL } from '@/lib/morpho/morpho-app-links';
import { AppShell } from '@/components/layout/AppShell';

type MergedMarket = SuppliedMarket & {
  rating?: number;
  morphoMetrics?: MorphoMarketMetrics;
};

export default function VaultsPage() {
  const router = useRouter();
  const morpho = useMorphoMarkets();
  const supplied = useMarketsSupplied();
  const vaultsQuery = useVaultList();

  const isLoading = morpho.isLoading || supplied.isLoading || vaultsQuery.isLoading;
  const error = morpho.error || supplied.error || vaultsQuery.error;
  const vaults = useMemo(() => vaultsQuery.data || [], [vaultsQuery.data]);

  const mergedMarkets = useMemo(() => {
    if (!supplied.data?.markets || !morpho.data?.markets) return [];

    // Create map using uniqueKey for matching (primary) and id as fallback
    const morphoByUniqueKey = new Map<string, MorphoMarketMetrics>();
    const morphoById = new Map<string, MorphoMarketMetrics>();
    
    morpho.data.markets.forEach((m) => {
      const key = marketKeyFromGraphQL(m.raw);
      if (key) {
        morphoByUniqueKey.set(key, m);
      }
      // Also match by id as fallback
      morphoById.set(m.id, m);
      // Also try matching by raw.id if different
      if (m.raw?.id && m.raw.id !== m.id) {
        morphoById.set(m.raw.id, m);
      }
    });

    return supplied.data.markets.map((market) => {
      // Try to match by uniqueKey first (most reliable)
      let morphoData = morphoByUniqueKey.get(market.uniqueKey);
      
      // Fallback: try matching by id if uniqueKey didn't match
      if (!morphoData && market.uniqueKey) {
        // Sometimes uniqueKey might be stored as id in morpho data
        morphoData = morphoById.get(market.uniqueKey);
      }
      
      return {
        ...market,
        rating: morphoData?.rating ?? null,
        morphoMetrics: morphoData ?? undefined,
      } as MergedMarket;
    });
  }, [supplied.data?.markets, morpho.data?.markets]);

  const vaultSummaries = useMemo(() => {
    if (!supplied.data?.vaultAllocations) return [];

    return vaults.map((vault) => {
      const allocation = supplied.data.vaultAllocations.find(
        (va) => va.address.toLowerCase() === vault.address.toLowerCase()
      );

      const totalSupplied = allocation?.totalSupplyUsd ?? 0;

      const vaultMarkets = mergedMarkets.filter((m) =>
        allocation?.allocations.some((a) => a.marketKey === m.uniqueKey)
      );

      const avgUtilization =
        vaultMarkets.length > 0
          ? vaultMarkets.reduce((sum, m) => sum + (m.state?.utilization ?? 0), 0) / vaultMarkets.length
          : 0;

      const totalRewardApr = vaultMarkets.reduce((sum, m) => {
        const rewards = m.state?.rewards ?? [];
        const rewardApr = rewards.reduce((s, r) => s + (r.supplyApr ?? 0), 0);
        return sum + rewardApr;
      }, 0);

      const avgRating =
        vaultMarkets.filter((m) => m.rating).length > 0
          ? vaultMarkets.filter((m) => m.rating).reduce((sum, m) => sum + (m.rating ?? 0), 0) /
            vaultMarkets.filter((m) => m.rating).length
          : null;

      return {
        vault,
        totalSupplied,
        allocationShare: allocation?.allocations ?? [],
        avgUtilization,
        totalRewardApr,
        avgRating,
        markets: vaultMarkets,
      };
    });
  }, [supplied.data, mergedMarkets, vaults]);


  return (
    <AppShell
      title="Vaults"
      description="Vault allocations with curator risk ratings"
      actions={
        <Button variant="outline" asChild>
          <Link
            href="https://vaultbook.gauntlet.xyz/vaults/morpho-vaults/vault-curation-considerations-a-deeper-dive"
            target="_blank"
            rel="noreferrer"
            className="gap-2"
          >
            Gauntlet VaultBook
            <ExternalLink className="h-4 w-4" />
          </Link>
        </Button>
      }
    >
      <div className="space-y-8">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Error Loading Data</AlertTitle>
            <AlertDescription>
              {morpho.error?.message || supplied.error?.message || 'Failed to load market data'}
            </AlertDescription>
          </Alert>
        ) : null}

        {isLoading ? (
          <LoadingState />
        ) : (
          <>
            <div className="space-y-12">
              {vaultSummaries.map((vaultSummary) => {
                const borderColor =
                  vaultSummary.vault.asset === 'USDC'
                    ? 'border-emerald-500/20'
                    : vaultSummary.vault.asset === 'cbBTC'
                      ? 'border-orange-500/20'
                      : 'border-blue-500/20';

                return (
                  <div key={vaultSummary.vault.id} className="space-y-6">
                    <Link href={`/vaults/${vaultSummary.vault.address}`}>
                      <Card className={`${borderColor} cursor-pointer transition-all duration-200 hover:shadow-lg`}>
                        <CardHeader>
                          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                            <div>
                              <div className="flex items-center gap-3">
                                <CardTitle className="text-2xl">{vaultSummary.vault.name}</CardTitle>
                                <Badge variant="outline">{vaultSummary.vault.asset}</Badge>
                              </div>
                              <CardDescription className="mt-2">
                                {vaultSummary.vault.description}
                              </CardDescription>
                            </div>
                            {vaultSummary.avgRating && (
                              <RatingBadge rating={vaultSummary.avgRating} className="px-3 py-1.5 text-sm" />
                            )}
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                            <StatCard label="Total Supplied" value={formatCompactUSD(vaultSummary.totalSupplied)} />
                            <StatCard
                              label="Revenue (All Time)"
                              value={
                                vaultSummary.vault.revenueAllTime != null
                                  ? formatCompactUSD(vaultSummary.vault.revenueAllTime)
                                  : '—'
                              }
                              className="text-green-600 dark:text-green-400"
                            />
                            <StatCard
                              label="Avg Utilization"
                              value={formatPercentage(vaultSummary.avgUtilization * 100, 2)}
                            />
                            <StatCard
                              label="Reward APR"
                              value={formatPercentage(vaultSummary.totalRewardApr, 2)}
                              className="text-green-600 dark:text-green-400"
                            />
                            <StatCard label="Markets" value={vaultSummary.markets.length.toString()} />
                          </div>
                        </CardContent>
                      </Card>
                    </Link>

                    <Card>
                      <CardHeader>
                        <CardTitle>{vaultSummary.vault.asset} Vault Markets</CardTitle>
                        <CardDescription>
                          Markets where the {vaultSummary.vault.name} is actively supplying capital
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="p-0">
                        {vaultSummary.markets.length > 0 ? (
                          <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-hide">
                            <Table>
                              <TableHeader>
                                <TableRow className="text-xs uppercase tracking-wide">
                                  <TableHead className="min-w-[180px]">Market Pair</TableHead>
                                  <TableHead className="min-w-[140px]">Total Supply</TableHead>
                                  <TableHead className="min-w-[140px]">Total Borrow</TableHead>
                                  <TableHead className="min-w-[120px]">Supply APY</TableHead>
                                  <TableHead className="min-w-[120px]">Borrow APY</TableHead>
                                  <TableHead className="min-w-[120px]">Utilization</TableHead>
                                  <TableHead className="min-w-[140px]">Curator Rating</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {vaultSummary.markets.map((market) => {
                                  const marketLink = market.uniqueKey;
                                  const morphoState = market.morphoMetrics?.raw.state;
                                  const totalSupplyUsd =
                                    morphoState?.supplyAssetsUsd ??
                                    market.state?.supplyAssetsUsd ??
                                    null;
                                  const totalBorrowUsd =
                                    morphoState?.borrowAssetsUsd ??
                                    market.state?.borrowAssetsUsd ??
                                    null;
                                  const supplyApyValue =
                                    morphoState?.supplyApy ??
                                    market.state?.supplyApy ??
                                    null;
                                  const borrowApyValue =
                                    morphoState?.borrowApy ??
                                    market.state?.borrowApy ??
                                    null;
                                  const utilizationValue =
                                    morphoState?.utilization ??
                                    market.state?.utilization ??
                                    null;
                                  const supplyApyPercent =
                                    supplyApyValue !== null ? supplyApyValue * 100 : null;
                                  const borrowApyPercent =
                                    borrowApyValue !== null ? borrowApyValue * 100 : null;
                                  const utilizationPercent =
                                    utilizationValue !== null ? utilizationValue * 100 : null;

                                  return (
                                    <TableRow
                                      key={market.uniqueKey}
                                      className="cursor-pointer transition hover:bg-muted/40"
                                      onClick={() => router.push(`/markets/${marketLink}`)}
                                    >
                                      <TableCell className="font-medium">
                                        <Link
                                          href={`/markets/${marketLink}`}
                                          className="flex items-center gap-2 hover:underline"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <span>{market.collateralAsset?.symbol ?? 'Unknown'}</span>
                                          <span className="text-muted-foreground">/</span>
                                          <span>{market.loanAsset?.symbol ?? 'Unknown'}</span>
                                        </Link>
                                      </TableCell>
                                      <TableCell>
                                        {totalSupplyUsd !== null
                                          ? formatCompactUSD(totalSupplyUsd)
                                          : '—'}
                                      </TableCell>
                                      <TableCell>
                                        {totalBorrowUsd !== null
                                          ? formatCompactUSD(totalBorrowUsd)
                                          : '—'}
                                      </TableCell>
                                      <TableCell className="text-green-600 dark:text-green-400">
                                        {supplyApyPercent !== null
                                          ? formatPercentage(supplyApyPercent, 2)
                                          : '—'}
                                      </TableCell>
                                      <TableCell className="text-orange-600 dark:text-orange-400">
                                        {borrowApyPercent !== null
                                          ? formatPercentage(borrowApyPercent, 2)
                                          : '—'}
                                      </TableCell>
                                      <TableCell>
                                        {utilizationPercent !== null
                                          ? formatPercentage(utilizationPercent, 2)
                                          : '—'}
                                      </TableCell>
                                      <TableCell>
                                        {market.rating ? (
                                          <RatingBadge rating={market.rating} />
                                        ) : (
                                          <span className="text-xs text-muted-foreground">N/A</span>
                                        )}
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          </div>
                        ) : (
                          <div className="p-8 text-center text-muted-foreground">
                            No active markets for this vault
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                );
              })}
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Ratings Digest</CardTitle>
                <CardDescription>Quick overview of all market ratings</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {mergedMarkets
                    .filter((m) => m.rating)
                    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
                    .map((market) => (
                      <div
                        key={market.uniqueKey}
                        className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/40"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">
                            {market.collateralAsset?.symbol} / {market.loanAsset?.symbol}
                          </div>
                          <div className="text-xs text-muted-foreground">{market.uniqueKey}</div>
                        </div>
                        {market.rating && <RatingBadge rating={market.rating} className="ml-2" />}
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}

function StatCard({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border/50 bg-muted/40 px-4 py-3">
      <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold ${className ?? 'text-foreground'}`}>{value}</div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="grid gap-6">
      {[...Array(4)].map((_, idx) => (
        <Card key={idx}>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64 mt-2" />
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[...Array(3)].map((__, rowIdx) => (
                <Skeleton key={rowIdx} className="h-12 w-full" />
              ))}
        </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
