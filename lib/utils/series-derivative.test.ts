import { describe, expect, it } from 'vitest';
import {
  averageFitDomain,
  derivativeView,
  flowViewSeries,
  seriesDerivative,
  withTrailingAverage,
} from './series-derivative';

function days(values: number[], start = '2026-10-01') {
  const t0 = Date.parse(`${start}T00:00:00Z`);
  return values.map((value, i) => ({
    date: new Date(t0 + i * 86_400_000).toISOString().slice(0, 10),
    value,
  }));
}

describe('seriesDerivative', () => {
  it('returns the per-day change and drops the first point', () => {
    expect(seriesDerivative(days([10, 15, 12]))).toEqual([
      { date: '2026-10-02', value: 5 },
      { date: '2026-10-03', value: -3 },
    ]);
  });

  it('divides a step across a missing day', () => {
    const out = seriesDerivative([
      { date: '2026-10-01', value: 0 },
      { date: '2026-10-03', value: 10 },
    ]);
    expect(out).toEqual([{ date: '2026-10-03', value: 5 }]);
  });

  it('sorts, dedupes by day and skips bad points', () => {
    const out = seriesDerivative([
      { date: '2026-10-03', value: 9 },
      { date: '2026-10-01', value: 1 },
      { date: 'not-a-date', value: 100 },
      { date: '2026-10-02', value: Number.NaN },
      { date: '2026-10-02T12:00:00Z', value: 4 },
    ]);
    expect(out).toEqual([
      { date: '2026-10-02', value: 3 },
      { date: '2026-10-03', value: 5 },
    ]);
  });

  it('is empty for fewer than two points', () => {
    expect(seriesDerivative(days([5]))).toEqual([]);
    expect(seriesDerivative([])).toEqual([]);
  });
});

describe('withTrailingAverage', () => {
  it('starts the 7-day average only once a full window exists', () => {
    const out = withTrailingAverage(days([1, 2, 3, 4, 5, 6, 7, 8]));
    expect(out.slice(0, 6).every((p) => p.avg7 === undefined)).toBe(true);
    expect(out[6].avg7).toBe(4);
    expect(out[7].avg7).toBe(5);
  });

  it('averages over calendar days, not sample count', () => {
    const points = [...days([1, 1, 1, 1, 1, 1, 1]), { date: '2026-10-20', value: 9 }];
    expect(withTrailingAverage(points).at(-1)?.avg7).toBe(9);
  });
});

describe('derivativeView', () => {
  it('second derivative of a quadratic is constant', () => {
    const quad = days([0, 1, 4, 9, 16, 25, 36, 49, 64, 81]);
    const second = derivativeView(quad, 2);
    expect(second.every((p) => p.value === 2)).toBe(true);
    expect(second.at(-1)?.avg7).toBe(2);
  });

  it('order 0 keeps the series and adds the average', () => {
    expect(derivativeView(days([3, 3]), 0).map((p) => p.value)).toEqual([3, 3]);
  });
});

describe('flowViewSeries', () => {
  const cumulative = days([0, 10, 30, 60, 100, 150, 210, 280]);
  const daily = days([0, 10, 20, 30, 40, 50, 60, 70]);

  it('order 0 is the cumulative series, else daily', () => {
    expect(flowViewSeries(0, { daily, cumulative })).toEqual(cumulative);
    expect(flowViewSeries(0, { daily, cumulative: [] })).toEqual(daily);
  });

  it('order 1 is the provided daily series with a 7D average', () => {
    const out = flowViewSeries(1, { daily, cumulative });
    expect(out.map((p) => p.value)).toEqual(daily.map((p) => p.value));
    expect(out.at(-1)?.avg7).toBe(40);
  });

  it('order 1 derives daily from cumulative when daily is missing', () => {
    const out = flowViewSeries(1, { cumulative });
    expect(out.map((p) => p.value)).toEqual([10, 20, 30, 40, 50, 60, 70]);
  });

  it('order 2 is the per-day change in daily flow', () => {
    const out = flowViewSeries(2, { daily, cumulative });
    expect(out.every((p) => p.value === 10)).toBe(true);
    expect(out.at(-1)?.avg7).toBe(10);
  });
});

describe('averageFitDomain', () => {
  it('fits the average with headroom and keeps zero in range', () => {
    const pts = [
      { date: 'a', value: 900, avg7: 4 },
      { date: 'b', value: -900, avg7: -2 },
      { date: 'c', value: 1 },
    ];
    expect(averageFitDomain(pts)).toEqual([-2.5, 5]);
    expect(averageFitDomain([{ date: 'a', value: 1, avg7: 8 }])).toEqual([0, 10]);
  });

  it('rounds outward to clean tick values', () => {
    expect(averageFitDomain([{ date: 'a', value: 1, avg7: 21_450 }, { date: 'b', value: 1, avg7: -8_600 }])).toEqual([
      -15_000, 30_000,
    ]);
  });

  it('is null without a usable average', () => {
    expect(averageFitDomain([{ date: 'a', value: 5 }])).toBeNull();
    expect(averageFitDomain([{ date: 'a', value: 5, avg7: 0 }])).toBeNull();
  });
});
