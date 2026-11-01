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
  return new Date(unix * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
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

function loanAmount(raw: string | null, decimals: number): number | null {
  if (raw == null) return null;
  try {
    const amount = Number(formatUnits(BigInt(raw), decimals));
    return Number.isFinite(amount) ? amount : null;
  } catch {
    return null;
  }
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

  const latestApr = [...rows].reverse().find((row) => row.apr != null)?.apr ?? null;
  const latestPrice = [...rows].reverse().find((row) => row.price != null)?.price ?? null;
  const latestLoans = [...rows].reverse().find((row) => row.loans != null)?.loans ?? null;
  const latestLoansUsd = [...rows].reverse().find((row) => row.loansUsd != null)?.loansUsd ?? null;
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
