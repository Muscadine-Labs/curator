'use client';

import { useMemo, useState } from 'react';
import { formatUnits } from 'viem';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { CuratorPanel } from '@/components/morpho/CuratorChrome';
import { RateAverages } from '@/components/morpho/RateAverages';
import {
  formatCompactAmount,
  formatCompactUSD,
  formatPercentage,
  formatPrice,
} from '@/lib/format/number';
import type { MidnightMarketDetail } from '@/lib/morpho/midnight-markets';

const SERIES = '#2563eb';

type RateMode = 'apr' | 'price';
type LoanMode = 'token' | 'usd';

function dateLabel(unix: number): string {
  // Points sit at UTC midnight; local time would show the previous day west of UTC.
  return new Date(unix * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function dayLabel(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(0, 10);
}

function chartNumber(value: unknown): number | null {
  if (value == null || Array.isArray(value)) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function priceAxisDomain(prices: number[]): [number, number] | ['auto', 'auto'] {
  if (prices.length === 0) return ['auto', 'auto'];
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min;
  // A take price sits near 1. Starting the axis at 0 flattens that line.
  const pad = span > 0 ? span * 0.2 : Math.max(Math.abs(min) * 0.001, 0.0005);
  return [min - pad, max + pad];
}

/** Raw lend units as a relative weight; 0 (skipped) when missing or unparsable. */
function lendUnitsWeight(raw: string | null | undefined): number {
  if (!raw) return 0;
  try {
    const weight = Number(BigInt(raw));
    return Number.isFinite(weight) ? weight : 0;
  } catch {
    return 0;
  }
}

function loanAmount(raw: string | null, decimals: number): number | null {
  if (raw == null) return null;
  try {
    const amount = Number(formatUnits(BigInt(raw), decimals));
    return Number.isFinite(amount) ? amount : null;
  } catch {
    return null;
  }
}

/**
 * USD for the live loan total. Prefers the live loan price; else the price
 * implied by the newest day with a non-zero balance. A zero opening balance
 * (first fill after today's UTC midnight) carries no price, so it is never
 * reused as the headline for a positive live total.
 */
function liveLoansUsd(
  liveLoans: number | null,
  priceUsd: number | null | undefined,
  rows: ReadonlyArray<{ loans: number | null; loansUsd: number | null }>,
  lastPointUsd: number | null
): number | null {
  if (liveLoans == null) return lastPointUsd;
  if (liveLoans === 0) return 0;
  if (priceUsd != null && Number.isFinite(priceUsd) && priceUsd > 0) return liveLoans * priceUsd;
  const priced = [...rows]
    .reverse()
    .find((row) => row.loans != null && row.loans > 0 && row.loansUsd != null);
  return priced ? (liveLoans * priced.loansUsd!) / priced.loans! : null;
}

export function MidnightHistoryCharts({ market }: { market: MidnightMarketDetail }) {
  const [rateMode, setRateMode] = useState<RateMode>('apr');
  const [loanMode, setLoanMode] = useState<LoanMode>('token');

  const rows = useMemo(
    () =>
      market.history.map((point) => ({
        x: point.timestamp,
        apr: point.apr == null ? null : point.apr * 100,
        price: point.takePrice,
        loans: loanAmount(point.outstandingAssets, market.loanDecimals),
        loansUsd: point.outstandingUsd,
      })),
    [market.history, market.loanDecimals]
  );

  // Weighted by units filled, matching how each day's APR is volume-weighted.
  const aprAveragePoints = useMemo(
    () =>
      market.history.map((point) => ({
        x: point.timestamp,
        y: point.apr == null ? null : point.apr * 100,
        weight: lendUnitsWeight(point.lendUnits),
      })),
    [market.history]
  );

  const latestApr = [...rows].reverse().find((row) => row.apr != null)?.apr ?? null;
  const latestPrice = [...rows].reverse().find((row) => row.price != null)?.price ?? null;
  // Points are each UTC day's opening balance (Morpho's DAY convention), so the
  // headline uses the live total — the last point would lag today's fills.
  const lastPoint = [...rows].reverse().find((row) => row.loans != null);
  const liveLoans = loanAmount(market.totalUnits, market.loanDecimals);
  const latestLoans = liveLoans ?? lastPoint?.loans ?? null;
  const latestLoansUsd = liveLoansUsd(
    liveLoans,
    market.loanPriceUsd,
    rows,
    lastPoint?.loansUsd ?? null
  );
  const priceDomain = useMemo(
    () =>
      priceAxisDomain(
        rows.flatMap((row) => (row.price != null && row.price > 0 ? [row.price] : []))
      ),
    [rows]
  );

  const rateHeadline =
    rateMode === 'apr'
      ? latestApr == null
        ? '—'
        : formatPercentage(latestApr)
      : latestPrice == null
        ? '—'
        : formatPrice(latestPrice);
  const loanHeadline =
    loanMode === 'usd'
      ? latestLoansUsd == null
        ? '—'
        : formatCompactUSD(latestLoansUsd)
      : latestLoans == null
        ? '—'
        : `${formatCompactAmount(latestLoans)} ${market.loanSymbol}`;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <CuratorPanel
        title={rateMode === 'apr' ? 'APR' : 'Price'}
        description={rateMode === 'apr' ? 'Daily take rate' : 'Daily take price'}
        actions={
          <div className="flex gap-1">
            {(['apr', 'price'] as const).map((mode) => (
              <Button
                key={mode}
                size="sm"
                variant={rateMode === mode ? 'secondary' : 'ghost'}
                onClick={() => setRateMode(mode)}
                className="h-7"
              >
                {mode === 'apr' ? 'APR' : 'Price'}
              </Button>
            ))}
          </div>
        }
      >
        <div className="p-4">
          <p className="text-2xl font-semibold tabular-nums">{rateHeadline}</p>
          {rateMode === 'apr' && rows.length > 0 && (
            <div className="mt-1">
              <RateAverages
                points={aprAveragePoints}
                note="Volume-weighted, days with fills only"
              />
            </div>
          )}
          {rows.length === 0 ? (
            <p className="mt-6 text-sm text-muted-foreground">
              {market.historyAvailable
                ? 'No rate history yet.'
                : 'Rate history is temporarily unavailable.'}
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart
                key={rateMode}
                data={rows}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="x"
                  tickFormatter={dateLabel}
                  tick={{ fontSize: 10 }}
                  minTickGap={32}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  domain={rateMode === 'price' ? priceDomain : [0, 'auto']}
                  tickFormatter={(value) =>
                    rateMode === 'apr' ? formatPercentage(Number(value)) : formatPrice(Number(value))
                  }
                  tick={{ fontSize: 10 }}
                  width={rateMode === 'price' ? 64 : 52}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  labelFormatter={(value) => dayLabel(Number(value))}
                  formatter={(value) => {
                    const parsed = chartNumber(value);
                    if (parsed == null) return '—';
                    return rateMode === 'apr' ? formatPercentage(parsed) : formatPrice(parsed);
                  }}
                />
                <Line
                  type="stepAfter"
                  dataKey={rateMode}
                  stroke={SERIES}
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </CuratorPanel>

      <CuratorPanel
        title="Outstanding loans"
        description="Filled size, daily"
        actions={
          <div className="flex gap-1">
            {(['token', 'usd'] as const).map((mode) => (
              <Button
                key={mode}
                size="sm"
                variant={loanMode === mode ? 'secondary' : 'ghost'}
                onClick={() => setLoanMode(mode)}
                className="h-7 uppercase"
              >
                {mode === 'token' ? market.loanSymbol : 'USD'}
              </Button>
            ))}
          </div>
        }
      >
        <div className="p-4">
          <p className="text-2xl font-semibold tabular-nums">{loanHeadline}</p>
          {rows.length === 0 ? (
            <p className="mt-6 text-sm text-muted-foreground">
              {market.historyAvailable
                ? 'No loan history yet.'
                : 'Loan history is temporarily unavailable.'}
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="x"
                  tickFormatter={dateLabel}
                  tick={{ fontSize: 10 }}
                  minTickGap={32}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(value) =>
                    loanMode === 'usd' ? formatCompactUSD(Number(value)) : formatCompactAmount(Number(value))
                  }
                  tick={{ fontSize: 10 }}
                  width={64}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  labelFormatter={(value) => dayLabel(Number(value))}
                  formatter={(value) => {
                    const parsed = chartNumber(value);
                    if (parsed == null) return '—';
                    return loanMode === 'usd'
                      ? formatCompactUSD(parsed)
                      : `${formatCompactAmount(parsed)} ${market.loanSymbol}`;
                  }}
                />
                <Area
                  type="stepAfter"
                  dataKey={loanMode === 'usd' ? 'loansUsd' : 'loans'}
                  stroke={SERIES}
                  fill={SERIES}
                  fillOpacity={0.12}
                  strokeWidth={2}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </CuratorPanel>
    </div>
  );
}
