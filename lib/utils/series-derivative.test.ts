import { describe, expect, it } from 'vitest';
import {
  averageFitDomain,
  derivativeView,
  dropPartialDayPoints,
  fillCumulativeDays,
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

describe('fillCumulativeDays', () => {
  it('adds a zero day before the start and carries totals across gaps', () => {
    expect(
      fillCumulativeDays([
        { date: '2026-10-01', value: 5 },
        { date: '2026-10-04', value: 9 },
      ])
    ).toEqual([
      { date: '2026-09-30', value: 0 },
      { date: '2026-10-01', value: 5 },
      { date: '2026-10-02', value: 5 },
      { date: '2026-10-03', value: 5 },
      { date: '2026-10-04', value: 9 },
    ]);
  });
});

describe('flowViewSeries', () => {
  const cumulative = days([5, 15, 35, 65, 105, 155, 215, 285]);
  const daily = days([5, 10, 20, 30, 40, 50, 60, 70]);

  it('order 0 is the cumulative series', () => {
    expect(flowViewSeries(0, { daily, cumulative })).toEqual(cumulative);
  });

  it('order 1 is the derivative of cumulative, first day included', () => {
    const out = flowViewSeries(1, { daily, cumulative });
    expect(out.map((p) => p.value)).toEqual(daily.map((p) => p.value));
    expect(out[0].date).toBe('2026-10-01');
    expect(out.at(-1)?.avg7).toBe(40);
  });

  it('order 1 follows the cumulative line when daily disagrees with it', () => {
    const staleDaily = [...daily.slice(0, -1), { date: daily.at(-1)!.date, value: 1 }];
    expect(flowViewSeries(1, { daily: staleDaily, cumulative }).at(-1)?.value).toBe(70);
  });

  it('does not smear a jump across days with no activity', () => {
    const sparse = [
      { date: '2026-10-01', value: 10 },
      { date: '2026-10-05', value: 50 },
    ];
    expect(flowViewSeries(1, { cumulative: sparse }).map((p) => p.value)).toEqual([10, 0, 0, 0, 40]);
  });

  it('builds the cumulative from daily when it is missing', () => {
    expect(flowViewSeries(0, { daily }).map((p) => p.value)).toEqual(cumulative.map((p) => p.value));
    expect(flowViewSeries(1, { daily }).map((p) => p.value)).toEqual(daily.map((p) => p.value));
  });

  it('order 2 is the 2nd derivative of cumulative', () => {
    const out = flowViewSeries(2, { daily, cumulative });
    expect(out.map((p) => p.value)).toEqual([5, 10, 10, 10, 10, 10, 10]);
    expect(out.at(-1)?.avg7).toBeCloseTo(65 / 7);
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

describe('dropPartialDayPoints', () => {
  // Live DefiLlama inflows on 2026-11-06: midnight points plus a "so far today" point.
  const cumulative = [
    { date: '2026-11-05T00:00:00.000Z', value: 89753.34 },
    { date: '2026-11-06T00:00:00.000Z', value: 89779.92 },
    { date: '2026-11-06T20:16:23.000Z', value: 89804.33 },
  ];

  it('drops the live intraday point when the series is midnight-stamped', () => {
    expect(dropPartialDayPoints(cumulative).map((p) => p.value)).toEqual([89753.34, 89779.92]);
  });

  it('keeps a series that is stamped only intraday, and date-only series', () => {
    const intraday = [{ date: '2026-11-06T20:16:23.000Z', value: 1 }];
    expect(dropPartialDayPoints(intraday)).toEqual(intraday);
    expect(dropPartialDayPoints(days([1, 2]))).toHaveLength(2);
  });

  it('keeps the 1st derivative of cumulative equal to the full day, not two days merged', () => {
    const last = flowViewSeries(1, { cumulative }).at(-1);
    expect(last?.date).toBe('2026-11-06');
    expect(last?.value).toBeCloseTo(26.58, 2);
  });
});
