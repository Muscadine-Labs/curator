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
