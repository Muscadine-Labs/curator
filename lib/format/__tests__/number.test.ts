/**
 * @jest-environment node
 *
 * Tests for `lib/format/number.ts`. The vault UI relies heavily on these
 * helpers; if they regress, vault overviews show "0.000" or
 * `1.23e-6`-style floats instead of human-readable numbers.
 */

import { parseUnits } from 'viem';
import {
  formatAddress,
  formatBps,
  formatCompactNumber,
  formatCompactUSD,
  formatFullUSD,
  formatLtv,
  formatNumber,
  formatPercentage,
  formatRawTokenAmount,
  formatTokenAmount,
  formatTokenSymbol,
  formatUSD,
} from '../number';

describe('formatUSD', () => {
  test('formats whole-dollar amounts with two decimals', () => {
    expect(formatUSD(1234.5)).toBe('$1,234.50');
  });
  test('returns $0.00 for null/zero', () => {
    expect(formatUSD(null)).toBe('$0.00');
    expect(formatUSD(0)).toBe('$0.00');
  });
  test('shows <$0.01 for tiny positive amounts', () => {
    expect(formatUSD(0.0001)).toBe('<$0.01');
  });
  test('shows >-$0.01 for tiny negative amounts', () => {
    expect(formatUSD(-0.0001)).toBe('>-$0.01');
  });
});

describe('formatCompactUSD', () => {
  test('uses K/M/B suffixes above $1k', () => {
    expect(formatCompactUSD(1500)).toMatch(/^\$1\.50?K$/);
    expect(formatCompactUSD(2_500_000)).toMatch(/^\$2\.50?M$/);
    expect(formatCompactUSD(1_200_000_000)).toMatch(/^\$1\.20?B$/);
  });
  test('falls back to two-decimal form below $1k', () => {
    expect(formatCompactUSD(42)).toBe('$42.00');
  });
});

describe('formatPercentage / formatBps', () => {
  test('formatPercentage divides by 100 (input is %, not ratio)', () => {
    expect(formatPercentage(12.345)).toBe('12.35%');
  });
  test('formatBps converts basis points', () => {
    expect(formatBps(150)).toBe('1.50%');
    expect(formatBps(0)).toBe('0.00%');
  });
});

describe('formatNumber / formatCompactNumber', () => {
  test('formats with grouping separators', () => {
    expect(formatNumber(1_234_567)).toBe('1,234,567');
  });
  test('compact uses K/M/B', () => {
    expect(formatCompactNumber(2500)).toMatch(/2\.5K/i);
  });
});

describe('formatAddress', () => {
  test('truncates addresses to start...end', () => {
    expect(
      formatAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6, 4)
    ).toBe('0x8335...2913');
  });
  test('returns original when shorter than truncation budget', () => {
    expect(formatAddress('0xabcd', 6, 4)).toBe('0xabcd');
  });
  test('null → N/A', () => {
    expect(formatAddress(null)).toBe('N/A');
  });
});

describe('formatTokenSymbol', () => {
  test('uppercases', () => {
    expect(formatTokenSymbol('usdc')).toBe('USDC');
  });
});

describe('formatLtv', () => {
  test('handles wei-scaled values (>1e6)', () => {
    expect(formatLtv(parseUnits('0.86', 18).toString())).toBe('86.00%');
  });
  test('handles fraction in [0,1]', () => {
    expect(formatLtv(0.86)).toBe('86.00%');
  });
  test('handles plain percent (>1, <=100)', () => {
    expect(formatLtv(86)).toBe('86.00%');
  });
  test('null/NaN → em-dash', () => {
    expect(formatLtv(null)).toBe('—');
    expect(formatLtv(NaN)).toBe('—');
  });
});

describe('formatTokenAmount', () => {
  test('divides raw number by 10**decimals', () => {
    expect(formatTokenAmount(123_450_000, 6, 2)).toBe('123.45');
  });
  test('null amount → 0.00', () => {
    expect(formatTokenAmount(null, 18, 2)).toBe('0.00');
  });
});

describe('formatRawTokenAmount', () => {
  test('preserves bigint precision (no exponent notation)', () => {
    // 1.234567 USDC at 6 decimals = 1234567n
    expect(formatRawTokenAmount(1_234_567n, 6, 6)).toBe('1.234567');
  });

  test('truncates fraction to displayDecimals (no rounding)', () => {
    // 1.234567 USDC at 4 displayDecimals → 1.2345 (truncated)
    expect(formatRawTokenAmount(1_234_567n, 6, 4)).toBe('1.2345');
  });

  test('formats large bigints with grouping commas', () => {
    // 1_234_567.00 USDC = 1_234_567 * 10^6
    const raw = parseUnits('1234567', 6);
    expect(formatRawTokenAmount(raw, 6, 2)).toBe('1,234,567.00');
  });

  test('handles zero, null, and undefined', () => {
    expect(formatRawTokenAmount(0n, 6)).toBe('0.00');
    expect(formatRawTokenAmount(null, 6)).toBe('0.00');
    expect(formatRawTokenAmount(undefined, 6)).toBe('0.00');
  });

  test('handles negative bigints', () => {
    expect(formatRawTokenAmount(-1_500_000n, 6, 2)).toBe('-1.50');
  });

  test('accepts string input (raw decimal string)', () => {
    expect(formatRawTokenAmount('1500000', 6, 2)).toBe('1.50');
  });

  test('returns 0.00 on bogus string input', () => {
    expect(formatRawTokenAmount('not-a-number', 6)).toBe('0.00');
  });

  test('does NOT use exponent notation on tiny amounts', () => {
    // 1 base unit at 18 decimals — would be 1e-18 as a JS number.
    expect(formatRawTokenAmount(1n, 18, 18)).toBe('0.000000000000000001');
    expect(formatRawTokenAmount(1n, 18, 6)).toBe('0.000000');
  });

  test('this is the regression test for the V1 holders "0.000" bug', () => {
    // Symptom: USDC (6 decimals) raw value formatted with default 18 decimals
    // produced "0.000" because the value < 1e18. Fixed by passing the right
    // decimals from the API. Re-asserting the contract of the helper:
    const usdcRaw = parseUnits('123.456789', 6);
    expect(formatRawTokenAmount(usdcRaw, 6, 4)).toBe('123.4567');
    // ...but the same value with the wrong decimals would round to zero.
    expect(formatRawTokenAmount(usdcRaw, 18, 4)).toBe('0.0000');
  });
});

describe('formatFullUSD', () => {
  test('formats with currency style + two decimals by default', () => {
    expect(formatFullUSD(1234.5)).toBe('$1,234.50');
  });
  test('null/undefined → $0.00', () => {
    expect(formatFullUSD(null)).toBe('$0.00');
    expect(formatFullUSD(undefined)).toBe('$0.00');
  });
  test('non-finite → $0.00', () => {
    expect(formatFullUSD(NaN)).toBe('$0.00');
    expect(formatFullUSD(Infinity)).toBe('$0.00');
  });
  test('tiny positive/negative amounts', () => {
    expect(formatFullUSD(0.001)).toBe('<$0.01');
    expect(formatFullUSD(-0.001)).toBe('>-$0.01');
  });
});
