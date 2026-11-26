import { describe, expect, it } from 'vitest';
import { mapMorphoTimeseries } from '@/lib/morpho/vault-history';

describe('mapMorphoTimeseries', () => {
  it('keeps a sample just after UTC midnight on that UTC day', () => {
    const justAfterMidnight = Date.UTC(2026, 9, 28, 0, 30) / 1000;
    expect(mapMorphoTimeseries([{ x: justAfterMidnight, y: 10 }])).toEqual([
      { date: '2026-10-28', value: 10 },
    ]);
  });

  it('keeps samples on either side of UTC midnight as separate days', () => {
    const before = Date.UTC(2026, 9, 27, 23, 0) / 1000;
    const after = Date.UTC(2026, 9, 28, 1, 0) / 1000;
    expect(
      mapMorphoTimeseries([
        { x: before, y: 1 },
        { x: after, y: 2 },
      ])
    ).toEqual([
      { date: '2026-10-27', value: 1 },
      { date: '2026-10-28', value: 2 },
    ]);
  });

  it('keeps the later sample when two points fall on the same UTC day', () => {
    const early = Date.UTC(2026, 9, 28, 1, 0) / 1000;
    const late = Date.UTC(2026, 9, 28, 18, 0) / 1000;
    expect(
      mapMorphoTimeseries([
        { x: early, y: 1 },
        { x: late, y: 4 },
      ])
    ).toEqual([{ date: '2026-10-28', value: 4 }]);
  });
});

describe('realizedApySeries', () => {
  it('annualizes the share price change between points', async () => {
    const { realizedApySeries } = await import('@/lib/morpho/vault-history');
    const ray = (n: number) => String(BigInt(Math.round(n * 1e9)) * BigInt(1e18));
    const day = 86_400;
    const daily = Math.pow(1.05, 1 / 365);
    const series = realizedApySeries(
      [
        { timestamp: 0, share_price_ray: ray(1) },
        { timestamp: day, share_price_ray: ray(daily) },
      ],
      []
    );
    expect(series).toHaveLength(1);
    expect(series[0]!.x).toBe(day);
    expect(series[0]!.y).toBeCloseTo(0.05, 3);
  });

  it('falls back to Morpho averages without two share prices', async () => {
    const { realizedApySeries } = await import('@/lib/morpho/vault-history');
    expect(realizedApySeries([{ timestamp: 1, share_price_ray: '1' }], [{ timestamp: 5, apy: 0.04 }])).toEqual([
      { x: 5, y: 0.04 },
    ]);
  });
});
