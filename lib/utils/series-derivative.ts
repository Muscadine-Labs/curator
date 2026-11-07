/**
 * Rate-of-change views for the dashboard trend charts (TVL, inflows, fees,
 * revenue). Points are daily `{ date: 'YYYY-MM-DD', value }` in USD.
 *
 * - `seriesDerivative` is the per-day change: (vₜ − vₜ₋₁) / days between them,
 *   so a missing day does not double a step. The first point has no
 *   predecessor and is dropped.
 * - Each derivative point carries `trend`, the smoothed line the chart draws
 *   bold (the raw `value` is the optional faint "Daily changes" line).
 *   Smoothing is a **triangular** N-day average (`triangularTrend`): a mean of
 *   means, so a day's weight ramps in and out instead of switching on and off.
 *   A plain N-day mean steps twice for every large day — when it enters and
 *   when it leaves N days later; on TVL's 30D 2nd derivative those steps
 *   reached 62% of the chart's range (6.6% triangular). Same width and lag.
 *   - 1st derivative: triangular N-day average of the daily change.
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
import { utcDayKeyFromTimestamp, utcDayStartMs } from '@/lib/utils/utc-calendar';

export interface SeriesPoint {
  date: string;
  value: number;
  /** DefiLlama's "so far today" snapshot, tagged at the source (`tagLivePoint`). */
  live?: boolean;
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

const dayKey = (ms: number) => utcDayKeyFromTimestamp(ms / 1000);

/**
 * Drops a live "so far today" snapshot (`live: true`, tagged where the data is
 * built — `lib/defillama/service.ts`). Kept in a per-day derivative, today
 * would hold two steps (26.58 + 24.41 shown as 50.99) and a partial day would
 * read as a drop.
 */
export function dropLivePoints<T extends SeriesPoint>(points: ReadonlyArray<T>): T[] {
  return points.filter((p) => !p.live);
}

/** One point per UTC day (the latest of the day wins), oldest first. */
export function onePointPerDay(points: ReadonlyArray<SeriesPoint>): SeriesPoint[] {
  return normalize(points).map(({ date, value }) => ({ date, value }));
}

/**
 * A level series (TVL) as one point per UTC day: a missing day is linearly
 * interpolated. The per-day change across the gap is unchanged (the step is
 * split evenly either way), but every day now has a derivative point, so the
 * trend — which looks up the mean exactly N days back — has no holes.
 */
export function fillLevelDays(points: ReadonlyArray<SeriesPoint>): SeriesPoint[] {
  const sorted = normalize(points);
  const out: SeriesPoint[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const cur = sorted[i];
    const prev = sorted[i - 1];
    if (prev) {
      const gap = (cur.ms - prev.ms) / DAY_MS;
      for (let d = 1; d < gap; d += 1) {
        out.push({
          date: dayKey(prev.ms + d * DAY_MS),
          value: prev.value + ((cur.value - prev.value) * d) / gap,
        });
      }
    }
    out.push({ date: cur.date, value: cur.value });
  }
  return out;
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
 * Triangular `days`-day average as `trend`: a trailing mean of a trailing mean
 * whose widths add up to `days` (30 → 15 + 16, 7 → 4 + 4). Defined once a
 * full `days`-day span exists, like a plain mean, with the same (days − 1) / 2
 * lag — but a single large day fades in and out instead of stepping.
 * Expects one point per day (callers fill gaps first).
 */
export function triangularTrend(
  points: ReadonlyArray<SeriesPoint>,
  days: number = DEFAULT_SMOOTHING_DAYS
): DerivativePoint[] {
  const first = Math.floor((days + 1) / 2);
  const second = days + 1 - first;
  const pass1 = withTrailingAverage(points, first);
  const defined = pass1.flatMap((p) => (p.trend != null ? [{ date: p.date, value: p.trend }] : []));
  const pass2 = new Map(withTrailingAverage(defined, second).map((p) => [p.date, p.trend]));
  return pass1.map((p) => ({ date: p.date, value: p.value, trend: pass2.get(p.date) }));
}

/**
 * 1st or 2nd derivative of a level series with a `days`-day trend (see module
 * doc). The live snapshot is dropped and missing days are interpolated first.
 */
export function derivativeView(
  points: ReadonlyArray<SeriesPoint>,
  order: 1 | 2,
  days: number = DEFAULT_SMOOTHING_DAYS
): DerivativePoint[] {
  const first = seriesDerivative(fillLevelDays(dropLivePoints(points)));
  const smoothedFirst = triangularTrend(first, days);
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

/**
 * Running total of a daily flow, for when only the daily series is available
 * (treasury revenue). Entries on the same UTC day are **summed** — they are
 * separate flows, unlike level points where the latest wins.
 */
export function cumulativeFromDaily(points: ReadonlyArray<SeriesPoint>): SeriesPoint[] {
  const byDay = new Map<number, number>();
  for (const p of points) {
    const ms = utcDayStartMs(p.date);
    if (!Number.isFinite(ms) || !Number.isFinite(p.value)) continue;
    byDay.set(ms, (byDay.get(ms) ?? 0) + p.value);
  }
  let sum = 0;
  return [...byDay.entries()]
    .sort(([a], [b]) => a - b)
    .map(([ms, value]) => {
      sum += value;
      return { date: dayKey(ms), value: sum };
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
  // One point per day: the live snapshot replaces today's midnight point, so a
  // date never appears twice (it carries the freshest total).
  if (order === 0) return onePointPerDay(cumulative);
  return derivativeView(fillCumulativeDays(dropLivePoints(cumulative)), order, days);
}
