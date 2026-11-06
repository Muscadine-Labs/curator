import { describe, expect, it } from 'vitest';
import { rateAverages, trailingRateAverage } from './rate-averages';

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

  it('returns null when the window has no samples', () => {
    expect(trailingRateAverage([{ x: NOW - 40 * DAY, y: 3 }], 30, NOW)).toBeNull();
    expect(trailingRateAverage([], 7, NOW)).toBeNull();
  });
});

describe('rateAverages', () => {
  it('returns 7/30/90 day windows', () => {
    const points = [{ x: NOW - 60 * DAY, y: 9 }, { x: NOW, y: 3 }];
    expect(rateAverages(points, NOW)).toEqual([
      { days: 7, value: 3 },
      { days: 30, value: 3 },
      { days: 90, value: 6 },
    ]);
  });
});
