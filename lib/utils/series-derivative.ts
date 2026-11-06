/**
 * Rate-of-change views for the dashboard trend charts (TVL, inflows, fees,
 * revenue). Points are daily `{ date: 'YYYY-MM-DD', value }` in USD.
 *
 * - `seriesDerivative` is the per-day change: (vₜ − vₜ₋₁) / days between them,
 *   so a missing day does not double a step. The first point has no
 *   predecessor and is dropped.
 * - Each derivative point carries `trend`, the smoothed line the chart draws
 *   bold (the raw `value` is the optional faint "Daily changes" line).
 *   - 1st derivative: trailing N-day mean of the daily change.
 *   - 2nd derivative: the **slope of that smoothed 1st derivative**,
 *     (mₜ − mₜ₋ₙ) / N. Averaging the raw 2nd derivative instead telescopes to
 *     (dₜ − dₜ₋ₙ) / N — two single raw days — which flipped sign 57× in 240
 *     days on Fees (118× on TVL); the slope of the 7D mean flips 31× (35×),
 *     of the 30D mean 6× (17×).
 *   `trend` is undefined until its window is full, so the series never opens
 *   on a 1-sample "average".
 *
 * Derivatives are taken over the whole series and only then cut to the
 * selected range, so the first in-range point still has its predecessor.
 */
import { utcDayStartMs } from '@/lib/utils/utc-calendar';

export interface SeriesPoint {
  date: string;
  value: number;
}

export interface DerivativePoint extends SeriesPoint {
  /** Smoothed rate of change (see module doc); undefined until its window is full. */
  trend?: number;
}

/** Smoothing window for derivative trends, in days. */
export type SmoothingDays = 7 | 30;
export const SMOOTHING_OPTIONS: ReadonlyArray<SmoothingDays> = [7, 30];
/** 30D: the calm default. 7D turns sooner but wiggles more. */
export const DEFAULT_SMOOTHING_DAYS: SmoothingDays = 30;

const DAY_MS = 86_400_000;

/** Finite points with a parseable date, one per UTC day (last wins), oldest first. */
function normalize(points: ReadonlyArray<SeriesPoint>): Array<SeriesPoint & { ms: number }> {
  const byDay = new Map<number, SeriesPoint & { ms: number }>();
  for (const p of points) {
    const ms = utcDayStartMs(p.date);
    if (!Number.isFinite(ms) || !Number.isFinite(p.value)) continue;
    byDay.set(ms, { date: p.date.slice(0, 10), value: p.value, ms });
  }
  return [...byDay.values()].sort((a, b) => a.ms - b.ms);
}

function isIntradayStamp(date: string): boolean {
  if (date.length <= 10) return false;
  const ms = Date.parse(date);
  return Number.isFinite(ms) && ms % DAY_MS !== 0;
}

/**
 * Drops live "so far today" points (stamped mid-day, e.g. `…T20:16:23Z`) from a
 * series whose other points sit at UTC midnight. DefiLlama appends one after
 * today's midnight point: kept, two points share a day and the 1st derivative
 * merges both steps (26.58 + 24.41 shown as 50.99), and a partial day compared
 * with a full one reads as a drop. Series stamped only intraday are kept whole.
 */
export function dropPartialDayPoints<T extends SeriesPoint>(points: ReadonlyArray<T>): T[] {
  const hasMidnight = points.some((p) => !isIntradayStamp(p.date));
  return hasMidnight ? points.filter((p) => !isIntradayStamp(p.date)) : [...points];
}

/** Per-day change of a daily series. */
export function seriesDerivative(points: ReadonlyArray<SeriesPoint>): SeriesPoint[] {
  const sorted = normalize(points);
  const out: SeriesPoint[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const days = (sorted[i].ms - sorted[i - 1].ms) / DAY_MS;
    if (days <= 0) continue;
    out.push({ date: sorted[i].date, value: (sorted[i].value - sorted[i - 1].value) / days });
  }
  return out;
}

