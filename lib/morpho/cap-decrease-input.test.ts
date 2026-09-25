import { describe, expect, it } from 'vitest';
import { parseCapDecreaseInput } from './cap-decrease-input';

const base = {
  currentAbsoluteRaw: '100000000', // 100 USDC
  currentRelativeRaw: '500000000000000000', // 50%
  assetSymbol: 'USDC',
  chainDecimals: 6,
};

describe('parseCapDecreaseInput', () => {
  it('parses an absolute decrease with grouping separators', () => {
    expect(parseCapDecreaseInput({ ...base, mode: 'absolute', valueStr: '1,000' })).toEqual({
      ok: false,
      error: 'New absolute cap must be less than or equal to the current cap.',
    });
    expect(parseCapDecreaseInput({ ...base, mode: 'absolute', valueStr: '50.5' })).toEqual({
      ok: true,
      mode: 'absolute',
      value: 50_500_000n,
    });
  });

  it('rejects a negative absolute cap', () => {
    expect(parseCapDecreaseInput({ ...base, mode: 'absolute', valueStr: '-5' })).toEqual({
      ok: false,
      error: 'Cap cannot be negative.',
    });
  });

  it('rejects an absolute increase', () => {
    const result = parseCapDecreaseInput({ ...base, mode: 'absolute', valueStr: '101' });
    expect(result.ok).toBe(false);
  });

  it('converts a relative percent to WAD', () => {
    expect(parseCapDecreaseInput({ ...base, mode: 'relative', valueStr: '33.33' })).toEqual({
      ok: true,
      mode: 'relative',
      value: 333_300_000_000_000_000n,
    });
  });

  it('rejects non-decimal and out-of-range percents', () => {
    for (const valueStr of ['1e1', '0x10', '-1', '101', 'abc']) {
      expect(parseCapDecreaseInput({ ...base, mode: 'relative', valueStr }).ok).toBe(false);
    }
  });

  it('rejects empty input', () => {
    expect(parseCapDecreaseInput({ ...base, mode: 'absolute', valueStr: '  ' }).ok).toBe(false);
  });

  it('converts percentages to WAD exactly', () => {
    const current = { ...base, currentRelativeRaw: '2800000000000000' }; // 0.28%
    expect(parseCapDecreaseInput({ ...current, mode: 'relative', valueStr: '0.28' })).toEqual({
      ok: true,
      mode: 'relative',
      value: 2_800_000_000_000_000n,
    });
    expect(parseCapDecreaseInput({ ...base, mode: 'relative', valueStr: '1.12' })).toEqual({
      ok: true,
      mode: 'relative',
      value: 11_200_000_000_000_000n,
    });
  });
});
