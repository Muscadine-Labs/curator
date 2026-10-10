import { describe, expect, it } from 'vitest';
import { utilizationFractionToPercentagePoints } from './utilization-percent';

describe('utilizationFractionToPercentagePoints', () => {
  it('converts a fraction at or below 100 percent', () => {
    expect(utilizationFractionToPercentagePoints(0.86)).toBe(86);
    expect(utilizationFractionToPercentagePoints(1)).toBe(100);
  });

  it('keeps utilization above 100 percent on the same scale', () => {
    expect(utilizationFractionToPercentagePoints(1.2)).toBe(120);
  });

  it('rejects missing or invalid readings', () => {
    expect(utilizationFractionToPercentagePoints(null)).toBeNull();
    expect(utilizationFractionToPercentagePoints(Number.NaN)).toBeNull();
    expect(utilizationFractionToPercentagePoints(-0.1)).toBeNull();
  });
});
