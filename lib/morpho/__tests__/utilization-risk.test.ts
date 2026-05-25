import { scoreUtilizationRatio } from '../compute-v1-market-risk';

describe('scoreUtilizationRatio', () => {
  const target = 0.9;

  it('scores 100 at target utilization', () => {
    expect(scoreUtilizationRatio(0.9, target)).toBe(100);
  });

  it('scores 100 below target (not penalized as riskier)', () => {
    expect(scoreUtilizationRatio(0.5, target)).toBe(100);
    expect(scoreUtilizationRatio(0, target)).toBe(100);
  });

  it('decreases as utilization rises above target', () => {
    expect(scoreUtilizationRatio(0.95, target)).toBeCloseTo(50, 5);
    expect(scoreUtilizationRatio(1, target)).toBe(0);
    expect(scoreUtilizationRatio(0.92, target)).toBeCloseTo(80, 5);
  });
});