/** Adds `trend` = trailing `days`-day mean of `value` (calendar days). */
export function withTrailingAverage(
  points: ReadonlyArray<SeriesPoint>,
  days: number = DEFAULT_SMOOTHING_DAYS
): DerivativePoint[] {
  const sorted = normalize(points);
  if (sorted.length === 0) return [];
  const firstMs = sorted[0].ms;
  const out: DerivativePoint[] = [];
  let start = 0;
  let sum = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    sum += sorted[i].value;
    const windowStart = sorted[i].ms - (days - 1) * DAY_MS;
    while (sorted[start].ms < windowStart) {
      sum -= sorted[start].value;
      start += 1;
    }
    const full = firstMs <= windowStart;
    out.push({
      date: sorted[i].date,
      value: sorted[i].value,
      trend: full ? sum / (i - start + 1) : undefined,
    });
  }
  return out;
}

/**
 * `order` derivatives of `points` with a `days`-day trend (see module doc).
 * `order` 0 returns the series with its trailing mean.
 */
export function derivativeView(
  points: ReadonlyArray<SeriesPoint>,
  order: 0 | 1 | 2,
  days: number = DEFAULT_SMOOTHING_DAYS
): DerivativePoint[] {
  if (order === 0) return withTrailingAverage(points, days);
  const first = seriesDerivative(dropPartialDayPoints(points));
  const smoothedFirst = withTrailingAverage(first, days);
  if (order === 1) return smoothedFirst;

  // Slope of the smoothed 1st derivative over the same window.
  const meanByMs = new Map<number, number>();
  for (const p of smoothedFirst) {
    if (p.trend != null) meanByMs.set(utcDayStartMs(p.date), p.trend);
  }
  return seriesDerivative(first).map((p) => {
    const ms = utcDayStartMs(p.date);
    const now = meanByMs.get(ms);
    const before = meanByMs.get(ms - days * DAY_MS);
    return {
      date: p.date,
      value: p.value,
      trend: now != null && before != null ? (now - before) / days : undefined,
    };
  });
}

/**
 * A cumulative series as one point per UTC day from the day before it starts
 * (0 — nothing had accumulated yet) to its last day. A day missing from the
 * input carries the previous total forward: a cumulative total is flat on a
 * day with no activity. Without this, a jump after a gap would be smeared
 * across the gap by `seriesDerivative`, and the first day's amount would be
 * dropped for lack of a predecessor.
 */
export function fillCumulativeDays(points: ReadonlyArray<SeriesPoint>): SeriesPoint[] {
  const sorted = normalize(points);
  if (sorted.length === 0) return [];
  const out: SeriesPoint[] = [];
  const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  out.push({ date: dayKey(sorted[0].ms - DAY_MS), value: 0 });
  let last = 0;
  let i = 0;
  for (let ms = sorted[0].ms; ms <= sorted[sorted.length - 1].ms; ms += DAY_MS) {
    if (i < sorted.length && sorted[i].ms === ms) {
      last = sorted[i].value;
      i += 1;
    }
    out.push({ date: dayKey(ms), value: last });
  }
  return out;
}

/** Running total of a daily flow, for when only the daily series is available. */
export function cumulativeFromDaily(points: ReadonlyArray<SeriesPoint>): SeriesPoint[] {
  let sum = 0;
  return normalize(points).map((p) => {
    sum += p.value;
    return { date: p.date, value: sum };
  });
}

/**
 * Series for a flow chart (inflows, fees, revenue) at derivative `order` of
 * the **cumulative** series: 0 → cumulative, 1 → its 1st derivative (the
 * daily flow), 2 → its 2nd derivative (the per-day change in the daily flow).
 * Both derivatives come from the cumulative line itself, so they always agree
 * with it; when only daily data exists, the cumulative is its running total.
 * Orders 1 and 2 carry `trend`.
 */
export function flowViewSeries(
  order: 0 | 1 | 2,
  series: {
    daily?: ReadonlyArray<SeriesPoint> | null;
    cumulative?: ReadonlyArray<SeriesPoint> | null;
  },
  days: number = DEFAULT_SMOOTHING_DAYS
): DerivativePoint[] {
  const cumulative =
    series.cumulative && series.cumulative.length > 0
      ? series.cumulative
      : cumulativeFromDaily(series.daily ?? []);
  if (order === 0) return cumulative.map((p) => ({ date: p.date.slice(0, 10), value: p.value }));
  return derivativeView(fillCumulativeDays(dropPartialDayPoints(cumulative)), order, days);
}
