'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { formatCompactUSD } from '@/lib/format/number';
import { filterDataByRange, type TimeRange } from '@/lib/utils/date-filter';
import { TimeRangeFilter } from '@/components/charts/TimeRangeFilter';
import { ViewModeFilter, type ChartViewMode } from '@/components/charts/ViewModeFilter';
import { useRevenueSource } from '@/lib/RevenueSourceContext';

interface ChartRevenueProps {
  dailyData?: Array<{ date: string; value: number }>;
  cumulativeData?: Array<{ date: string; value: number }>;
  treasuryDailyData?: Array<{ date: string; value: number }>;
  treasuryCumulativeData?: Array<{ date: string; value: number }>;
  isLoading?: boolean;
  isTreasuryLoading?: boolean;
  title?: string;
}

export function ChartRevenue({
  dailyData,
  cumulativeData,
  treasuryDailyData,
  treasuryCumulativeData,
  isLoading = false,
  isTreasuryLoading = false,
  title = 'Revenue',
}: ChartRevenueProps) {
  const [viewMode, setViewMode] = useState<ChartViewMode>('cumulative');
  const [range, setRange] = useState<TimeRange>('all');
  const { revenueSource } = useRevenueSource();

  const effectiveDaily = useMemo(
    () => (revenueSource === 'treasury' ? treasuryDailyData ?? [] : dailyData ?? []),
    [revenueSource, treasuryDailyData, dailyData]
  );
  const effectiveCumulative = useMemo(
    () => (revenueSource === 'treasury' ? treasuryCumulativeData ?? [] : cumulativeData ?? []),
    [revenueSource, treasuryCumulativeData, cumulativeData]
  );

  const filteredDailyData = useMemo(
    () => filterDataByRange(effectiveDaily, range),
    [effectiveDaily, range]
  );
  const filteredCumulativeData = useMemo(
    () => filterDataByRange(effectiveCumulative, range),
    [effectiveCumulative, range]
  );

  const loading = revenueSource === 'treasury' ? isTreasuryLoading : isLoading;

  const data = useMemo(() => {
    if (viewMode === 'daily' && filteredDailyData.length > 0) {
      return filteredDailyData;
    }
    if (filteredCumulativeData.length > 0) {
      return filteredCumulativeData;
    }
    return filteredDailyData;
  }, [viewMode, filteredDailyData, filteredCumulativeData]);

  const formatTooltipValue = useMemo(() => (value: number) => formatCompactUSD(value), []);
  const formatXAxisLabel = useMemo(
    () => (tickItem: string) => {
      const date = new Date(tickItem);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    },
    []
  );

  const showViewToggle = useMemo(() => {
    const hasDefiToggle = Boolean(dailyData?.length && cumulativeData?.length);
    const hasTreasuryToggle = Boolean(treasuryDailyData?.length && treasuryCumulativeData?.length);
    return (revenueSource === 'defillama' && hasDefiToggle) || (revenueSource === 'treasury' && hasTreasuryToggle);
  }, [revenueSource, dailyData, cumulativeData, treasuryDailyData, treasuryCumulativeData]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>{title}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <TimeRangeFilter value={range} onChange={setRange} />
            {showViewToggle && <ViewModeFilter value={viewMode} onChange={setViewMode} />}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!data || data.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            No data available
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tickFormatter={formatXAxisLabel} tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={(value) => formatCompactUSD(value)} tick={{ fontSize: 12 }} />
              <Tooltip
                formatter={(value) => {
                  const label = viewMode === 'cumulative' ? 'Cumulative Revenue' : 'Daily Revenue';
                  if (value === undefined || value === null) return ['N/A', label];
                  const numValue = typeof value === 'number' ? value : Array.isArray(value) ? value[0] : Number(value);
                  if (isNaN(numValue)) return ['N/A', label];
                  return [formatTooltipValue(numValue), label];
                }}
                labelFormatter={(label) => new Date(label).toLocaleDateString()}
              />
              <Line type="monotone" dataKey="value" stroke="#8b5cf6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
