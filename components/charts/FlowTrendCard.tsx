'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { TimeRange } from '@/lib/utils/date-filter';
import type { SeriesPoint } from '@/lib/utils/series-derivative';
import { derivativeSeriesLabel, useDerivativeSeries } from '@/lib/hooks/useDerivativeSeries';
import { TimeRangeFilter } from '@/components/charts/TimeRangeFilter';
import {
  ViewModeFilter,
  flowViewOrder,
  type ChartViewMode,
} from '@/components/charts/ViewModeFilter';
import { TrendLineChart } from '@/components/charts/TrendLineChart';

interface FlowTrendCardProps {
  title: string;
  /** Lower-case noun for tooltips, e.g. "revenue" → "Daily revenue". */
  noun: string;
  color: string;
  dailyData?: ReadonlyArray<SeriesPoint>;
  cumulativeData?: ReadonlyArray<SeriesPoint>;
  isLoading?: boolean;
}

/**
 * Dashboard flow chart (inflows, fees, revenue): time range + view
 * (Cumulative / 1st derivative / 2nd derivative of the cumulative series).
 * Derivatives are taken over the whole series, then cut to the range, so the
 * first in-range day keeps its predecessor.
 */
export function FlowTrendCard({
  title,
  noun,
  color,
  dailyData,
  cumulativeData,
  isLoading = false,
}: FlowTrendCardProps) {
  const [viewMode, setViewMode] = useState<ChartViewMode>('cumulative');
  const [range, setRange] = useState<TimeRange>('all');
  const order = flowViewOrder(viewMode);
  const { data, smoothing, setSmoothing } = useDerivativeSeries(
    { kind: 'flow', daily: dailyData, cumulative: cumulativeData },
    order,
    range
  );

  const hasData = Boolean(dailyData?.length || cumulativeData?.length);
  const derivative = viewMode !== 'cumulative';

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

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>{title}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <TimeRangeFilter value={range} onChange={setRange} />
            {hasData && <ViewModeFilter value={viewMode} onChange={setViewMode} />}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            No data available
          </div>
        ) : (
          <TrendLineChart
            data={data}
            color={color}
            seriesLabel={order === 0 ? `Cumulative ${noun}` : derivativeSeriesLabel(order, noun)}
            derivative={derivative}
            smoothingDays={smoothing}
            onSmoothingChange={setSmoothing}
          />
        )}
      </CardContent>
    </Card>
  );
}
