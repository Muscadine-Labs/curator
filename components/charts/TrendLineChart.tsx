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
import type { DerivativePoint } from '@/lib/utils/series-derivative';

interface TrendLineChartProps {
  data: ReadonlyArray<DerivativePoint>;
  color: string;
  /** Tooltip name of the per-day series, e.g. "Daily revenue (1st derivative)". */
  seriesLabel: string;
  /**
   * A rate-of-change view. Shows the 7D average (the rate of change) with a
   * zero line; the **Daily changes** switch adds each day's actual value.
   */
  derivative?: boolean;
}

const AVERAGE_LABEL = '7D avg';

/**
 * Single-series USD trend line shared by the dashboard charts.
 *
 * Derivative views default to the 7D average alone: day-to-day changes swing
 * far past the trend, so drawing both by default buried the rate of change.
 * The switch draws the daily values faintly underneath, at full scale.
 * With too little history for a 7-day average the daily values always show.
 */
export function TrendLineChart({ data, color, seriesLabel, derivative = false }: TrendLineChartProps) {
  const [showDaily, setShowDaily] = useState(false);
  const hasAverage = derivative && data.some((p) => p.avg7 != null);
  const drawAverage = hasAverage;
  const drawDaily = !derivative || !hasAverage || showDaily;

  // Signs only where a drawn series goes negative ("+$28" daily fees reads oddly).
  const signed =
    derivative &&
    data.some((p) => (drawDaily && p.value < 0) || (drawAverage && (p.avg7 ?? 0) < 0));
  const format = signed ? formatSignedCompactUSD : formatCompactUSD;

  return (
    <>
      {derivative && (
        <div className="mb-1 flex justify-end">
          <Switch
            checked={drawDaily}
            onCheckedChange={setShowDaily}
            label="Daily changes"
            disabled={!hasAverage}
            title={hasAverage ? undefined : 'Under 7 days of data: showing daily values'}
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
              const label = name === 'avg7' ? AVERAGE_LABEL : seriesLabel;
              const num = typeof value === 'number' ? value : Number(value);
              return [Number.isFinite(num) ? format(num) : 'N/A', label];
            }}
            labelFormatter={(label) => formatUtcTooltipDate(String(label ?? ''))}
            itemSorter={(item) => (item.dataKey === 'avg7' ? 1 : 0)}
          />
          {drawDaily && (
            <Line
              type="monotone"
              dataKey="value"
              name="value"
              stroke={color}
              strokeWidth={drawAverage ? 1 : 2}
              strokeOpacity={drawAverage ? 0.35 : 1}
              dot={false}
              isAnimationActive={false}
            />
          )}
          {drawAverage && (
            <Line
              type="monotone"
              dataKey="avg7"
              name="avg7"
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
