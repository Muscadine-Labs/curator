'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { ExternalLink } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { MidnightMarketView } from '@/components/morpho/MidnightMarketView';
import { MarketInteractButton } from '@/components/morpho/MarketInteractButton';
import { useMidnightMarketDetail } from '@/lib/hooks/useCuratorMarkets';
import { morphoMidnightMarketHref, safeReturnPath } from '@/lib/morpho/morpho-app-links';
import { formatMidnightMaturityUtc } from '@/lib/morpho/midnight-markets';
import { CURATOR_MARKET_NETWORKS, parseCuratorMarketChainId } from '@/lib/constants';

export default function MidnightMarketPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const marketId = decodeURIComponent(params.id as string);
  const chainId = parseCuratorMarketChainId(searchParams.get('chainId'));
  const backHref = safeReturnPath(searchParams.get('from')) ?? '/markets';
  const backLabel = backHref.startsWith('/vault/') ? 'Vault' : 'Morpho Markets';

  const { data, isLoading, error } = useMidnightMarketDetail(marketId, chainId);
  const market = data?.market;
  const networkName =
    CURATOR_MARKET_NETWORKS.find((n) => n.chainId === chainId)?.name ?? `Chain ${chainId}`;

  const morphoHref = morphoMidnightMarketHref(marketId, chainId);
  const pairLabel = market
    ? `${market.loanSymbol} | ${market.collateralLabel} ${market.lltvLabel}`
    : 'Midnight market';
  const maturityUtc = market ? formatMidnightMaturityUtc(market.maturity) : null;
  const headerDescription = market
    ? `Morpho Midnight · ${networkName} · ${maturityUtc}`
    : `Morpho Midnight · ${networkName}`;

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
      description={headerDescription}
      backHref={backHref}
      backLabel={backLabel}
      actions={
        market ? (
          <MarketInteractButton product="midnight" marketId={marketId} chainId={chainId} />
        ) : morphoHref ? (
          <Button variant="outline" size="sm" asChild>
            <a href={morphoHref} target="_blank" rel="noopener noreferrer">
              Morpho Markets
              <ExternalLink className="ml-1 h-4 w-4" />
            </a>
          </Button>
        ) : null
      }
    >
      {isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="pt-6 text-sm text-red-600 dark:text-red-400">
            {error instanceof Error ? error.message : 'Failed to load Midnight market'}
          </CardContent>
        </Card>
      )}

      {market && <MidnightMarketView market={market} />}
    </AppShell>
  );
}
