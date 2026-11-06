/**
 * Rate-of-change views for the dashboard trend charts (TVL, inflows, fees,
 * revenue). Points are daily `{ date: 'YYYY-MM-DD', value }` in USD.
 *
 * - `seriesDerivative` is the per-day change: (vₜ − vₜ₋₁) / days between them,
 *   so a missing day does not double a step. The first point has no
 *   predecessor and is dropped.
 * - `withTrailingAverage` adds `avg7`, the mean of the samples in the trailing
 *   7 calendar days. It is left undefined until a full window exists, so the
 *   start of the series is never a 1-sample "average". Raw second derivatives
 *   of daily flows are mostly noise; the chart draws them faintly under the
 *   bold `avg7`. (A 7-day mean of daily differences telescopes to
 *   (vₜ − vₜ₋₇) / 7: the average daily change over the past week.)
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
  /** Trailing 7-day mean of `value`; undefined until a full window exists. */
  avg7?: number;
}

const DAY_MS = 86_400_000;
export const DERIVATIVE_AVERAGE_DAYS = 7;

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

/** Adds `avg7` (trailing `days`-day mean) to each point. */
export function withTrailingAverage(
  points: ReadonlyArray<SeriesPoint>,
  days: number = DERIVATIVE_AVERAGE_DAYS
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
      avg7: full ? sum / (i - start + 1) : undefined,
    });
  }
  return out;
}

/**
 * `order` derivatives of `points`, each with its trailing average.
 * `order` 0 returns the series itself (with `avg7`).
 */
export function derivativeView(
  points: ReadonlyArray<SeriesPoint>,
  order: 0 | 1 | 2
): DerivativePoint[] {
  let series: ReadonlyArray<SeriesPoint> = order > 0 ? dropPartialDayPoints(points) : points;
  for (let i = 0; i < order; i += 1) series = seriesDerivative(series);
  return withTrailingAverage(series);
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
 * Orders 1 and 2 carry `avg7`.
 */
export function flowViewSeries(
  order: 0 | 1 | 2,
  series: {
    daily?: ReadonlyArray<SeriesPoint> | null;
    cumulative?: ReadonlyArray<SeriesPoint> | null;
  }
): DerivativePoint[] {
  const cumulative =
    series.cumulative && series.cumulative.length > 0
      ? series.cumulative
      : cumulativeFromDaily(series.daily ?? []);
  if (order === 0) return cumulative.map((p) => ({ date: p.date.slice(0, 10), value: p.value }));
  return derivativeView(fillCumulativeDays(dropPartialDayPoints(cumulative)), order);
}

/**
 * Y-axis domain that fits the 7D average (with headroom, always including 0)
 * so the trend stays readable when a few raw days spike far past it. `null`
 * when there is no average to fit — the chart then auto-scales.
 */
export function averageFitDomain(
  points: ReadonlyArray<DerivativePoint>,
  headroom = 1.25
): [number, number] | null {
  let min = 0;
  let max = 0;
  let any = false;
  for (const p of points) {
    if (p.avg7 == null || !Number.isFinite(p.avg7)) continue;
    any = true;
    if (p.avg7 < min) min = p.avg7;
    if (p.avg7 > max) max = p.avg7;
  }
  if (!any || (min === 0 && max === 0)) return null;
  // Round outward to half-steps of the leading magnitude so ticks read cleanly
  // (±27K → ±30K, not ±26.81K).
  const span = Math.max(Math.abs(min), Math.abs(max)) * headroom;
  const step = 10 ** Math.floor(Math.log10(span)) / 2;
  const roundOut = (v: number) => (v < 0 ? -Math.ceil(-v / step) * step : Math.ceil(v / step) * step);
  return [min === 0 ? 0 : roundOut(min * headroom), max === 0 ? 0 : roundOut(max * headroom)];
}
