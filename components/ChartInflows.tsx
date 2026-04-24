'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { formatCompactUSD } from '@/lib/format/number';
import { filterDataByRange, type TimeRange } from '@/lib/utils/date-filter';
import { TimeRangeFilter } from '@/components/charts/TimeRangeFilter';
import { ViewModeFilter, type ChartViewMode } from '@/components/charts/ViewModeFilter';

interface ChartInflowsProps {
  dailyData?: Array<{ date: string; value: number }>;
  cumulativeData?: Array<{ date: string; value: number }>;
  isLoading?: boolean;
  title?: string;
}

export function ChartInflows({
  dailyData,
  cumulativeData,
  isLoading = false,
  title = 'Inflows',
}: ChartInflowsProps) {
  const [viewMode, setViewMode] = useState<ChartViewMode>('cumulative');
  const [range, setRange] = useState<TimeRange>('all');

  const filteredDailyData = useMemo(
    () => filterDataByRange(dailyData || [], range),
    [dailyData, range]
  );
  const filteredCumulativeData = useMemo(
    () => filterDataByRange(cumulativeData || [], range),
    [cumulativeData, range]
  );

  const data =
    viewMode === 'daily' && filteredDailyData.length > 0
      ? filteredDailyData
      : filteredCumulativeData.length > 0
      ? filteredCumulativeData
      : filteredDailyData;

  if (isLoading) {
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

  const formatTooltipValue = (value: number) => formatCompactUSD(value);
  const formatXAxisLabel = (tickItem: string) => {
    const date = new Date(tickItem);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const showToggle = dailyData && cumulativeData;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>{title}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <TimeRangeFilter value={range} onChange={setRange} />
            {showToggle && <ViewModeFilter value={viewMode} onChange={setViewMode} />}
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
                  const label = viewMode === 'daily' ? 'Daily Inflows' : 'Cumulative Inflows';
                  if (value === undefined || value === null) return ['N/A', label];
                  const numValue = typeof value === 'number' ? value : Array.isArray(value) ? value[0] : Number(value);
                  if (isNaN(numValue)) return ['N/A', label];
                  return [formatTooltipValue(numValue), label];
                }}
                labelFormatter={(label) => new Date(label).toLocaleDateString()}
              />
              <Line type="monotone" dataKey="value" stroke="#f59e0b" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
