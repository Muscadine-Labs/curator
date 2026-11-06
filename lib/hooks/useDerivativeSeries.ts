'use client';

import { useMemo, useState } from 'react';
import { filterDataByRange, type TimeRange } from '@/lib/utils/date-filter';
import {
  DEFAULT_SMOOTHING_DAYS,
  derivativeView,
  flowViewSeries,
  type DerivativePoint,
  type SeriesPoint,
  type SmoothingDays,
} from '@/lib/utils/series-derivative';

export type DerivativeSource =
  /** A flow (inflows, fees, revenue): derivatives of its cumulative series. */
  | {
      kind: 'flow';
      daily?: ReadonlyArray<SeriesPoint> | null;
      cumulative?: ReadonlyArray<SeriesPoint> | null;
    }
  /** A level (TVL): derivatives of the series itself. */
  | { kind: 'level'; points?: ReadonlyArray<SeriesPoint> | null };

/**
 * Shared wiring for the dashboard derivative charts (`FlowTrendCard`,
 * `ChartTvl`): smoothing state, the derivative over the **whole** series, then
 * the time-range cut. Two memos, so changing only the range re-filters
 * instead of re-deriving the full multi-year series.
 *
 * `order` 0 returns the flow's cumulative series (one point per day); for a
 * level it returns `[]` — the caller draws its own level chart.
 */
export function useDerivativeSeries(
  source: DerivativeSource,
  order: 0 | 1 | 2,
  range: TimeRange
): {
  data: DerivativePoint[];
  smoothing: SmoothingDays;
  setSmoothing: (days: SmoothingDays) => void;
} {
  const [smoothing, setSmoothing] = useState<SmoothingDays>(DEFAULT_SMOOTHING_DAYS);
  const kind = source.kind;
  const daily = source.kind === 'flow' ? source.daily : undefined;
  const cumulative = source.kind === 'flow' ? source.cumulative : undefined;
  const level = source.kind === 'level' ? source.points : undefined;

  const full = useMemo(() => {
    if (kind === 'flow') return flowViewSeries(order, { daily, cumulative }, smoothing);
    if (order === 0) return [];
    return derivativeView(level ?? [], order, smoothing);
  }, [kind, order, daily, cumulative, level, smoothing]);

  const data = useMemo(() => filterDataByRange(full, range), [full, range]);
  return { data, smoothing, setSmoothing };
}

/** Tooltip name for a derivative series, e.g. "Daily fees (1st derivative)". */
export function derivativeSeriesLabel(order: 1 | 2, noun: string): string {
  return order === 1 ? `Daily ${noun} (1st derivative)` : `Change in daily ${noun} (2nd derivative)`;
}
