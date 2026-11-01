import { describe, expect, it } from 'vitest';
import {
  borrowToTargetUsd,
  collateralAtRiskCurve,
  collateralAtRiskFromMorpho,
  healthTone,
  rawAmountString,
  shareOf,
} from '@/lib/morpho/market-activity-math';
import { mapMarketActivity } from '@/lib/morpho/market-activity.server';

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
  it('defaults to 0% … −90% in 5% steps', () => {
    const curve = collateralAtRiskCurve([]);
    expect(curve).toHaveLength(19);
    expect(curve[18].priceChange).toBeCloseTo(-0.9);
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

describe('mapMarketActivity', () => {
  const MARKET = '0xabc';
  it('resolves V1 allocation by market id and V2 allocation through adapters', () => {
    const out = mapMarketActivity(
      {
        market: {
          state: { borrowAssetsUsd: 200 },
          supplyingVaults: [
            {
              address: '0xv1',
              name: 'V1 Vault',
              state: {
                curator: '0xcur',
                allocation: [
                  { market: { marketId: '0xother' }, supplyAssets: 1, supplyAssetsUsd: 1 },
                  { market: { marketId: '0xABC' }, supplyAssets: '500', supplyAssetsUsd: 5 },
                ],
              },
            },
          ],
          supplyingVaultV2s: [
            {
              address: '0xv2',
              name: 'V2 Vault',
              curators: { items: [{ name: 'Muscadine' }] },
              adapters: { items: [{ address: '0xAdapter' }] },
            },
            {
              address: '0xv2b',
              name: 'Small V2',
              curators: { items: [] },
              adapters: { items: [{ address: '0xnotsupplier' }] },
            },
          ],
        },
        suppliers: {
          items: [{ user: { address: '0xadapter' }, state: { supplyAssets: 700, supplyAssetsUsd: 7 } }],
        },
        borrowers: {
          pageInfo: { countTotal: 2 },
          items: [
            {
              healthFactor: 1.2,
              priceVariationToLiquidationPrice: -0.1,
              user: { address: '0xb1' },
              state: { collateral: 1, collateralUsd: 300, borrowAssets: 2, borrowAssetsUsd: 150 },
            },
          ],
        },
      },
      MARKET
    );
    expect(out.vaults.map((v) => [v.name, v.allocation, v.curator])).toEqual([
      ['V2 Vault', '700', 'Muscadine'],
      ['V1 Vault', '500', '0xcur'],
      ['Small V2', null, null],
    ]);
    expect(out.borrowerCount).toBe(2);
    expect(out.collateralAtRiskBorrowUsd).toBe(150);
    expect(out.collateralAtRisk.find((p) => Math.abs(p.priceChange + 0.1) < 1e-9)?.collateralUsd).toBe(300);
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
