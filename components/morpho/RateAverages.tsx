'use client';

import { formatPercentage } from '@/lib/format/number';
import { rateAverages, type RatePoint } from '@/lib/morpho/rate-averages';

/**
 * Inline 7D / 30D / 90D trailing averages for an APY / APR history chart.
 * `points` are percent values (already × 100) keyed by unix seconds. Uses the
 * same rule as the Blue market Rates breakdown (`trailingRateAverage`).
 */
export function RateAverages({
  points,
  label = 'avg',
  note,
}: {
  points: ReadonlyArray<RatePoint>;
  label?: string;
  note?: string;
}) {
  const averages = rateAverages(points);
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {averages.map(({ days, value }) => (
        <span key={days}>
          {days}D {label}{' '}
          <span className="font-medium tabular-nums text-foreground">
            {value != null ? formatPercentage(value) : '—'}
          </span>
        </span>
      ))}
      {note ? <span>{note}</span> : null}
    </div>
  );
}
