import {
  getKnownAssetDecimals,
  getTokenDisplayDecimals,
  resolveAssetDecimals,
} from '@/lib/format/asset-decimals';

describe('asset-decimals', () => {
  it('resolves known assets', () => {
    expect(getKnownAssetDecimals('USDC')).toBe(6);
    expect(getKnownAssetDecimals('cbBTC')).toBe(8);
    expect(getKnownAssetDecimals('WETH')).toBe(18);
  });

  it('resolveAssetDecimals prefers known symbols', () => {
    expect(resolveAssetDecimals('USDC', 18)).toBe(6);
    expect(resolveAssetDecimals('cbBTC', 18)).toBe(8);
  });

  it('getTokenDisplayDecimals matches asset caps', () => {
    expect(getTokenDisplayDecimals('WETH', 6)).toBe(18);
    expect(getTokenDisplayDecimals('UNKNOWN', 12)).toBe(12);
  });
});
