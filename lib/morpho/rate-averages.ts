/**
 * Trailing averages for daily rate series (APY / APR history charts).
 *
 * Shared by the Blue market Rates panel, the vault history APY chart and the
 * Midnight APR chart so every "7D / 30D / 90D average" uses the same rule:
 * the simple mean of the daily samples whose timestamp falls inside the last
 * `days` days. Missing samples (`null`, non-finite) are skipped — a Midnight
 * day with no fills has no rate, it is not a 0% day.
 */

export const RATE_AVERAGE_WINDOWS = [7, 30, 90] as const;
export type RateAverageWindow = (typeof RATE_AVERAGE_WINDOWS)[number];

export interface RatePoint {
  /** Unix seconds. */
  x: number;
  y: number | null;
}

/** Mean of `y` over points with `x >= nowSec − days·86400`; `null` when none. */
export function trailingRateAverage(
  points: ReadonlyArray<RatePoint>,
  days: number,
  nowSec: number = Date.now() / 1000
): number | null {
  const since = nowSec - days * 86400;
  let sum = 0;
  let count = 0;
  for (const p of points) {
    if (p.x < since || p.y == null || !Number.isFinite(p.y)) continue;
    sum += p.y;
    count += 1;
  }
  return count === 0 ? null : sum / count;
}

export interface RateAverage {
  days: RateAverageWindow;
  value: number | null;
}

/** 7D / 30D / 90D trailing averages, in the series' own unit. */
export function rateAverages(
  points: ReadonlyArray<RatePoint>,
  nowSec: number = Date.now() / 1000
): RateAverage[] {
  return RATE_AVERAGE_WINDOWS.map((days) => ({
    days,
    value: trailingRateAverage(points, days, nowSec),
  }));
}
