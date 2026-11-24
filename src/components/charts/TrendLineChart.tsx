'use client';

import { useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Switch } from '@/components/ui/switch';
import { formatCompactUSD, formatSignedCompactUSD } from '@/lib/format/number';
import { formatUtcChartTick, formatUtcTooltipDate } from '@/lib/utils/utc-calendar';
import { cn } from '@/lib/utils';
import {
  SMOOTHING_OPTIONS,
  type DerivativePoint,
  type SmoothingDays,
} from '@/lib/utils/series-derivative';

interface TrendLineChartProps {
  data: ReadonlyArray<DerivativePoint>;
  color: string;
  /** Tooltip name of the per-day series, e.g. "Daily revenue (1st derivative)". */
  seriesLabel: string;
  /**
   * A rate-of-change view. Shows the smoothed trend (the rate of change, 7D or
   * 30D per `smoothingDays`) with a zero line; the **Daily changes** switch
   * adds each day's actual value.
   */
  derivative?: boolean;
  /** Smoothing window the `trend` values were built with (derivative views). */
  smoothingDays?: SmoothingDays;
  onSmoothingChange?: (days: SmoothingDays) => void;
}

/**
 * Single-series USD trend line shared by the dashboard charts.
 *
 * Derivative views default to the smoothed trend alone: day-to-day changes
 * swing far past it, so drawing both by default buried the rate of change.
 * The switch draws the daily values faintly underneath, at full scale; the
 * 7D / 30D control picks the smoothing window. With too little history for a
 * trend, the daily values always show.
 */
export function TrendLineChart({
  data,
  color,
  seriesLabel,
  derivative = false,
  smoothingDays,
  onSmoothingChange,
}: TrendLineChartProps) {
  const trendLabel = smoothingDays ? `${smoothingDays}D trend` : 'Trend';
  const [showDaily, setShowDaily] = useState(false);
  const hasAverage = derivative && data.some((p) => p.trend != null);
  const drawDaily = !derivative || !hasAverage || showDaily;

  // Signs only where a drawn series goes negative ("+$28" daily fees reads oddly).
  const signed =
    derivative &&
    data.some((p) => (drawDaily && p.value < 0) || (hasAverage && (p.trend ?? 0) < 0));
  const format = signed ? formatSignedCompactUSD : formatCompactUSD;

  return (
    <>
      {derivative && (
        <div className="mb-1 flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
          {smoothingDays && onSmoothingChange && (
            <div
              role="radiogroup"
              aria-label="Smoothing"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground"
            >
              <span>Smoothing</span>
              <span className="inline-flex rounded-md border border-border p-0.5">
                {SMOOTHING_OPTIONS.map((days) => (
                  <button
                    key={days}
                    type="button"
                    role="radio"
                    aria-checked={smoothingDays === days}
                    onClick={() => onSmoothingChange(days)}
                    className={cn(
                      'min-h-8 touch-manipulation rounded px-2 tabular-nums sm:min-h-6',
                      smoothingDays === days
                        ? 'bg-muted font-medium text-foreground'
                        : 'hover:text-foreground'
                    )}
                  >
                    {days}D
                  </button>
                ))}
              </span>
            </div>
          )}
          <Switch
            checked={drawDaily}
            onCheckedChange={setShowDaily}
            label="Daily changes"
            disabled={!hasAverage}
            title={hasAverage ? undefined : 'Not enough history for a trend: showing daily values'}
          />
        </div>
      )}
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data as DerivativePoint[]}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tickFormatter={formatUtcChartTick} tick={{ fontSize: 12 }} />
          <YAxis tickFormatter={(v) => format(Number(v))} tick={{ fontSize: 12 }} width={64} />
          {derivative && <ReferenceLine y={0} stroke="currentColor" strokeOpacity={0.35} />}
          <Tooltip
            formatter={(value, name) => {
              const label = name === 'trend' ? trendLabel : seriesLabel;
              const num = typeof value === 'number' ? value : Number(value);
              return [Number.isFinite(num) ? format(num) : 'N/A', label];
            }}
            labelFormatter={(label) => formatUtcTooltipDate(String(label ?? ''))}
            itemSorter={(item) => (item.dataKey === 'trend' ? 1 : 0)}
          />
          {drawDaily && (
            <Line
              type="monotone"
              dataKey="value"
              name="value"
              stroke={color}
              strokeWidth={hasAverage ? 1 : 2}
              strokeOpacity={hasAverage ? 0.35 : 1}
              dot={false}
              isAnimationActive={false}
            />
          )}
          {hasAverage && (
            <Line
              type="monotone"
              dataKey="trend"
              name="trend"
              stroke={color}
              strokeWidth={2}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </>
  );
}
