import { describe, expect, it } from 'vitest';
import { fillMissingTokens } from '@/lib/morpho/compute-treasury-statement';

describe('fillMissingTokens', () => {
  it('values a day with no assets sample at the nearest assets-per-share', () => {
    const filled = fillMissingTokens([
      { x: 1, shares: 100n, tokens: 50, usd: 50 },
      { x: 2, shares: 120n, tokens: null, usd: 60 },
    ]);
    expect(filled[1]?.tokens).toBeCloseTo(60);
  });

  it('falls back to a later day when no earlier sample exists', () => {
    const filled = fillMissingTokens([
      { x: 1, shares: 10n, tokens: null, usd: null },
      { x: 2, shares: 20n, tokens: 40, usd: 40 },
    ]);
    expect(filled[0]?.tokens).toBeCloseTo(20);
  });
});
