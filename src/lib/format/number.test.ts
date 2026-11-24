import { describe, expect, it } from 'vitest';
import { formatSignedCompactUSD } from './number';

describe('formatSignedCompactUSD', () => {
  it('signs and compacts positive and negative changes', () => {
    expect(formatSignedCompactUSD(1200)).toBe('+$1.20K');
    expect(formatSignedCompactUSD(-45_000)).toBe('−$45.00K');
    expect(formatSignedCompactUSD(-12.5)).toBe('−$12.50');
  });

  it('prints zero and non-finite as $0.00', () => {
    expect(formatSignedCompactUSD(0)).toBe('$0.00');
    expect(formatSignedCompactUSD(null)).toBe('$0.00');
    expect(formatSignedCompactUSD(Number.NaN)).toBe('$0.00');
  });
});
