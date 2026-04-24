/**
 * @jest-environment node
 *
 * Tests for `lib/utils/date-filter.ts`.
 *
 * The chart filters always hide anything before the product launch cutoff
 * (June 1, 2025). On top of that, the user can narrow to the last 7d / 30d.
 */

import {
  TIME_RANGE_OPTIONS,
  filterDataByRange,
  type TimeRange,
} from '../date-filter';

const DAY_MS = 24 * 60 * 60 * 1000;

// Pin "now" once per file so that repeated isoDaysAgo() calls in the same
// test produce identical strings (avoids 1ms races between Date.now() and
// the comparisons inside filterDataByRange).
const FROZEN_NOW = new Date();

function isoDaysAgo(days: number, from: Date = FROZEN_NOW): string {
  return new Date(from.getTime() - days * DAY_MS).toISOString();
}

describe('TIME_RANGE_OPTIONS', () => {
  test('exposes the three documented options in order', () => {
    expect(TIME_RANGE_OPTIONS.map((o) => o.value)).toEqual(['all', 'month', 'week']);
  });

  test('every option has a non-empty label', () => {
    for (const opt of TIME_RANGE_OPTIONS) {
      expect(opt.label.length).toBeGreaterThan(0);
    }
  });
});

describe('filterDataByRange', () => {
  test('"all" includes everything since the launch cutoff (2025-06-01)', () => {
    const data = [
      { date: '2024-01-01' }, // before cutoff
      { date: '2025-05-31' }, // before cutoff
      { date: '2025-06-01' }, // at cutoff
      { date: '2025-09-15' },
      { date: isoDaysAgo(1) },
    ];
    const out = filterDataByRange(data, 'all');
    expect(out.map((d) => d.date)).toEqual([
      '2025-06-01',
      '2025-09-15',
      isoDaysAgo(1),
    ]);
  });

  test('"week" only keeps points within the last 7 days', () => {
    const data = [
      { date: isoDaysAgo(20) },
      { date: isoDaysAgo(8) },
      { date: isoDaysAgo(6) },
      { date: isoDaysAgo(1) },
    ];
    const out = filterDataByRange(data, 'week');
    expect(out.map((d) => d.date)).toEqual([isoDaysAgo(6), isoDaysAgo(1)]);
  });

  test('"month" only keeps points within the last 30 days', () => {
    const data = [
      { date: isoDaysAgo(60) },
      { date: isoDaysAgo(31) },
      { date: isoDaysAgo(20) },
      { date: isoDaysAgo(1) },
    ];
    const out = filterDataByRange(data, 'month');
    expect(out.map((d) => d.date)).toEqual([isoDaysAgo(20), isoDaysAgo(1)]);
  });

  test('returns empty array unchanged', () => {
    expect(filterDataByRange([], 'all')).toEqual([]);
    expect(filterDataByRange([] as Array<{ date: string }>, 'week')).toEqual([]);
  });

  test('preserves the input shape (extra keys passed through)', () => {
    const data = [{ date: isoDaysAgo(1), value: 42, label: 'A' }];
    const out = filterDataByRange(data, 'week');
    expect(out[0]).toEqual({ date: isoDaysAgo(1), value: 42, label: 'A' });
  });

  test('falls back to the launch cutoff for ranges that would extend past it', () => {
    // Even if "month" wants 30 days back, items before 2025-06-01 must
    // never appear. We can't easily simulate "a month before launch" without
    // mocking Date, so just assert via the "all" semantics: items before
    // the cutoff are never included regardless of range.
    const data = [{ date: '2024-01-01' }];
    expect(filterDataByRange(data, 'all')).toEqual([]);
    expect(filterDataByRange(data, 'month')).toEqual([]);
    expect(filterDataByRange(data, 'week')).toEqual([]);
  });

  test('TimeRange union type is exhaustive in tests', () => {
    const ranges: TimeRange[] = ['all', 'month', 'week'];
    for (const r of ranges) {
      expect(() => filterDataByRange([], r)).not.toThrow();
    }
  });
});
