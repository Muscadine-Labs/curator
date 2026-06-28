'use client';

import { AlertTriangle, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatAddress, formatFullUSD, formatPercentage } from '@/lib/format/number';
import { getAddressScanUrl, getScanNameForChain } from '@/lib/constants';
import type { ChainlinkFeedSnapshot, OraclePriceSnapshot } from '@/lib/morpho/oracle-price';
import type { OracleTimestampData } from '@/lib/morpho/oracle-utils';
import { getOracleDisplayLines } from '@/lib/morpho/format-risk';

const FEED_ROLE_LABEL: Record<string, string> = {
  baseFeedOne: 'Base feed 1',
  baseFeedTwo: 'Base feed 2',
  quoteFeedOne: 'Quote feed 1',
  quoteFeedTwo: 'Quote feed 2',
};

function ExplorerAddressLink({
  address,
  chainId,
}: {
  address: string;
  chainId: number;
}) {
  const href = getAddressScanUrl(chainId, address);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-mono text-xs text-blue-600 hover:underline dark:text-blue-400"
    >
      {formatAddress(address)}
      <ExternalLink className="h-3 w-3 shrink-0" />
    </a>
  );
}

function feedSideLabel(role: ChainlinkFeedSnapshot['role']): 'collateral' | 'loan' {
  return role.startsWith('base') ? 'collateral' : 'loan';
}

function feedTitle(
  feed: ChainlinkFeedSnapshot,
  collateralSymbol: string,
  loanSymbol: string
): string {
  if (feed.description) return feed.description;
  const side = feedSideLabel(feed.role);
  const asset = side === 'collateral' ? collateralSymbol : loanSymbol;
  return `${asset} / USD`;
}

function feedSubtitle(
  feed: ChainlinkFeedSnapshot,
  collateralSymbol: string,
  loanSymbol: string
): string {
  const roleLabel = FEED_ROLE_LABEL[feed.role] ?? feed.role;
  const side = feedSideLabel(feed.role);
  const asset = side === 'collateral' ? collateralSymbol : loanSymbol;
  return `${roleLabel} · ${side === 'collateral' ? 'numerator' : 'denominator'} (${asset})`;
}

/** Hide Chainlink sentinel max values (uint192-ish ceilings). */
function formatFeedBound(value: number | null): string {
  if (value == null) return '—';
  if (value > 1e30) return 'Infinite price cap';
  if (value > 0 && value < 0.01) return '<$0.01';
  return formatFullUSD(value);
}

