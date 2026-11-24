import { describe, expect, it } from 'vitest';
import {
  cumulativeFromDaily,
  derivativeView,
  dropLivePoints,
  fillLevelDays,
  fillCumulativeDays,
  flowViewSeries,
  seriesDerivative,
  triangularTrend,
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
    const out = withTrailingAverage(days([1, 2, 3, 4, 5, 6, 7, 8]), 7);
    expect(out.slice(0, 6).every((p) => p.trend === undefined)).toBe(true);
    expect(out[6].trend).toBe(4);
    expect(out[7].trend).toBe(5);
  });

  it('averages over calendar days, not sample count', () => {
    const points = [...days([1, 1, 1, 1, 1, 1, 1]), { date: '2026-10-20', value: 9 }];
    expect(withTrailingAverage(points, 7).at(-1)?.trend).toBe(9);
  });
});

describe('derivativeView', () => {
  const quad = days(Array.from({ length: 20 }, (_, i) => i * i));

  it('second derivative of a quadratic is constant, and so is its trend', () => {
    const second = derivativeView(quad, 2, 7);
    expect(second.every((p) => p.value === 2)).toBe(true);
    expect(second.at(-1)?.trend).toBeCloseTo(2, 10);
  });

  it('1st-derivative trend is the triangular average of the daily change', () => {
    const first = derivativeView(quad, 1, 7);
    // Daily change on day i is 2i − 1 (linear), so any symmetric 7-day average
    // centred 3 days back gives 2·16 − 1 = 31.
    expect(first.at(-1)?.trend).toBe(31);
  });

  it('2nd-derivative trend is the slope of the smoothed 1st derivative', () => {
    // Needs a full window for the mean and another window of history behind it.
    const second = derivativeView(quad, 2, 7);
    const firstDefined = second.findIndex((p) => p.trend != null);
    expect(second[firstDefined].date).toBe(quad[14].date);
    expect(second.slice(0, firstDefined).every((p) => p.trend === undefined)).toBe(true);
  });

  it('stays steady on noisy daily data where the averaged raw 2nd derivative flips', () => {
    // Steady growth of 1/day in the daily amount, plus alternating ±20 noise.
    let cum = 0;
    const cumulative = days(
      Array.from({ length: 120 }, (_, i) => (cum += 100 + i + (i % 2 === 0 ? 20 : -20)))
    );
    const trend = derivativeView(cumulative, 2, 30)
      .map((p) => p.trend)
      .filter((v): v is number => v != null);
    expect(trend.length).toBeGreaterThan(0);
    expect(trend.every((v) => Math.abs(v - 1) < 0.1)).toBe(true);
    // The old method (7D mean of the raw 2nd derivative) swings far from 1.
    const old = withTrailingAverage(seriesDerivative(seriesDerivative(cumulative)), 7)
      .map((p) => p.trend)
      .filter((v): v is number => v != null);
    expect(Math.max(...old.map((v) => Math.abs(v - 1)))).toBeGreaterThan(5);
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
    const out = flowViewSeries(1, { daily, cumulative }, 7);
    expect(out.map((p) => p.value)).toEqual(daily.map((p) => p.value));
    expect(out[0].date).toBe('2026-10-01');
    expect(out.at(-1)?.trend).toBe(40);
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
    const out = flowViewSeries(2, { daily, cumulative }, 7);
    expect(out.map((p) => p.value)).toEqual([5, 10, 10, 10, 10, 10, 10]);
    // Eight days is less than two 7-day windows: no trend yet, not a guess.
    expect(out.every((p) => p.trend === undefined)).toBe(true);
  });
});

describe('dropLivePoints', () => {
  // Live DefiLlama inflows on 2026-11-06: midnight points plus a tagged "so far today" point.
  const cumulative = [
    { date: '2026-11-05T00:00:00.000Z', value: 89753.34 },
    { date: '2026-11-06T00:00:00.000Z', value: 89779.92 },
    { date: '2026-11-06T20:16:23.000Z', value: 89804.33, live: true },
  ];

  it('drops only the tagged live point', () => {
    expect(dropLivePoints(cumulative).map((p) => p.value)).toEqual([89753.34, 89779.92]);
  });

  it('keeps the 1st derivative of cumulative equal to the full day, not two days merged', () => {
    const last = flowViewSeries(1, { cumulative }).at(-1);
    expect(last?.date).toBe('2026-11-06');
    expect(last?.value).toBeCloseTo(26.58, 2);
  });

  it('cumulative view has one point per day, the live total winning', () => {
    const out = flowViewSeries(0, { cumulative });
    expect(out.map((p) => p.date)).toEqual(['2026-11-05', '2026-11-06']);
    expect(out.at(-1)?.value).toBe(89804.33);
  });
});

describe('fillLevelDays', () => {
  it('interpolates missing days linearly', () => {
    expect(
      fillLevelDays([
        { date: '2026-10-01', value: 100 },
        { date: '2026-10-04', value: 130 },
      ])
    ).toEqual([
      { date: '2026-10-01', value: 100 },
      { date: '2026-10-02', value: 110 },
      { date: '2026-10-03', value: 120 },
      { date: '2026-10-04', value: 130 },
    ]);
  });

  it('keeps the 2nd-derivative trend unbroken across a missing TVL day', () => {
    const tvl = days(Array.from({ length: 40 }, (_, i) => 1000 + i * i));
    const gapped = tvl.filter((_, i) => i !== 25);
    const trend = derivativeView(gapped, 2, 7);
    const firstDefined = trend.findIndex((p) => p.trend != null);
    expect(firstDefined).toBeGreaterThan(-1);
    expect(trend.slice(firstDefined).every((p) => p.trend != null)).toBe(true);
    expect(trend.map((p) => p.date)).toContain(tvl[25].date);
  });
});

describe('cumulativeFromDaily', () => {
  it('sums same-day flows and sorts by day', () => {
    expect(
      cumulativeFromDaily([
        { date: '2026-10-02', value: 5 },
        { date: '2026-10-01', value: 1 },
        { date: '2026-10-01T15:00:00Z', value: 2 },
      ])
    ).toEqual([
      { date: '2026-10-01', value: 3 },
      { date: '2026-10-02', value: 8 },
    ]);
  });
});

describe('triangularTrend', () => {
  it('has the same width as a plain mean: defined after N days', () => {
    const out = triangularTrend(days(Array.from({ length: 10 }, () => 1)), 7);
    expect(out.slice(0, 6).every((p) => p.trend === undefined)).toBe(true);
    expect(out[6].trend).toBe(1);
  });

  it('fades a single large day in and out instead of stepping', () => {
    // Flat daily change with one +3000 day (a big deposit).
    const values = Array.from({ length: 120 }, (_, i) => (i === 60 ? 3000 : 0));
    const steps = (trend: Array<number | undefined>) => {
      const v = trend.filter((x): x is number => x != null);
      return Math.max(...v.slice(1).map((x, i) => Math.abs(x - v[i])));
    };
    const plain = steps(withTrailingAverage(days(values), 30).map((p) => p.trend));
    const tri = steps(triangularTrend(days(values), 30).map((p) => p.trend));
    expect(plain).toBe(100); // 3000 / 30, on entry and again on exit
    expect(tri).toBeLessThanOrEqual(3000 / (15 * 16) + 1e-9); // 12.5
  });
});
