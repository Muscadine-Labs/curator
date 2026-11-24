import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import {
  getDefaultSafeTokens,
  isNativeToken,
  MAX_EXTRA_TOKENS,
  NATIVE_TOKEN_ADDRESS,
  parseExtraTokenParam,
} from '@/lib/safe/tokens';

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const WETH = '0x4200000000000000000000000000000000000006';

describe('parseExtraTokenParam', () => {
  it('returns nothing for empty input', () => {
    expect(parseExtraTokenParam(null)).toEqual([]);
    expect(parseExtraTokenParam('')).toEqual([]);
  });

  it('checksums and keeps order', () => {
    expect(parseExtraTokenParam(`${USDC.toLowerCase()},${WETH.toLowerCase()}`)).toEqual([
      getAddress(USDC),
      getAddress(WETH),
    ]);
  });

  it('drops junk without failing the whole request', () => {
    expect(parseExtraTokenParam(`not-an-address,${USDC},0x123`)).toEqual([getAddress(USDC)]);
  });

  it('de-duplicates case-insensitively', () => {
    expect(parseExtraTokenParam(`${USDC},${USDC.toLowerCase()}`)).toHaveLength(1);
  });

  it('caps the list so one request cannot build an enormous multicall', () => {
    const many = Array.from(
      { length: MAX_EXTRA_TOKENS + 25 },
      (_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}`
    ).join(',');
    expect(parseExtraTokenParam(many)).toHaveLength(MAX_EXTRA_TOKENS);
  });
});

describe('getDefaultSafeTokens', () => {
  const tokens = getDefaultSafeTokens();

  it('lists native ETH first', () => {
    expect(tokens[0].address).toBe(NATIVE_TOKEN_ADDRESS);
    expect(isNativeToken(tokens[0].address)).toBe(true);
  });

  it('has no duplicate addresses — duplicates would collide as React keys', () => {
    const seen = tokens.map((t) => String(t.address).toLowerCase());
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('gives every vault-share row a distinct symbol', () => {
    // Several vaults share an underlying asset, so "USDC shares" on two rows
    // would be indistinguishable in the send picker.
    const shareSymbols = tokens.filter((t) => t.kind === 'vaultShare').map((t) => t.symbol);
    expect(shareSymbols.length).toBeGreaterThan(1);
    expect(new Set(shareSymbols).size).toBe(shareSymbols.length);
  });

  it('declares plausible decimals for every entry', () => {
    for (const token of tokens) {
      expect(token.decimals).toBeGreaterThanOrEqual(0);
      expect(token.decimals).toBeLessThanOrEqual(18);
    }
  });
});