export function MarketOraclePanel({
  collateralSymbol,
  loanSymbol,
  chainId,
  oraclePrice,
  oracleTimestampData,
}: {
  collateralSymbol: string;
  loanSymbol: string;
  chainId: number;
  oraclePrice: OraclePriceSnapshot | null;
  oracleTimestampData?: OracleTimestampData | null;
}) {
  const freshness = getOracleDisplayLines(oracleTimestampData);
  const scanName = getScanNameForChain(chainId);
  const oracleAddress = oraclePrice?.oracleAddress ?? null;
  const oracleScanUrl = oracleAddress ? getAddressScanUrl(chainId, oracleAddress) : null;

  if (!oraclePrice && !oracleTimestampData) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Oracle</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {oraclePrice?.priceWarning && (
          <div className="rounded-lg border border-amber-500/50 bg-amber-50 p-3 dark:bg-amber-950/20">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="space-y-1 text-sm text-amber-800 dark:text-amber-200">
                <p className="font-medium">Oracle price may be stale or bounded</p>
                {oraclePrice.feeds.some((f) => f.atMinBound || f.atMaxBound) && (
                  <p className="text-xs">
                    A Chainlink feed is pinned to its min/max bound — the on-chain oracle cannot
                    report below the floor or above the ceiling.
                  </p>
                )}
                {oraclePrice.mismatchRatio != null &&
                  oraclePrice.spotCollateralUsd != null &&
                  oraclePrice.oracleCollateralUsd != null && (
                    <p className="text-xs">
                      Oracle implies {formatFullUSD(oraclePrice.oracleCollateralUsd)} per{' '}
                      {collateralSymbol} vs Morpho spot{' '}
                      {formatFullUSD(oraclePrice.spotCollateralUsd)} (
                      {formatPercentage(
                        Math.abs(oraclePrice.mismatchRatio - 1) * 100,
                        1
                      )}{' '}
                      gap).
                    </p>
                  )}
              </div>
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs text-slate-500">Oracle contract</p>
            {oracleScanUrl && oracleAddress ? (
              <ExplorerAddressLink address={oracleAddress} chainId={chainId} />
            ) : (
              <p className="font-mono text-xs break-all">—</p>
            )}
            {oracleScanUrl && (
              <p className="text-xs text-slate-500">{scanName}</p>
            )}
          </div>
          <div>
            <p className="text-xs text-slate-500">Oracle collateral price</p>
            <p className="font-medium tabular-nums">
              {oraclePrice?.oracleCollateralUsd != null
                ? formatFullUSD(oraclePrice.oracleCollateralUsd)
                : '—'}
            </p>
            {oraclePrice?.loanPerCollateral != null && (
              <p className="text-xs text-slate-500 tabular-nums">
                {oraclePrice.loanPerCollateral.toLocaleString('en-US', {
                  maximumFractionDigits: 6,
                })}{' '}
                {loanSymbol} / {collateralSymbol}
              </p>
            )}
          </div>
          <div>
            <p className="text-xs text-slate-500">Morpho spot price</p>
            <p className="font-medium tabular-nums">
              {oraclePrice?.spotCollateralUsd != null
                ? formatFullUSD(oraclePrice.spotCollateralUsd)
                : '—'}
            </p>
            <p className="text-xs text-slate-500">Indexed {collateralSymbol} USD</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Oracle freshness</p>
            <p className="font-medium">
              {freshness.lastUpdated
                ? freshness.lastUpdated
                : 'Unavailable'}
            </p>
            {freshness.age && (
              <p className="text-xs text-slate-500">{freshness.age}</p>
            )}
          </div>
        </div>

        {oraclePrice && oraclePrice.feeds.length > 0 && (
          <div className="space-y-2 border-t pt-4">
            <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
              Chainlink feeds
            </p>
            <p className="text-xs text-slate-500">
              Morpho oracle price ≈ (base feeds) ÷ (quote feeds). Base feeds price{' '}
              <span className="font-medium">{collateralSymbol}</span>; quote feeds price{' '}
              <span className="font-medium">{loanSymbol}</span> (often ~$1 for stables).
            </p>
            <div className="space-y-2">
              {oraclePrice.feeds.map((feed) => (
                <div
                  key={`${feed.role}-${feed.address}`}
                  className="rounded-md border px-3 py-2 text-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <p className="font-medium">{feedTitle(feed, collateralSymbol, loanSymbol)}</p>
                      <p className="text-xs text-slate-500">
                        {feedSubtitle(feed, collateralSymbol, loanSymbol)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {feed.atMinBound && (
                        <Badge variant="destructive" className="text-xs">
                          At min bound
                        </Badge>
                      )}
                      {feed.atMaxBound && (
                        <Badge variant="destructive" className="text-xs">
                          At max bound
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="mt-2">
                    <p className="text-xs text-slate-500">{scanName}</p>
                    <ExplorerAddressLink address={feed.address} chainId={chainId} />
                  </div>
                  <div className="mt-2 grid gap-1 text-xs text-slate-600 dark:text-slate-400 sm:grid-cols-3">
                    <span>
                      Reported:{' '}
                      {feed.answerHuman != null
                        ? formatFullUSD(feed.answerHuman)
                        : '—'}
                    </span>
                    <span>Min: {formatFeedBound(feed.minAnswerHuman)}</span>
                    <span>Max: {formatFeedBound(feed.maxAnswerHuman)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
