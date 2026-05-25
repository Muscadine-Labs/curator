'use client';

import { useVaultV1MarketRisk } from '@/lib/hooks/useVaultV1MarketRisk';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { isMarketIdle } from '@/lib/morpho/compute-v1-market-risk';
import { MarketRiskDetailCard } from '@/components/morpho/MarketRiskDetailCard';

interface MarketRiskV1Props {
  vaultAddress: string;
  preloadedData?: import('@/app/api/vaults/v1/[id]/market-risk/route').V1VaultMarketRiskResponse | null;
}

export function MarketRiskV1({ vaultAddress, preloadedData }: MarketRiskV1Props) {
  const { data: fetchedData, isLoading, error } = useVaultV1MarketRisk(vaultAddress);
  const data = preloadedData ?? fetchedData;

  if (!preloadedData && isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Market Risk</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-20 w-full" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Market Risk</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-600 dark:text-red-400">
            Failed to load market risk data: {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.markets.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Market Risk</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-center py-8 text-slate-500 dark:text-slate-400">
            No markets found for this vault
          </p>
        </CardContent>
      </Card>
    );
  }

  const sortedMarkets = [...data.markets]
    .sort((a, b) => {
      const aSupply = a.market.vaultSupplyAssetsUsd ?? 0;
      const bSupply = b.market.vaultSupplyAssetsUsd ?? 0;
      if (aSupply !== bSupply) return bSupply - aSupply;
      const aIsIdle = isMarketIdle(a.market);
      const bIsIdle = isMarketIdle(b.market);
      if (aIsIdle && !bIsIdle) return 1;
      if (!aIsIdle && bIsIdle) return -1;
      return 0;
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Market Risk</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {sortedMarkets.map(({ market, scores, oracleTimestampData }) => (
          <MarketRiskDetailCard
            key={market.uniqueKey || market.id}
            market={market}
            scores={scores}
            oracleTimestampData={oracleTimestampData}
          />
        ))}
      </CardContent>
    </Card>
  );
}
