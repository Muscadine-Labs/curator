import { describe, expect, it } from 'vitest';
import { getDailyInflowsChart, type DefiLlamaProtocolResponse } from '@/lib/defillama/service';

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
