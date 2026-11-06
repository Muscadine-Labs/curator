/**
 * Trailing averages for daily rate series (APY / APR history charts).
 *
 * Shared by the Blue market Rates panel, the vault history APY chart and the
 * Midnight APR chart so every "7D / 30D / 90D average" uses the same rule:
 * the mean of the daily samples whose timestamp falls inside the last `days`
 * days. Samples with a missing rate or timestamp (`null`, non-finite) are
 * skipped — a Midnight day with no fills has no rate, it is not a 0% day.
 *
 * `weight` (optional) makes it a weighted mean: Midnight weights each day by
 * the units filled, so a 1-unit dust fill at an outlier price cannot move the
 * 30D average as much as a day with millions filled. A point with weight ≤ 0
 * is skipped; without weights every sample counts once.
 */

export const RATE_AVERAGE_WINDOWS = [7, 30, 90] as const;
export type RateAverageWindow = (typeof RATE_AVERAGE_WINDOWS)[number];

const DAY_SECONDS = 86_400;

export interface RatePoint {
  /** Unix seconds. */
  x: number;
  y: number | null;
  /** Relative weight (e.g. units filled that day). Omit for an equal-weight mean. */
  weight?: number;
}

function sampleWeight(p: RatePoint): number | null {
  if (!Number.isFinite(p.x) || p.y == null || !Number.isFinite(p.y)) return null;
  if (p.weight === undefined) return 1;
  return Number.isFinite(p.weight) && p.weight > 0 ? p.weight : null;
}

/** Weighted mean of `y` over points with `x >= nowSec − days·86400`; `null` when none. */
export function trailingRateAverage(
  points: ReadonlyArray<RatePoint>,
  days: number,
  nowSec: number = Date.now() / 1000
): number | null {
  const since = nowSec - days * DAY_SECONDS;
  let sum = 0;
  let total = 0;
  for (const p of points) {
    if (p.x < since) continue;
    const w = sampleWeight(p);
    if (w == null) continue;
    sum += p.y! * w;
    total += w;
  }
  return total === 0 ? null : sum / total;
}

export interface RateAverage {
  days: RateAverageWindow;
  value: number | null;
  /**
   * Days of history the window actually covers, when the series starts inside
   * the window (a young vault, or a Midnight scan that stopped early). `null`
   * when the series reaches back past the window start.
   */
  coveredDays: number | null;
}

/** Days from the oldest point with a finite timestamp to now; `null` for an empty series. */
export function seriesCoverageDays(
  points: ReadonlyArray<RatePoint>,
  nowSec: number = Date.now() / 1000
): number | null {
  let oldest = Number.POSITIVE_INFINITY;
  for (const p of points) if (Number.isFinite(p.x) && p.x < oldest) oldest = p.x;
  if (!Number.isFinite(oldest)) return null;
  return Math.max(0, (nowSec - oldest) / DAY_SECONDS);
}

/** 7D / 30D / 90D trailing averages, in the series' own unit. */
export function rateAverages(
  points: ReadonlyArray<RatePoint>,
  nowSec: number = Date.now() / 1000
): RateAverage[] {
  const coverage = seriesCoverageDays(points, nowSec);
  return RATE_AVERAGE_WINDOWS.map((days) => ({
    days,
    value: trailingRateAverage(points, days, nowSec),
    // Daily points sit at UTC midnight, so a full window's oldest point can be
    // up to a day short of `days`; only flag a gap larger than that.
    coveredDays: coverage != null && coverage < days - 1 ? Math.max(1, Math.ceil(coverage)) : null,
  }));
}
