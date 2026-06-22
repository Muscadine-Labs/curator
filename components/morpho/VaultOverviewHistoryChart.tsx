'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useVaultHistory } from '@/lib/hooks/useVaultHistory';
import { TimeRangeFilter } from '@/components/charts/TimeRangeFilter';
import {
  MetricModeFilter,
  type VaultHistoryMetric,
} from '@/components/charts/MetricModeFilter';
import { UsdTokenModeFilter, type AmountUnit } from '@/components/charts/UsdTokenModeFilter';
import { filterDataByRange, type TimeRange } from '@/lib/utils/date-filter';
import {
  formatCompactNumber,
  formatCompactUSD,
  formatFullUSD,
  formatPercentage,
  formatRawTokenAmount,
} from '@/lib/format/number';
import {
  getTokenDisplayDecimals,
  resolveAssetDecimals,
} from '@/lib/format/asset-decimals';

interface VaultOverviewHistoryChartProps {
  vaultAddress: string;
  version?: 'v1' | 'v2';
}

const METRIC_TITLES: Record<VaultHistoryMetric, string> = {
  supplied: 'TVL',
  sharePrice: 'Price per share',
  apy: 'Net APY',
};

function rawPointsToChart(
  points: Array<{ date: string; value: string }>,
  range: TimeRange
): Array<{ date: string; value: number; raw: string }> {
  return filterDataByRange(points, range).map((p) => {
    try {
      return { date: p.date, value: Number(BigInt(p.value)), raw: p.value };
    } catch {
      return { date: p.date, value: Number(p.value), raw: p.value };
    }
  });
}

function computeZoomedYDomain(
  points: ReadonlyArray<{ value: number }>,
  paddingRatio = 0.08
): [number, number] | ['auto', 'auto'] {
  if (points.length === 0) return ['auto', 'auto'];

  const values = points.map((p) => p.value).filter((v) => Number.isFinite(v));
  if (values.length === 0) return ['auto', 'auto'];

  const min = Math.min(...values);
  const max = Math.max(...values);

  if (min === max) {
    const pad = Math.max(Math.abs(min) * 0.05, min === 0 ? 1 : 0.01);
    return [min - pad, max + pad];
  }

  const span = max - min;
  const padding = span * paddingRatio;
  return [min - padding, max + padding];
}

function formatCompactTokenAxis(rawValue: number, chainDecimals: number): string {
  const human = rawValue / 10 ** chainDecimals;
  return formatCompactNumber(human);
}

/**
 * Pick how many fraction digits y-axis ticks need so adjacent ticks are
 * distinguishable. Share-price series often span tiny ranges (e.g. a cbBTC
 * vault moving from 1.00012 to 1.00038 per share), where fixed 2-decimal
 * formatting renders every tick identically.
 */
function axisFractionDigits(domain: [number, number] | ['auto', 'auto']): number {
  if (typeof domain[0] !== 'number' || typeof domain[1] !== 'number') return 2;
  const span = Math.abs(domain[1] - domain[0]);
  if (!Number.isFinite(span) || span <= 0) return 2;
  // ~4-5 ticks per axis; each tick step needs one significant digit.
  const digits = Math.ceil(-Math.log10(span / 4));
  return Math.min(8, Math.max(0, digits));
}

