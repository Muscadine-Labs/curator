'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatAddress, formatCompactUSD, formatPercentage } from '@/lib/format/number';
import type { MarketRiskGrade, MarketRiskScores } from '@/lib/morpho/compute-v1-market-risk';
import { isMarketIdle } from '@/lib/morpho/compute-v1-market-risk';
import type { V1VaultMarketData } from '@/lib/morpho/query-v1-vault-markets';
import { morphoMarketHref } from '@/lib/morpho/morpho-app-links';
import type { OracleTimestampData } from '@/lib/morpho/oracle-utils';
import { Info } from 'lucide-react';

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

function getComponentGrade(score: number): MarketRiskGrade {
  if (score >= 93) return 'A+';
  if (score >= 90) return 'A';
  if (score >= 87) return 'A−';
  if (score >= 84) return 'B+';
  if (score >= 80) return 'B';
  if (score >= 77) return 'B−';
  if (score >= 74) return 'C+';
  if (score >= 70) return 'C';
  if (score >= 65) return 'C−';
  if (score >= 60) return 'D';
  return 'F';
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

export interface MarketRiskDetailCardProps {
  market: V1VaultMarketData;
  scores: MarketRiskScores | {
    liquidationHeadroomScore: number;
    utilizationScore: number;
    coverageRatioScore: number;
    oracleScore: number;
    marketRiskScore: number;
    grade: string;
    realizedBadDebt?: number | null;
    unrealizedBadDebt?: number | null;
  } | null;
  oracleTimestampData?: OracleTimestampData | null | {
    chainlinkAddress?: string | null;
    updatedAt?: number | null;
    ageSeconds?: number | null;
  };
  /** When set, replaces the default V1 vault supply subtitle. */
  allocationSubtitle?: string;
  className?: string;
}

export function MarketRiskDetailCard({
  market,
  scores,
  oracleTimestampData,
  allocationSubtitle,
  className,
}: MarketRiskDetailCardProps) {
  const marketName = formatMarketIdentifier(
    market.loanAsset?.symbol,
    market.collateralAsset?.symbol
  );

  const lltvPercent = market.lltv ? (Number(market.lltv) / 1e16).toFixed(2) : 'N/A';
  const isIdle = isMarketIdle(market);
  const vaultSupplyUsd = market.vaultSupplyAssetsUsd ?? 0;
  const vaultTotalUsd = market.vaultTotalAssetsUsd ?? 0;
  const marketTotalSupplyUsd = market.marketTotalSupplyUsd ?? 0;

  const vaultAllocationPercent = vaultTotalUsd > 0 ? (vaultSupplyUsd / vaultTotalUsd) * 100 : 0;
  const marketSharePercent =
    marketTotalSupplyUsd > 0 ? (vaultSupplyUsd / marketTotalSupplyUsd) * 100 : 0;

  const defaultSubtitle = `Vault Supply: ${formatCompactUSD(vaultSupplyUsd)} · ${vaultAllocationPercent.toFixed(2)}% of vault · ${marketSharePercent.toFixed(2)}% of market`;

  const state = market.state;
  const lltvRatio = market.lltv ? Number(market.lltv) / 1e18 : 0;

  const loanAsset = market.loanAsset;
  const collateralAsset = market.collateralAsset;
  const loanSymbol = loanAsset?.symbol?.toUpperCase() || '';
  const collateralSymbol = collateralAsset?.symbol?.toUpperCase() || '';

  const isSameAsset =
    loanAsset &&
    collateralAsset &&
    (loanAsset.address.toLowerCase() === collateralAsset.address.toLowerCase() ||
      loanSymbol === collateralSymbol ||
      (['WSTETH', 'STETH', 'RETH', 'CBETH', 'WETH', 'ETH'].includes(loanSymbol) &&
        ['WSTETH', 'STETH', 'RETH', 'CBETH', 'WETH', 'ETH'].includes(collateralSymbol)) ||
      (['CBBTC', 'LBTC', 'WBTC', 'BTC'].includes(loanSymbol) &&
        ['CBBTC', 'LBTC', 'WBTC', 'BTC'].includes(collateralSymbol)) ||
      ((loanSymbol === 'USDC' || loanSymbol === 'USDC.E') &&
        (collateralSymbol === 'USDC' || collateralSymbol === 'USDC.E')) ||
      ((loanSymbol === 'USDT' || loanSymbol === 'USDT.E') &&
        (collateralSymbol === 'USDT' || collateralSymbol === 'USDT.E')));

  const priceShock = isSameAsset ? 0.025 : 0.05;
  const shockMultiplier = 1 - priceShock;

  const collateralUsd = state?.collateralAssetsUsd ? Number(state.collateralAssetsUsd) : 0;
  const borrowUsd = state?.borrowAssetsUsd ? Number(state.borrowAssetsUsd) : 0;
  const supplyUsd = state?.supplyAssetsUsd ? Number(state.supplyAssetsUsd) : 0;
  const headroom =
    borrowUsd > 0 && collateralUsd > 0
      ? collateralUsd * shockMultiplier * lltvRatio - borrowUsd
      : null;
  const headroomRatio =
    headroom !== null && borrowUsd > 0 ? (headroom / borrowUsd) * 100 : null;

  const utilization =
    state?.utilization !== null && state?.utilization !== undefined
      ? state.utilization * 100
      : supplyUsd > 0
        ? (borrowUsd / supplyUsd) * 100
        : null;

  const availableLiquidityUsd = supplyUsd - borrowUsd;
  const liquidatableBorrow =
    borrowUsd > 0 && collateralUsd > 0
      ? Math.max(0, borrowUsd - collateralUsd * shockMultiplier * lltvRatio)
      : null;
  const coverage =
    liquidatableBorrow !== null && liquidatableBorrow > 0 && availableLiquidityUsd > 0
      ? availableLiquidityUsd / liquidatableBorrow
      : null;

  const oracleAgeHours = oracleTimestampData?.ageSeconds
    ? oracleTimestampData.ageSeconds / 3600
    : null;
  const oracleAgeDays = oracleAgeHours !== null ? oracleAgeHours / 24 : null;

  return (
    <div
      className={cn(
        'border rounded-lg p-4 space-y-4',
        isIdle
          ? 'bg-slate-100/50 dark:bg-slate-800/50 opacity-75'
          : 'bg-slate-50/50 dark:bg-slate-900/50',
        className
      )}
    >
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {market.uniqueKey ? (
              <a
                href={morphoMarketHref(market.uniqueKey) ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-lg hover:text-blue-600 dark:hover:text-blue-400 transition-colors underline decoration-1 underline-offset-2"
              >
                {marketName}
              </a>
            ) : (
              <h3 className="font-semibold text-lg">{marketName}</h3>
            )}
            <span className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              LTV: {lltvPercent}%
            </span>
            {isIdle && (
              <Badge variant="outline" className="text-xs">
                Idle
              </Badge>
            )}
          </div>
          <div className="mt-2">
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 break-words">
              {allocationSubtitle ?? defaultSubtitle}
            </p>
          </div>
        </div>
        {!isIdle && scores && (
          <div className="text-right">
            <Badge
              variant="outline"
              className={cn(
                'px-3 py-1.5 text-sm font-semibold',
                getGradeColor(scores.grade as MarketRiskGrade)
              )}
            >
              {scores.grade} · {scores.marketRiskScore.toFixed(2)}
            </Badge>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Total Risk Score</p>
          </div>
        )}
      </div>

      {!isIdle && scores && scores.realizedBadDebt != null && scores.realizedBadDebt > 1.0 && (
        <div className="rounded-lg border-2 border-red-500/50 bg-red-50 dark:bg-red-950/20 p-3">
          <p className="text-sm font-semibold text-red-700 dark:text-red-400 mb-1">
            ⚠️ Bad Debt Warning
          </p>
          <p className="text-xs text-red-600 dark:text-red-300">
            This market has {formatCompactUSD(scores.realizedBadDebt)} of bad debt. Grade
            automatically set to F.
          </p>
        </div>
      )}

      {!isIdle && scores && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 pt-2 border-t">
            <ComponentScoreBlock
              label="Liquidation Headroom"
              tooltip="Measures the buffer before liquidation under a price shock. Uses -2.5% shock for same/derivative assets (e.g., USDC/USDC, wstETH/ETH) and -5% for different assets. Higher headroom (positive value) indicates more safety margin. Negative headroom means the position would be underwater."
              score={scores.liquidationHeadroomScore}
              detail={
                headroomRatio !== null
                  ? headroomRatio >= 0
                    ? `Headroom: ${headroomRatio.toFixed(2)}% (${formatCompactUSD(headroom ?? 0)}) @ ${(priceShock * 100).toFixed(1)}% shock`
                    : `Underwater: ${Math.abs(headroomRatio).toFixed(2)}% (${formatCompactUSD(headroom ?? 0)}) @ ${(priceShock * 100).toFixed(1)}% shock`
                  : null
              }
            />
            <ComponentScoreBlock
              label="Utilization"
              tooltip="Borrowed ÷ supplied. Target utilization (IRM kink, typically 90%) scores 100. At or below target is not penalized. Above target, the score falls as utilization rises — higher utilization is riskier."
              score={scores.utilizationScore}
              detail={
                utilization !== null
                  ? `Utilization: ${utilization.toFixed(2)}% (target ≈ 90%)`
                  : null
              }
            />
            <ComponentScoreBlock
              label="Coverage Ratio"
              tooltip="The ratio of available liquidity to liquidatable borrows under a price shock. Uses -2.5% shock for same/derivative assets and -5% for different assets. A ratio ≥1.0 means the market can fully cover all liquidations. Lower ratios indicate insufficient liquidity."
              score={scores.coverageRatioScore}
              detail={
                coverage !== null
                  ? `Coverage: ${coverage.toFixed(2)}x @ ${(priceShock * 100).toFixed(1)}% shock${
                      liquidatableBorrow !== null
                        ? ` (${formatCompactUSD(availableLiquidityUsd)} / ${formatCompactUSD(liquidatableBorrow)})`
                        : ''
                    }`
                  : null
              }
            />
            <div>
              <div className="flex items-center gap-1 mb-1">
                <p className="text-xs text-slate-600 dark:text-slate-400">Oracle Freshness</p>
                <InfoTooltip text="Measures how recently the price oracle was updated. Fresh oracles (&lt;1 hour) are most reliable. Stale oracles (&gt;24 hours) increase risk as prices may be outdated. Opaque oracles (no address) receive the lowest score." />
              </div>
              <div className="flex items-center gap-2">
                <p className={cn('text-lg font-semibold', getScoreColor(scores.oracleScore))}>
                  {scores.oracleScore.toFixed(2)}
                </p>
                <Badge
                  variant="outline"
                  className={cn(
                    'text-xs font-semibold px-1.5 py-0.5',
                    getGradeColor(getComponentGrade(scores.oracleScore))
                  )}
                >
                  {getComponentGrade(scores.oracleScore)}
                </Badge>
              </div>
              {oracleTimestampData?.updatedAt ? (
                <OracleAgeDetail
                  updatedAt={oracleTimestampData.updatedAt}
                  oracleAgeHours={oracleAgeHours}
                  oracleAgeDays={oracleAgeDays}
                />
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 break-words">
                  Oracle: {market.oracleAddress ? formatAddress(market.oracleAddress) : 'N/A'}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 pt-2 border-t">
            <div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">Total Market Size</p>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {formatCompactUSD(marketTotalSupplyUsd)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">Total Liquidity</p>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {formatCompactUSD(market.state?.liquidityAssetsUsd ?? 0)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">Supply APR</p>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {market.state?.supplyApy != null
                  ? formatPercentage(market.state.supplyApy * 100, 2)
                  : 'N/A'}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">Borrow APR</p>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {market.state?.borrowApy != null
                  ? formatPercentage(market.state.borrowApy * 100, 2)
                  : 'N/A'}
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function InfoTooltip({ text }: { text: string }) {
  return (
    <div className="group relative">
      <Info
        className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500 cursor-help hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
        aria-label="Information"
      />
      <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block z-50 w-64 p-2 text-xs text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 rounded-md shadow-lg border border-slate-200 dark:border-slate-700 pointer-events-none">
        {text}
        <div className="absolute left-4 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-slate-200 dark:border-t-slate-700" />
      </div>
    </div>
  );
}

function ComponentScoreBlock({
  label,
  tooltip,
  score,
  detail,
}: {
  label: string;
  tooltip: string;
  score: number;
  detail: string | null;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 mb-1">
        <p className="text-xs text-slate-600 dark:text-slate-400">{label}</p>
        <InfoTooltip text={tooltip} />
      </div>
      <div className="flex items-center gap-2">
        <p className={cn('text-lg font-semibold', getScoreColor(score))}>{score.toFixed(2)}</p>
        <Badge
          variant="outline"
          className={cn(
            'text-xs font-semibold px-1.5 py-0.5',
            getGradeColor(getComponentGrade(score))
          )}
        >
          {getComponentGrade(score)}
        </Badge>
      </div>
      {detail && (
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{detail}</p>
      )}
    </div>
  );
}

function OracleAgeDetail({
  updatedAt,
  oracleAgeHours,
  oracleAgeDays,
}: {
  updatedAt: number;
  oracleAgeHours: number | null;
  oracleAgeDays: number | null;
}) {
  const date = new Date(updatedAt * 1000);
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const formatted = `${String(date.getUTCDate()).padStart(2, '0')} ${monthNames[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}:${String(date.getUTCSeconds()).padStart(2, '0')} UTC`;

  let ageText = '';
  if (oracleAgeDays !== null) {
    if (oracleAgeDays < 1) {
      ageText = `${oracleAgeHours?.toFixed(1) ?? 0}h ago`;
    } else if (oracleAgeDays < 7) {
      ageText = `${oracleAgeDays.toFixed(1)}d ago`;
    } else {
      ageText = `${oracleAgeDays.toFixed(0)}d ago`;
    }
  }

  return (
    <div className="mt-1 space-y-0.5">
      <p className="text-xs text-slate-500 dark:text-slate-400">Last update: {formatted}</p>
      {ageText && (
        <p className="text-xs text-slate-500 dark:text-slate-400">Age: {ageText}</p>
      )}
    </div>
  );
}
