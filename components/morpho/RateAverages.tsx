'use client';

import { formatPercentage } from '@/lib/format/number';
import { rateAverages, type RatePoint } from '@/lib/morpho/rate-averages';

/**
 * Inline 7D / 30D / 90D trailing averages for an APY / APR history chart.
 * `points` are percent values (already × 100) keyed by unix seconds. Uses the
 * same rule as the Blue market Rates breakdown (`trailingRateAverage`). A
 * window the series does not reach back to says how many days it covers, so
 * a partial history is never shown as a full 90D average.
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
      {averages.map(({ days, value, coveredDays }) => (
        <span
          key={days}
          title={
            coveredDays != null
              ? `Only ${coveredDays} day${coveredDays === 1 ? '' : 's'} of history loaded`
              : undefined
          }
        >
          {days}D {label}{' '}
          <span className="font-medium tabular-nums text-foreground">
            {value != null ? formatPercentage(value) : '—'}
          </span>
          {coveredDays != null && value != null ? <span> ({coveredDays}D data)</span> : null}
        </span>
      ))}
      {note ? <span>{note}</span> : null}
    </div>
  );
}
