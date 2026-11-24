import { describe, expect, it } from 'vitest';
import {
  assetsToUsdAtCurrentPrice,
  mapV2TxAssets,
  parseBigIntSafe,
} from '@/lib/morpho/vault-v2-tx-amounts';
import { formatLtv, lltvToFraction } from '@/lib/format/number';

describe('mapV2TxAssets', () => {
  it('uses indexed assets for deposits and withdrawals (exact)', () => {
    expect(
      mapV2TxAssets({ __typename: 'VaultV2DepositData', assets: '500' } as never, '400', 10n, 8n)
    ).toEqual({ assets: '500', assetsEstimated: false });
  });
  it('estimates transfers from shares at the current share price', () => {
    expect(
      mapV2TxAssets({ __typename: 'VaultV2TransferData' } as never, '400', 10n, 8n)
    ).toEqual({ assets: '500', assetsEstimated: true });
  });
  it('returns nothing for unknown rows', () => {
    expect(mapV2TxAssets(null, '1', 1n, 1n)).toEqual({ assets: null, assetsEstimated: false });
  });
});

describe('amount helpers', () => {
  it('values assets at the current asset price', () => {
    expect(assetsToUsdAtCurrentPrice('50', 100n, 200)).toBeCloseTo(100);
    expect(assetsToUsdAtCurrentPrice('50', 0n, 200)).toBeNull();
  });
  it('parses bigint-ish values safely', () => {
    expect(parseBigIntSafe('12')).toBe(12n);
    expect(parseBigIntSafe(12.9)).toBe(12n);
    expect(parseBigIntSafe('abc')).toBeNull();
    expect(parseBigIntSafe('')).toBeNull();
  });
});

describe('lltvToFraction', () => {
  it('accepts WAD, fraction and percent', () => {
    expect(lltvToFraction('860000000000000000')).toBeCloseTo(0.86);
    expect(lltvToFraction(0.86)).toBe(0.86);
    expect(lltvToFraction(86)).toBeCloseTo(0.86);
    expect(lltvToFraction(null)).toBeNull();
    expect(formatLtv('770000000000000000')).toBe('77.00%');
  });
});
