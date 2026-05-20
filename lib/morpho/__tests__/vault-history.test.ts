import {
  computeV2LiquidityTokenSeries,
  computeV2LiquidityUsdSeries,
  mapMorphoTimeseries,
} from '@/lib/morpho/vault-history';

describe('vault-history', () => {
  it('maps morpho timeseries to daily points', () => {
    const points = mapMorphoTimeseries([
      { x: 1_700_000_000, y: 10 },
      { x: 1_700_086_400, y: 20 },
    ]);
    expect(points.length).toBeGreaterThan(0);
    expect(points[0].value).toBe(10);
  });

  it('computes V2 liquidity as TVL minus idle (USD)', () => {
    const total = [
      { date: '2024-01-01T00:00:00.000Z', value: 1000 },
      { date: '2024-01-02T00:00:00.000Z', value: 2000 },
    ];
    const idle = [
      { date: '2024-01-01T00:00:00.000Z', value: 100 },
      { date: '2024-01-02T00:00:00.000Z', value: 500 },
    ];
    expect(computeV2LiquidityUsdSeries(total, idle)).toEqual([
      { date: '2024-01-01T00:00:00.000Z', value: 900 },
      { date: '2024-01-02T00:00:00.000Z', value: 1500 },
    ]);
  });

  it('computes V2 liquidity as TVL minus idle (raw)', () => {
    const total = [
      { date: '2024-01-01T00:00:00.000Z', value: '1000000000' },
      { date: '2024-01-02T00:00:00.000Z', value: '2000000000' },
    ];
    const idle = [{ date: '2024-01-01T00:00:00.000Z', value: '100000000' }];
    expect(computeV2LiquidityTokenSeries(total, idle)[0].value).toBe('900000000');
  });
});
