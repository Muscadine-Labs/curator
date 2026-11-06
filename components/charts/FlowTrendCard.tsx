'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { filterDataByRange, type TimeRange } from '@/lib/utils/date-filter';
import { flowViewSeries, type SeriesPoint } from '@/lib/utils/series-derivative';
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

const SERIES_LABEL: Record<ChartViewMode, (noun: string) => string> = {
  cumulative: (noun) => `Cumulative ${noun}`,
  daily: (noun) => `Daily ${noun} (1st derivative)`,
  dailyChange: (noun) => `Change in daily ${noun} (2nd derivative)`,
};

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

  const data = useMemo(
    () =>
      filterDataByRange(
        flowViewSeries(flowViewOrder(viewMode), { daily: dailyData, cumulative: cumulativeData }),
        range
      ),
    [viewMode, dailyData, cumulativeData, range]
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
            seriesLabel={SERIES_LABEL[viewMode](noun)}
            derivative={derivative}
          />
        )}
      </CardContent>
    </Card>
  );
}
