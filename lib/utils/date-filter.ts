/**
 * Date/range filtering helpers for chart data.
 *
 * We always hide anything before the product launch cutoff (June 1, 2025).
 * On top of that, the user can narrow to the last week / last month / all time.
 */
const CUTOFF_DATE = new Date('2025-06-01');

export type TimeRange = 'all' | 'month' | 'week';

export const TIME_RANGE_OPTIONS: ReadonlyArray<{ value: TimeRange; label: string }> = [
  { value: 'all', label: 'All Time' },
  { value: 'month', label: '30D' },
  { value: 'week', label: '7D' },
];

function rangeStart(range: TimeRange): Date {
  if (range === 'all') return CUTOFF_DATE;
  const now = new Date();
  const d = new Date(now);
  if (range === 'week') d.setDate(now.getDate() - 7);
  else if (range === 'month') d.setDate(now.getDate() - 30);
  const bound = d < CUTOFF_DATE ? CUTOFF_DATE : d;
  return bound;
}

export function filterDataByRange<T extends { date: string }>(
  data: T[],
  range: TimeRange
): T[] {
  if (!data || data.length === 0) return data;
  const start = rangeStart(range);
  return data.filter((item) => {
    const itemDate = new Date(item.date);
    return itemDate >= start;
  });
}