function formatSharePriceAxis(
  value: number,
  unit: AmountUnit,
  fractionDigits: number
): string {
  const formatted = value.toLocaleString('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
  return unit === 'usd' ? `$${formatted}` : formatted;
}

export function VaultOverviewHistoryChart({
  vaultAddress,
}: VaultOverviewHistoryChartProps) {
  const { data, isLoading, error } = useVaultHistory(vaultAddress);
  const [metric, setMetric] = useState<VaultHistoryMetric>('supplied');
  const [range, setRange] = useState<TimeRange>('all');
  const [amountUnit, setAmountUnit] = useState<AmountUnit>('token');

  const chainDecimals = data
    ? resolveAssetDecimals(data.assetSymbol, data.assetDecimals)
    : 18;
  const displayDecimals = data
    ? getTokenDisplayDecimals(data.assetSymbol, chainDecimals)
    : 6;

  const chartPoints = useMemo(() => {
    if (!data?.series) return [];

    const { series } = data;

    if (metric === 'apy') {
      return filterDataByRange(series.apy ?? [], range).map((p) => ({
        date: p.date,
        value: p.value,
        raw: String(p.value),
      }));
    }

    if (metric === 'sharePrice') {
      const shareSeries =
        amountUnit === 'usd' ? series.sharePriceUsd ?? [] : series.sharePrice ?? [];
      return filterDataByRange(shareSeries, range).map((p) => ({
        date: p.date,
        value: p.value,
        raw: String(p.value),
      }));
    }

    const useUsd = amountUnit === 'usd';

    if (useUsd) {
      return filterDataByRange(series.suppliedUsd ?? [], range).map((p) => ({
        date: p.date,
        value: p.value,
        raw: String(p.value),
      }));
    }
    return rawPointsToChart(series.supplied ?? [], range);
  }, [data, metric, range, amountUnit]);

  const yDomain = useMemo(
    () => computeZoomedYDomain(chartPoints),
    [chartPoints]
  );

  const showUnitToggle = metric === 'supplied' || metric === 'sharePrice';

  const sharePriceAxisDigits = useMemo(
    () => axisFractionDigits(yDomain),
    [yDomain]
  );

  const yAxisFormatter = (value: number) => {
    if (metric === 'apy') return formatPercentage(value, 0);
    if (metric === 'sharePrice') {
      return formatSharePriceAxis(value, amountUnit, sharePriceAxisDigits);
    }
    if (amountUnit === 'usd') return formatCompactUSD(value);
    return formatCompactTokenAxis(value, chainDecimals);
  };

  const formatTooltipValue = (value: number, raw: string) => {
    if (metric === 'apy') return formatPercentage(value, 2);
    if (metric === 'sharePrice') {
      if (amountUnit === 'usd') return formatFullUSD(value, 6);
      const symbol = data?.assetSymbol ?? '';
      return `${value.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${symbol}`.trim();
    }
    if (amountUnit === 'usd') return formatFullUSD(value, 2);
    try {
      return `${formatRawTokenAmount(BigInt(raw), chainDecimals, displayDecimals)} ${data?.assetSymbol ?? ''}`.trim();
    } catch {
      return raw;
    }
  };

  const formatXAxisLabel = (tickItem: string) => {
    const date = new Date(tickItem);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">History</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-52 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">History</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-600 dark:text-red-400">
            {error instanceof Error ? error.message : 'Failed to load history'}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-sm">
            {data ? METRIC_TITLES[metric] : 'History'}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <MetricModeFilter value={metric} onChange={setMetric} />
            {showUnitToggle && (
              <UsdTokenModeFilter value={amountUnit} onChange={setAmountUnit} />
            )}
            <TimeRangeFilter value={range} onChange={setRange} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {chartPoints.length === 0 ? (
          <div className="flex h-52 items-center justify-center text-sm text-muted-foreground">
            No historical data for this range
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chartPoints} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={formatXAxisLabel}
                tick={{ fontSize: 10 }}
                minTickGap={32}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={yDomain}
                tickFormatter={(v) => yAxisFormatter(Number(v))}
                tick={{ fontSize: 10 }}
                width={72}
                tickCount={5}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.[0]) return null;
                  const entry = payload[0].payload as { value: number; raw?: string };
                  const value = entry.value;
                  const raw = entry.raw ?? String(value);
                  return (
                    <div className="rounded-lg border bg-background p-2 shadow-md">
                      <p className="mb-1 text-xs font-medium">
                        {new Date(label as string).toLocaleDateString()}
                      </p>
                      <p className="text-xs">{formatTooltipValue(value, raw)}</p>
                    </div>
                  );
                }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
