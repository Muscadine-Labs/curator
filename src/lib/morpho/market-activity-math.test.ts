import { describe, expect, it } from 'vitest';
import {
  borrowToTargetUsd,
  collateralAtRiskCurve,
  collateralAtRiskFromMorpho,
  healthTone,
  rawAmountString,
  shareOf,
} from '@/lib/morpho/market-activity-math';
import { irmCurveFromRateAtTarget } from '@/lib/morpho/market-activity.server';

describe('rawAmountString', () => {
  it('keeps integer strings and safe numbers', () => {
    expect(rawAmountString('123')).toBe('123');
    expect(rawAmountString(31055591657)).toBe('31055591657');
  });
  it('turns large floats into integer strings, not exponent form', () => {
    expect(rawAmountString(1.2e21)).toBe('1200000000000000000000');
  });
  it('returns null for empty input', () => {
    expect(rawAmountString(null)).toBeNull();
    expect(rawAmountString('')).toBeNull();
  });
});

describe('collateralAtRiskCurve', () => {
  const positions = [
    { collateralUsd: 100, priceVariationToLiquidationPrice: -0.07 },
    { collateralUsd: 50, priceVariationToLiquidationPrice: -0.25 },
    { collateralUsd: 10, priceVariationToLiquidationPrice: 0.01 }, // already liquidatable
    { collateralUsd: 999, priceVariationToLiquidationPrice: null }, // no borrow
  ];
  it('accumulates collateral as the drop deepens', () => {
    const curve = collateralAtRiskCurve(positions, [0, -0.05, -0.1, -0.25, -0.3]);
    expect(curve.map((p) => p.collateralUsd)).toEqual([10, 10, 110, 160, 160]);
    expect(curve.map((p) => p.positions)).toEqual([1, 1, 2, 3, 3]);
  });
  it('defaults to 0% … −99% in 1% steps', () => {
    const curve = collateralAtRiskCurve([]);
    expect(curve).toHaveLength(100);
    expect(curve[1].priceChange).toBeCloseTo(-0.01);
    expect(curve[99].priceChange).toBeCloseTo(-0.99);
  });
});

describe('IRM helpers', () => {
  it('computes borrow (or repay) to reach target', () => {
    expect(borrowToTargetUsd(1000, 800, 0.9)).toBeCloseTo(100);
    expect(borrowToTargetUsd(1000, 950, 0.9)).toBeCloseTo(-50);
    expect(borrowToTargetUsd(null, 1, 0.9)).toBeNull();
  });
  it('computes shares and health tones', () => {
    expect(shareOf(25, 100)).toBe(0.25);
    expect(shareOf(1, 0)).toBeNull();
    expect(healthTone(0.99)).toBe('liquidatable');
    expect(healthTone(1.03)).toBe('danger');
    expect(healthTone(1.1)).toBe('warning');
    expect(healthTone(2)).toBe('healthy');
    expect(healthTone(null)).toBe('unknown');
  });
});

describe('collateralAtRiskFromMorpho', () => {
  it('maps price ratios to price changes, 0% first', () => {
    const out = collateralAtRiskFromMorpho([
      { collateralPriceRatio: 0.9, collateralUsd: 45 },
      { collateralPriceRatio: 1, collateralUsd: 0 },
      { collateralPriceRatio: 0.5, collateralUsd: null },
    ]);
    expect(out.map((p) => p.priceChange)).toEqual([0, -0.1, -0.5]);
    expect(out.map((p) => p.collateralUsd)).toEqual([0, 45, 0]);
    expect(out[1].positions).toBeNull();
  });
});

describe('irmCurveFromRateAtTarget', () => {
  it('samples 0–100% utilization; at 90% borrow APY is the rate at target', () => {
    const rateAtTarget = String(Math.round((Math.log(1.04) / 31_536_000) * 1e18));
    const curve = irmCurveFromRateAtTarget(rateAtTarget, 0);
    expect(curve).toHaveLength(101);
    expect(curve[90]!.borrowApy).toBeCloseTo(0.04, 4);
    expect(curve[90]!.supplyApy).toBeCloseTo(0.036, 4);
    expect(curve[100]!.borrowApy).toBeGreaterThan(curve[90]!.borrowApy);
    expect(curve[0]!.supplyApy).toBe(0);
  });
});
