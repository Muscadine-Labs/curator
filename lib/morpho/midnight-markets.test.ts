import { describe, expect, it } from 'vitest';
import { selectMidnightCollaterals, sumMidnightPositionRows } from './midnight-markets';

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
      collateralByToken: new Map(),
    });
  });

  it('skips unreadable amounts and an empty page', () => {
    expect(sumMidnightPositionRows([{ type: 'lend', credit: 'nope', debt: '1' }])).toEqual({
      lenderCredit: 0n,
      borrowerDebt: 1n,
      lendCount: 1,
      borrowCount: 0,
      collateralByToken: new Map(),
    });
    expect(sumMidnightPositionRows([])).toEqual({
      lenderCredit: 0n,
      borrowerDebt: 0n,
      lendCount: 0,
      borrowCount: 0,
      collateralByToken: new Map(),
    });
  });

  it('sums posted collateral by token', () => {
    const summed = sumMidnightPositionRows([
      {
        type: 'borrow',
        credit: '0',
        debt: '10',
        collaterals: [
          { token: '0xAbC', amount: '5' },
          { token: '0xabc', amount: '2' },
        ],
      },
    ]);
    expect(summed.collateralByToken.get('0xabc')).toBe(7n);
  });
});

describe('selectMidnightCollaterals', () => {
  const loan = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
  const cbbtc = '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf';

  it('drops the loan token when another collateral is listed', () => {
    expect(
      selectMidnightCollaterals(
        [
          { token: loan, symbol: 'USDC' },
          { token: cbbtc, symbol: 'cbBTC' },
        ],
        loan
      ).map((c) => c.symbol)
    ).toEqual(['cbBTC']);
  });

  it('keeps the loan token when it is the only collateral', () => {
    expect(
      selectMidnightCollaterals([{ token: loan, symbol: 'USDC' }], loan).map((c) => c.symbol)
    ).toEqual(['USDC']);
  });

  it('drops the Tenor collateral-vault share when the underlying is listed', () => {
    expect(
      selectMidnightCollaterals(
        [
          { token: cbbtc, symbol: 'cbBTC' },
          { token: '0xf6a70085b7f79fa76b04ebf7a2d7d87c3c5c04bc', symbol: 'cbBTC-USDC-collat' },
        ],
        loan
      ).map((c) => c.symbol)
    ).toEqual(['cbBTC']);
  });
});
