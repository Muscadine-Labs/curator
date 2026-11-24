import { describe, expect, it } from 'vitest';
import {
  getCumulativeInflowsChart,
  getDailyInflowsChart,
  getTvlChart,
  tagLivePoint,
  type DefiLlamaProtocolResponse,
} from '@/lib/defillama/service';

describe('getDailyInflowsChart fallback', () => {
  it('subtracts fees booked on the same UTC day as the TVL sample', () => {
    const prev = Date.UTC(2026, 9, 27, 12) / 1000;
    const curr = Date.UTC(2026, 9, 28, 12) / 1000;
    const feeJustAfterUtcMidnight = Date.UTC(2026, 9, 28, 0, 30) / 1000;
    const protocol: DefiLlamaProtocolResponse = {
      id: 'muscadine',
      name: 'Muscadine',
      tvl: [
        { date: prev, totalLiquidityUSD: 100 },
        { date: curr, totalLiquidityUSD: 150 },
      ],
      chainTvls: {},
    };

    expect(
      getDailyInflowsChart(protocol, {
        id: 'muscadine',
        name: 'Muscadine',
        total24h: null,
        total7d: null,
        total30d: null,
        totalAllTime: null,
        totalDataChart: [[feeJustAfterUtcMidnight, 10]],
      })
    ).toEqual([{ date: new Date(curr * 1000).toISOString(), value: 40 }]);
  });
});

describe('tagLivePoint', () => {
  const day = (d: number, h = 0, m = 0) => new Date(Date.UTC(2026, 10, d, h, m)).toISOString();

  it('tags a trailing intraday snapshot after midnight points', () => {
    const out = tagLivePoint([
      { date: day(5), value: 1 },
      { date: day(6), value: 2 },
      { date: day(6, 20, 16), value: 3 },
    ]);
    expect(out.map((p) => p.live)).toEqual([undefined, undefined, true]);
  });

  it('leaves midnight-only and intraday-only series alone', () => {
    expect(tagLivePoint([{ date: day(5), value: 1 }, { date: day(6), value: 2 }]).some((p) => p.live)).toBe(false);
    expect(
      tagLivePoint([{ date: day(5, 12), value: 1 }, { date: day(6, 12), value: 2 }]).some((p) => p.live)
    ).toBe(false);
  });

  it('is applied to TVL and carried onto cumulative inflows', () => {
    const t = (d: number, h = 0) => Date.UTC(2026, 10, d, h) / 1000;
    const protocol: DefiLlamaProtocolResponse = {
      id: 'muscadine',
      name: 'Muscadine',
      tvl: [
        { date: t(4), totalLiquidityUSD: 100 },
        { date: t(5), totalLiquidityUSD: 110 },
        { date: t(5, 20), totalLiquidityUSD: 115 },
      ],
    } as DefiLlamaProtocolResponse;
    expect(getTvlChart(protocol).at(-1)?.live).toBe(true);
    expect(getDailyInflowsChart(protocol).at(-1)?.live).toBe(true);
    expect(getCumulativeInflowsChart(protocol).at(-1)?.live).toBe(true);
    expect(getCumulativeInflowsChart(protocol).at(-2)?.live).toBeUndefined();
  });
});
