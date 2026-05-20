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
  supplied: 'Total tokens supplied',
  liquidity: 'Liquidity',
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

export function VaultOverviewHistoryChart({
  vaultAddress,
  version,
}: VaultOverviewHistoryChartProps) {
  const { data, isLoading, error } = useVaultHistory(vaultAddress);
  const [metric, setMetric] = useState<VaultHistoryMetric>('supplied');
  const [range, setRange] = useState<TimeRange>('month');
  const [amountUnit, setAmountUnit] = useState<AmountUnit>('token');

  const liquidityUnavailable = data ? !data.liquidityHistoricalAvailable : true;

  const chainDecimals = data
    ? resolveAssetDecimals(data.assetSymbol, data.assetDecimals)
    : 18;
  const displayDecimals = data
    ? getTokenDisplayDecimals(data.assetSymbol, chainDecimals)
    : 6;

  const chartPoints = useMemo(() => {
    if (!data) return [];

    if (metric === 'apy') {
      return filterDataByRange(data.series.apy, range).map((p) => ({
        date: p.date,
        value: p.value,
        raw: String(p.value),
      }));
    }

    const useUsd = amountUnit === 'usd';

    if (metric === 'supplied') {
      if (useUsd) {
        return filterDataByRange(data.series.suppliedUsd, range).map((p) => ({
          date: p.date,
          value: p.value,
          raw: String(p.value),
        }));
      }
      return rawPointsToChart(data.series.supplied, range);
    }

    if (metric === 'liquidity') {
      if (useUsd) {
        return filterDataByRange(data.series.liquidityUsd, range).map((p) => ({
          date: p.date,
          value: p.value,
          raw: String(p.value),
        }));
      }
      return rawPointsToChart(data.series.liquidity, range);
    }

    return [];
  }, [data, metric, range, amountUnit]);

  const showUnitToggle = metric === 'supplied' || metric === 'liquidity';

  const yAxisFormatter = (value: number) => {
    if (metric === 'apy') return formatPercentage(value, 1);
    if (amountUnit === 'usd') return formatFullUSD(value, 2);
    try {
      return formatRawTokenAmount(BigInt(Math.round(value)), chainDecimals, displayDecimals);
    } catch {
      return String(value);
    }
  };

  const formatTooltipValue = (value: number, raw: string) => {
    if (metric === 'apy') return formatPercentage(value, 2);
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

  const showLiquidityNote =
    metric === 'liquidity' && liquidityUnavailable && chartPoints.length === 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-sm">
            {data ? METRIC_TITLES[metric] : 'History'}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <MetricModeFilter
              value={metric}
              onChange={(m) => {
                setMetric(m);
                if (m === 'apy') return;
                if (m === 'liquidity' && liquidityUnavailable) setAmountUnit('usd');
              }}
              liquidityDisabled={liquidityUnavailable}
            />
            {showUnitToggle && (
              <UsdTokenModeFilter
                value={amountUnit}
                onChange={setAmountUnit}
                disabled={metric === 'liquidity' && liquidityUnavailable}
              />
            )}
            <TimeRangeFilter value={range} onChange={setRange} />
          </div>
        </div>
        {data && (
          <p className="text-[11px] text-muted-foreground">
            Liquidity is the withdrawable amount (from Morpho). Historical liquidity is not
            indexed — use the breakdown card for the current value.
          </p>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        {showLiquidityNote ? (
          <div className="flex h-52 items-center justify-center px-4 text-center text-sm text-muted-foreground">
            Morpho does not index historical liquidity. See the breakdown above for the
            current withdrawable amount.
          </div>
        ) : chartPoints.length === 0 ? (
          <div className="flex h-52 items-center justify-center text-sm text-muted-foreground">
            No historical data for this range
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartPoints}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tickFormatter={formatXAxisLabel}
                tick={{ fontSize: 11 }}
                minTickGap={24}
              />
              <YAxis
                tickFormatter={(v) => yAxisFormatter(Number(v))}
                tick={{ fontSize: 11 }}
                width={amountUnit === 'usd' ? 72 : 88}
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
