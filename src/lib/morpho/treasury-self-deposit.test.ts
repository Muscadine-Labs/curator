import { describe, expect, it } from 'vitest';
import {
  creditIncomeBucket,
  takeMatchedIncome,
} from '@/lib/morpho/treasury-self-deposit';

const VAULT = '0x036A01eFdDC87F6634FFDE0533EE528b90fc7A45';

describe('takeMatchedIncome', () => {
  it('ignores a wrapper-migration self-deposit with no booked income that day', () => {
    const remaining = new Map();
    expect(
      takeMatchedIncome(remaining, VAULT, '2026-09-04', { tokens: 173.75, usd: 173.75 })
    ).toBeNull();
  });

  it('subtracts only the same-day share-increase income, not the opening deposit', () => {
    const remaining = new Map();
    creditIncomeBucket(remaining, VAULT, '2026-09-04', { tokens: 2.5, usd: 2.5 });
    expect(
      takeMatchedIncome(remaining, VAULT, '2026-09-04', { tokens: 173.75, usd: 173.75 })
    ).toEqual({ tokens: 2.5, usd: 2.5 });
    expect(remaining.size).toBe(0);
  });

  it('does not consume income from another UTC day', () => {
    const remaining = new Map();
    creditIncomeBucket(remaining, VAULT, '2026-09-03', { tokens: 10, usd: 10 });
    expect(
      takeMatchedIncome(remaining, VAULT, '2026-09-04', { tokens: 173.75, usd: 173.75 })
    ).toBeNull();
    expect(
      takeMatchedIncome(remaining, VAULT, '2026-09-03', { tokens: 10, usd: 10 })
    ).toEqual({ tokens: 10, usd: 10 });
  });

  it('keeps the income-bucket ratio when token and usd caps disagree', () => {
    const remaining = new Map();
    creditIncomeBucket(remaining, VAULT, '2026-09-04', { tokens: 10, usd: 20 });
    expect(
      takeMatchedIncome(remaining, VAULT, '2026-09-04', { tokens: 10, usd: 10 })
    ).toEqual({ tokens: 5, usd: 10 });
    expect(takeMatchedIncome(remaining, VAULT, '2026-09-04', { tokens: 10, usd: 10 })).toEqual(
      { tokens: 5, usd: 10 }
    );
  });
});
