import { describe, expect, it } from 'vitest';
import {
  formatUtcTooltipDate,
  fromFirstNonZeroPeriod,
  utcDayClosedBySnapshot,
} from '@/lib/utils/utc-calendar';

type Row = { month: string; income: number };

describe('formatUtcTooltipDate', () => {
  it('labels a date-only string as that UTC day', () => {
    expect(formatUtcTooltipDate('2026-10-28')).toBe('Oct 28, 2026');
  });
});

describe('utcDayClosedBySnapshot', () => {
  it('dates a 00:00 UTC daily point to the day it closes', () => {
    // 2026-10-15T00:00:00Z holds the balance after deposits made on 2026-10-14.
    expect(utcDayClosedBySnapshot(Date.UTC(2026, 9, 15) / 1000)).toBe('2026-10-14');
    expect(utcDayClosedBySnapshot(Date.UTC(2026, 9, 15, 0, 0, 1) / 1000)).toBe('2026-10-15');
  });
});

describe('fromFirstNonZeroPeriod', () => {
  it('drops leading zero periods and keeps trailing zero gaps', () => {
    const rows: Row[] = [
      { month: '2026-06', income: 0 },
      { month: '2026-07', income: 100 },
      { month: '2026-08', income: 0 },
      { month: '2026-09', income: 50 },
    ];

    expect(fromFirstNonZeroPeriod(rows, (r) => r.income !== 0)).toEqual([
      { month: '2026-07', income: 100 },
      { month: '2026-08', income: 0 },
      { month: '2026-09', income: 50 },
    ]);
  });

  it('sorts rows by month before slicing', () => {
    const rows: Row[] = [
      { month: '2026-09', income: 10 },
      { month: '2026-07', income: 0 },
      { month: '2026-08', income: 5 },
    ];

    expect(fromFirstNonZeroPeriod(rows, (r) => r.income > 0)).toEqual([
      { month: '2026-08', income: 5 },
      { month: '2026-09', income: 10 },
    ]);
  });

  it('returns only the latest row when every period is zero', () => {
    const rows: Row[] = [
      { month: '2026-05', income: 0 },
      { month: '2026-06', income: 0 },
    ];

    expect(fromFirstNonZeroPeriod(rows, (r) => r.income !== 0)).toEqual([
      { month: '2026-06', income: 0 },
    ]);
  });
});
