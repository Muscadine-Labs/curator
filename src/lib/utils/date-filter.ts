/**
 * Date/range filtering helpers for chart data.
 *
 * We always hide anything before the product launch cutoff (June 1, 2025 UTC).
 * On top of that, the user can narrow to the last week / last month / all time.
 */
import { utcDayStartMs, utcTodayStartMs } from '@/lib/utils/utc-calendar';

const CUTOFF_MS = Date.UTC(2025, 5, 1);

export type TimeRange = 'all' | '90d' | 'month' | 'week';

export const TIME_RANGE_OPTIONS: ReadonlyArray<{ value: TimeRange; label: string }> = [
  { value: 'all', label: 'All Time' },
  { value: '90d', label: '90D' },
  { value: 'month', label: '30D' },
  { value: 'week', label: '7D' },
];

const DAY_MS = 24 * 60 * 60 * 1000;

function rangeStartMs(range: TimeRange): number {
  if (range === 'all') return CUTOFF_MS;
  const today = utcTodayStartMs();
  let days = 30;
  if (range === 'week') days = 7;
  else if (range === 'month') days = 30;
  else if (range === '90d') days = 90;
  const bound = today - days * DAY_MS;
  return bound < CUTOFF_MS ? CUTOFF_MS : bound;
}

export function filterDataByRange<T extends { date: string }>(
  data: T[],
  range: TimeRange
): T[] {
  if (!data || data.length === 0) return data;
  const start = rangeStartMs(range);
  return data.filter((item) => {
    const itemMs = utcDayStartMs(item.date);
    if (!Number.isFinite(itemMs)) return false;
    return itemMs >= start;
  });
}
