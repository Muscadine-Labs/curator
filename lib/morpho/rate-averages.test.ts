import { describe, expect, it } from 'vitest';
import { rateAverages, seriesCoverageDays, trailingRateAverage } from './rate-averages';

const DAY = 86400;
const NOW = 1_800_000_000;

describe('trailingRateAverage', () => {
  it('averages only points inside the window', () => {
    const points = [
      { x: NOW - 10 * DAY, y: 100 },
      { x: NOW - 3 * DAY, y: 4 },
      { x: NOW - 1 * DAY, y: 6 },
    ];
    expect(trailingRateAverage(points, 7, NOW)).toBe(5);
    expect(trailingRateAverage(points, 30, NOW)).toBeCloseTo(110 / 3);
  });

  it('skips null and non-finite samples instead of counting them as 0', () => {
    const points = [
      { x: NOW - 2 * DAY, y: null },
      { x: NOW - 1 * DAY, y: 8 },
      { x: NOW, y: Number.NaN },
    ];
    expect(trailingRateAverage(points, 7, NOW)).toBe(8);
  });

  it('skips a point with a non-finite timestamp in every window', () => {
    const points = [
      { x: Number.NaN, y: 100 },
      { x: NOW - 1 * DAY, y: 2 },
    ];
    expect(trailingRateAverage(points, 7, NOW)).toBe(2);
    expect(trailingRateAverage(points, 90, NOW)).toBe(2);
  });

  it('weights by volume so a dust fill cannot dominate', () => {
    const points = [
      { x: NOW - 2 * DAY, y: 5, weight: 1_000_000 },
      { x: NOW - 1 * DAY, y: 50, weight: 1 },
    ];
    expect(trailingRateAverage(points, 7, NOW)).toBeCloseTo(5, 3);
  });

  it('skips weighted points with zero or invalid weight', () => {
    const points = [
      { x: NOW - 2 * DAY, y: 5, weight: 0 },
      { x: NOW - 1 * DAY, y: 7, weight: Number.NaN },
      { x: NOW, y: 3, weight: 2 },
    ];
    expect(trailingRateAverage(points, 7, NOW)).toBe(3);
  });

  it('returns null when the window has no samples', () => {
    expect(trailingRateAverage([{ x: NOW - 40 * DAY, y: 3 }], 30, NOW)).toBeNull();
    expect(trailingRateAverage([], 7, NOW)).toBeNull();
  });
});

describe('rateAverages', () => {
  it('returns 7/30/90 day windows', () => {
    const points = [
      { x: NOW - 100 * DAY, y: 1 },
      { x: NOW - 60 * DAY, y: 9 },
      { x: NOW, y: 3 },
    ];
    expect(rateAverages(points, NOW)).toEqual([
      { days: 7, value: 3, coveredDays: null },
      { days: 30, value: 3, coveredDays: null },
      { days: 90, value: 6, coveredDays: null },
    ]);
  });

  it('flags windows the series does not reach back to', () => {
    const points = [
      { x: NOW - 20 * DAY, y: 4 },
      { x: NOW, y: 6 },
    ];
    const [d7, d30, d90] = rateAverages(points, NOW);
    expect(d7.coveredDays).toBeNull();
    expect(d30.coveredDays).toBe(20);
    expect(d90.coveredDays).toBe(20);
  });

  it('does not flag a full window whose oldest point is a day short', () => {
    const points = [{ x: NOW - 89.5 * DAY, y: 4 }];
    expect(rateAverages(points, NOW)[2].coveredDays).toBeNull();
  });
});

describe('seriesCoverageDays', () => {
  it('starts at the oldest usable sample, not the oldest point', () => {
    // Complete 180-day Midnight history whose fills began 10 days ago.
    const points = Array.from({ length: 180 }, (_, i) => ({
      x: NOW - (179 - i) * DAY,
      y: i >= 170 ? 5 : null,
      weight: i >= 170 ? 100 : 0,
    }));
    expect(seriesCoverageDays(points, NOW)).toBe(9);
    const [, , d90] = rateAverages(points, NOW);
    expect(d90.value).toBe(5);
    expect(d90.coveredDays).toBe(9);
  });

  it('ignores non-finite timestamps and is null for an empty series', () => {
    expect(seriesCoverageDays([{ x: Number.NaN, y: 1 }, { x: NOW - 3 * DAY, y: 1 }], NOW)).toBe(3);
    expect(seriesCoverageDays([], NOW)).toBeNull();
  });
});
