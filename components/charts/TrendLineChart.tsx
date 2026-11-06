'use client';

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
import { formatCompactUSD, formatSignedCompactUSD } from '@/lib/format/number';
import { formatUtcChartTick, formatUtcTooltipDate } from '@/lib/utils/utc-calendar';
import { averageFitDomain, type DerivativePoint } from '@/lib/utils/series-derivative';

interface TrendLineChartProps {
  data: ReadonlyArray<DerivativePoint>;
  color: string;
  /** Tooltip name of the plotted series, e.g. "Daily revenue". */
  seriesLabel: string;
  /**
   * A rate-of-change view: values can be negative, so the axis is signed with
   * a zero line, and the raw series is drawn faintly under its bold 7D average.
   */
  derivative?: boolean;
  /** Draw `avg7` (derivative views). */
  showAverage?: boolean;
  /**
   * Scale the axis to the 7D average and clip raw spikes past it. Used on 2nd
   * derivatives, where a few one-day jumps otherwise flatten the trend to 0.
   */
  fitToAverage?: boolean;
}

const AVERAGE_LABEL = '7D avg';

/** Single-series USD trend line shared by the dashboard charts. */
export function TrendLineChart({
  data,
  color,
  seriesLabel,
  derivative = false,
  showAverage = derivative,
  fitToAverage = false,
}: TrendLineChartProps) {
  // Signs only where the series can actually go negative ("+$28" daily fees reads oddly).
  const signed = derivative && data.some((p) => p.value < 0 || (p.avg7 ?? 0) < 0);
  const format = signed ? formatSignedCompactUSD : formatCompactUSD;
  const fitted = fitToAverage && showAverage ? averageFitDomain(data) : null;
  return (
    <>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data as DerivativePoint[]}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tickFormatter={formatUtcChartTick} tick={{ fontSize: 12 }} />
          <YAxis
            tickFormatter={(v) => format(Number(v))}
            tick={{ fontSize: 12 }}
            width={64}
            domain={fitted ?? ['auto', 'auto']}
            allowDataOverflow={fitted != null}
          />
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
          <Line
            type="monotone"
            dataKey="value"
            name="value"
            stroke={color}
            strokeWidth={showAverage ? 1 : 2}
            strokeOpacity={showAverage ? 0.35 : 1}
            dot={false}
            isAnimationActive={false}
          />
          {showAverage && (
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
      {fitted && (
        <p className="mt-1 text-xs text-muted-foreground">
          Axis fits the 7D average; larger single-day moves are clipped (tap a day for its value).
        </p>
      )}
    </>
  );
}
