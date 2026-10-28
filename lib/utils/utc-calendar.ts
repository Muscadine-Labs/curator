/** UTC calendar helpers — statement month keys and chart days are UTC. */

export function utcCalendarYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

export function utcCalendarMonth(now: Date = new Date()): number {
  return now.getUTCMonth() + 1;
}

export function utcMonthKeyFromTimestamp(timestampSec: number): string {
  const d = new Date(timestampSec * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function utcDayKeyFromTimestamp(timestampSec: number): string {
  return new Date(timestampSec * 1000).toISOString().slice(0, 10);
}

/** Parse `YYYY-MM-DD` (or ISO datetime) as a UTC calendar day start (ms). */
export function utcDayStartMs(isoDate: string): number {
  const day = isoDate.slice(0, 10);
  const [y, month, d] = day.split('-').map(Number);
  if (!y || !month || !d) return Number.NaN;
  return Date.UTC(y, month - 1, d);
}

export function utcTodayStartMs(now: Date = new Date()): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

export function monthKeyFromIsoDate(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export function utcMonthsFrom(
  start: Date,
  now: Date = new Date()
): Array<{ year: number; month: number; key: string }> {
  const months: Array<{ year: number; month: number; key: string }> = [];
  let year = start.getUTCFullYear();
  let monthIndex = start.getUTCMonth();
  const endYear = now.getUTCFullYear();
  const endMonth = now.getUTCMonth();

  while (year < endYear || (year === endYear && monthIndex <= endMonth)) {
    months.push({
      year,
      month: monthIndex + 1,
      key: `${year}-${String(monthIndex + 1).padStart(2, '0')}`,
    });
    monthIndex += 1;
    if (monthIndex === 12) {
      monthIndex = 0;
      year += 1;
    }
  }

  return months;
}

/**
 * Drop leading empty periods; keep every month/quarter through the latest
 * row (including $0.00 gaps after the first non-zero period).
 */
export function fromFirstNonZeroPeriod<T extends { month: string }>(
  rows: readonly T[],
  isNonZero: (row: T) => boolean
): T[] {
  const sorted = [...rows].sort((a, b) => a.month.localeCompare(b.month));
  const first = sorted.findIndex(isNonZero);
  if (first < 0) return sorted.slice(-1);
  return sorted.slice(first);
}

/** Whether a `YYYY-MM`, `YYYY-Qn`, or `YYYY` period is fully in the past (UTC). */
export function isUtcPeriodComplete(periodKey: string, now: Date = new Date()): boolean {
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;

  if (/^\d{4}-\d{2}$/.test(periodKey)) {
    const [year, month] = periodKey.split('-').map(Number);
    if (currentYear > year) return true;
    if (currentYear < year) return false;
    return currentMonth > month;
  }

  if (periodKey.includes('-Q')) {
    const [year, quarter] = periodKey.split('-Q').map((v, i) => (i === 0 ? parseInt(v, 10) : parseInt(v, 10)));
    const quarterEndMonth = quarter * 3;
    if (currentYear > year) return true;
    if (currentYear < year) return false;
    return currentMonth > quarterEndMonth;
  }

  if (/^\d{4}$/.test(periodKey)) {
    return currentYear > Number(periodKey);
  }

  return true;
}

export function formatUtcChartTick(isoDate: string): string {
  const ms = utcDayStartMs(isoDate);
  if (!Number.isFinite(ms)) return isoDate;
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** Full UTC calendar label for a `YYYY-MM-DD` (or ISO datetime) chart day. */
export function formatUtcTooltipDate(isoDate: string): string {
  const ms = utcDayStartMs(isoDate);
  if (!Number.isFinite(ms)) return isoDate;
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
