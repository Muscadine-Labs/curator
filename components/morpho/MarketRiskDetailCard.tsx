'use client';

import { Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatAddress, formatCompactUSD, formatPercentage } from '@/lib/format/number';
import type { MarketRiskScores } from '@/lib/morpho/compute-v1-market-risk';
import { isMarketIdle } from '@/lib/morpho/compute-v1-market-risk';
import type { V1VaultMarketData } from '@/lib/morpho/query-v1-vault-markets';
import { morphoMarketHref } from '@/lib/morpho/morpho-app-links';
import type { OracleTimestampData } from '@/lib/morpho/oracle-utils';
import { getOracleDisplayLines } from '@/lib/morpho/format-risk';
import {
  formatMarketIdentifier,
  getComponentGrade,
  getGradeColor,
  getScoreColor,
} from '@/lib/morpho/market-risk-display';

export interface MarketRiskDetailCardProps {
  market: V1VaultMarketData;
  scores: MarketRiskScores | null;
  oracleTimestampData?: OracleTimestampData | null;
  /** Override supply USD when market.vaultSupplyAssetsUsd is unset (e.g. V2 adapter positions). */
  supplyUsd?: number;
  /** Override vault total for allocation % (e.g. V2 vault TVL). */
  vaultTotalUsd?: number;
  className?: string;
}

export function MarketRiskDetailCard({
  market,
  scores,
  oracleTimestampData,
  supplyUsd: supplyUsdOverride,
  vaultTotalUsd: vaultTotalUsdOverride,
  className,
}: MarketRiskDetailCardProps) {
  const marketName = formatMarketIdentifier(
    market.loanAsset?.symbol,
    market.collateralAsset?.symbol
  );

  const lltvPercent = market.lltv ? (Number(market.lltv) / 1e16).toFixed(2) : 'N/A';
  const isIdle = isMarketIdle(market);
  const vaultSupplyUsd = supplyUsdOverride ?? market.vaultSupplyAssetsUsd ?? 0;
  const vaultTotalUsd = vaultTotalUsdOverride ?? market.vaultTotalAssetsUsd ?? 0;
  const marketTotalSupplyUsd =
    market.marketTotalSupplyUsd ?? market.state?.supplyAssetsUsd ?? 0;

  const vaultAllocationPercent =
    vaultTotalUsd > 0 ? (vaultSupplyUsd / vaultTotalUsd) * 100 : 0;
  const marketSharePercent =
    marketTotalSupplyUsd > 0 ? (vaultSupplyUsd / marketTotalSupplyUsd) * 100 : 0;

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

  const targetUtilizationPct = (scores?.targetUtilization ?? 0.9) * 100;
  const oracleDisplay = getOracleDisplayLines(oracleTimestampData);
  const marketKey = market.uniqueKey || market.id;

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
            {marketKey ? (
              <a
                href={morphoMarketHref(marketKey) ?? undefined}
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
              Vault Supply: {formatCompactUSD(vaultSupplyUsd)} ·{' '}
              {vaultAllocationPercent.toFixed(2)}% of vault ·{' '}
              {marketSharePercent.toFixed(2)}% of market
            </p>
          </div>
        </div>
        {!isIdle && scores && (
          <div className="text-right">
            <Badge
              variant="outline"
              className={cn(
                'px-3 py-1.5 text-sm font-semibold',
                getGradeColor(scores.grade)
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
            <ScorePillar
              label="Liquidation Headroom"
              tooltip="Measures the buffer before liquidation under a price shock. Uses -2.5% shock for same/derivative assets (e.g., USDC/USDC, wstETH/ETH) and -5% for different assets. Higher headroom (positive value) indicates more safety margin. Negative headroom means the position would be underwater."
              score={scores.liquidationHeadroomScore}
              detail={
                headroomRatio !== null
                  ? headroomRatio >= 0
                    ? `Headroom: ${headroomRatio.toFixed(2)}% (${formatCompactUSD(headroom ?? 0)}) @ ${(priceShock * 100).toFixed(1)}% shock`
                    : `Underwater: ${Math.abs(headroomRatio).toFixed(2)}% (${formatCompactUSD(headroom ?? 0)}) @ ${(priceShock * 100).toFixed(1)}% shock`
                  : undefined
              }
            />
            <ScorePillar
              label="Utilization"
              tooltip="Scored relative to the IRM target utilization (gold standard 90%). Hitting 90% earns a perfect score; utilization above target reduces the score."
              score={scores.utilizationScore}
              detail={
                utilization !== null
                  ? `Current: ${utilization.toFixed(2)}% · Gold standard: ${targetUtilizationPct.toFixed(0)}%`
                  : undefined
              }
            />
            <ScorePillar
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
                  : undefined
              }
            />
            <ScorePillar
              label="Oracle Freshness"
              tooltip="Measures how recently the price oracle was updated. Fresh oracles (&lt;1 hour) are most reliable. Stale oracles (&gt;24 hours) increase risk as prices may be outdated. Opaque oracles (no address) receive the lowest score."
              score={scores.oracleScore}
              detail={
                oracleDisplay.lastUpdated
                  ? `Last updated: ${oracleDisplay.lastUpdated}${oracleDisplay.age ? ` (${oracleDisplay.age})` : ''}`
                  : `Last updated: unavailable${market.oracleAddress ? ` · Oracle ${formatAddress(market.oracleAddress)}` : ''}`
              }
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 pt-2 border-t">
            <Metric label="Total Market Size" value={formatCompactUSD(marketTotalSupplyUsd)} />
            <Metric
              label="Total Liquidity"
              value={formatCompactUSD(market.state?.liquidityAssetsUsd ?? 0)}
            />
            <Metric
              label="Supply APR"
              value={
                market.state?.supplyApy != null
                  ? formatPercentage(market.state.supplyApy * 100, 2)
                  : 'N/A'
              }
            />
            <Metric
              label="Borrow APR"
              value={
                market.state?.borrowApy != null
                  ? formatPercentage(market.state.borrowApy * 100, 2)
                  : 'N/A'
              }
            />
          </div>
        </>
      )}
    </div>
  );
}

function ScorePillar({
  label,
  tooltip,
  score,
  detail,
}: {
  label: string;
  tooltip: string;
  score: number;
  detail?: string;
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
      {detail != null && (
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{detail}</p>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">{label}</p>
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{value}</p>
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
