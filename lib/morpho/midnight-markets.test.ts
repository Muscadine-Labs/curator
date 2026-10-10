import { describe, expect, it } from 'vitest';
import { sumMidnightPositionRows } from './midnight-markets';

describe('sumMidnightPositionRows', () => {
  it('sums lender credit and borrower debt in loan-token units', () => {
    expect(
      sumMidnightPositionRows([
        { type: 'lend', credit: '100', debt: '0' },
        { type: 'lend', credit: '50', debt: '0' },
        { type: 'borrow', credit: '0', debt: '140' },
        { type: 'collateral_only', credit: '0', debt: '0' },
      ])
    ).toEqual({
      lenderCredit: 150n,
      borrowerDebt: 140n,
      lendCount: 2,
      borrowCount: 1,
    });
  });

  it('skips unreadable amounts and an empty page', () => {
    expect(sumMidnightPositionRows([{ type: 'lend', credit: 'nope', debt: '1' }])).toEqual({
      lenderCredit: 0n,
      borrowerDebt: 1n,
      lendCount: 1,
      borrowCount: 0,
    });
    expect(sumMidnightPositionRows([])).toEqual({
      lenderCredit: 0n,
      borrowerDebt: 0n,
      lendCount: 0,
      borrowCount: 0,
    });
  });
});
