import { describe, expect, it } from 'vitest';
import { curatorBlueMarketHref, safeReturnPath } from './morpho-app-links';

describe('safeReturnPath', () => {
  it('keeps in-app paths with query and hash', () => {
    expect(safeReturnPath('/markets?q=USDC')).toBe('/markets?q=USDC');
    expect(safeReturnPath('/vault/0xabc/allocation#row')).toBe('/vault/0xabc/allocation#row');
  });

  it('rejects missing, relative, and protocol-relative values', () => {
    expect(safeReturnPath(null)).toBeNull();
    expect(safeReturnPath('')).toBeNull();
    expect(safeReturnPath('markets')).toBeNull();
    expect(safeReturnPath('https://evil.com')).toBeNull();
    expect(safeReturnPath('//evil.com')).toBeNull();
  });

  it('rejects backslash and control-character bypasses', () => {
    expect(safeReturnPath('/\\evil.com')).toBeNull();
    expect(safeReturnPath('/\t/evil.com')).toBeNull();
    expect(safeReturnPath('/\n/evil.com')).toBeNull();
    expect(safeReturnPath('/%5Cevil.com')).toBe('/%5Cevil.com');
  });
});

describe('curatorBlueMarketHref', () => {
  it('drops an unsafe return path', () => {
    expect(curatorBlueMarketHref('0x01', 8453, '/\\evil.com')).toBe(
      '/market/blue/0x01?chainId=8453'
    );
  });

  it('keeps a safe return path', () => {
    expect(curatorBlueMarketHref('0x01', 8453, '/markets?q=USDC')).toBe(
      '/market/blue/0x01?chainId=8453&from=%2Fmarkets%3Fq%3DUSDC'
    );
  });
});
