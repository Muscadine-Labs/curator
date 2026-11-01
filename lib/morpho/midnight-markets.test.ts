import { describe, expect, it } from 'vitest';
import {
  buildMidnightHistory,
  isMidnightMarketActive,
  mapMidnightHistoryBuckets,
  selectMidnightCollaterals,
  sumMidnightPositionRows,
} from './midnight-markets';

describe('isMidnightMarketActive', () => {
  const now = 1_700_000_000;

  it('is active only while maturity is still ahead', () => {
    expect(isMidnightMarketActive(now + 1, now)).toBe(true);
    expect(isMidnightMarketActive(now, now)).toBe(false);
    expect(isMidnightMarketActive(now - 1, now)).toBe(false);
    expect(isMidnightMarketActive(0, now)).toBe(false);
  });
});

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

describe('mapMidnightHistoryBuckets', () => {
  const day = 1_700_000_000;
  const maturity = day + 25 * 86_400;
  const priceWad = `${995n * 10n ** 15n}`;

  it('prices each day against the time left until maturity', () => {
    const [point] = mapMidnightHistoryBuckets(
      [
        {
          timestamp: day,
          outstandingLoans: '1000000',
          outstandingLoansUsd: 1,
          takePriceWad: priceWad,
        },
      ],
      maturity
    );
    expect(point.outstandingAssets).toBe('1000000');
    expect(point.takePrice).toBeCloseTo(0.995);
    expect(point.apr).toBeCloseTo((1 / 0.995 - 1) * (365 / 25), 6);
  });

  it('drops a take once the bucket is at or past maturity and skips a bad timestamp', () => {
    const points = mapMidnightHistoryBuckets(
      [
        { timestamp: maturity, outstandingLoans: '1', takePriceWad: priceWad },
        { timestamp: null, outstandingLoans: '2', takePriceWad: priceWad },
        {
          timestamp: day + 86_400,
          outstandingLoans: '3',
          outstandingLoansUsd: 3,
          takePriceWad: priceWad,
        },
      ],
      maturity
    );
    expect(points.map((point) => point.timestamp)).toEqual([day + 86_400, maturity]);
    expect(points[0].apr).not.toBeNull();
    expect(points[0].takePrice).toBeCloseTo(0.995);
    expect(points[1].apr).toBeNull();
    expect(points[1].takePrice).toBeCloseTo(0.995);
  });
});

describe('buildMidnightHistory', () => {
  const day = 1_793_404_800;
  const next = day + 86_400;

  it('matches a closed Morpho day: lend volume, one delta, and borrow exits', () => {
    const points = buildMidnightHistory(
      [
        {
          id: 'lend',
          event_type: 'lend',
          created_at: day + 100,
          data: {
            assets: '30825874984',
            units: '31082864715',
            total_units_delta: '27754609690',
          },
        },
        {
          id: 'borrow-same-fill',
          event_type: 'borrow',
          created_at: day + 100,
          data: {
            assets: '30825874984',
            units: '31082864715',
            total_units_delta: '27754609690',
          },
        },
        {
          id: 'exit',
          event_type: 'exit_borrow_primary',
          created_at: day + 200,
          data: { units: '3328189733' },
        },
      ],
      {
        maturitySec: 1_798_210_800,
        totalUnits: '1885831712829',
        nowSec: next + 10,
        loanDecimals: 6,
        loanUsd: 1,
        complete: true,
      }
    );
    const closed = points.find((point) => point.timestamp === day);
    const following = points.find((point) => point.timestamp === next);
    expect(closed?.outstandingAssets).toBe('1861405292872');
    expect(following?.outstandingAssets).toBe('1885831712829');
    expect(closed?.takePrice).toBeCloseTo(30825874984 / 31082864715, 12);
    expect(following?.takePrice).toBeNull();
    expect(closed?.apr).not.toBeNull();
  });

  it('leaves off a partial first day when paging did not reach the window start', () => {
    const points = buildMidnightHistory(
      [
        {
          event_type: 'lend',
          created_at: day + 10,
          data: { assets: '2', units: '2', total_units_delta: '2' },
        },
      ],
      {
        maturitySec: day + 10 * 86_400,
        totalUnits: '10',
        nowSec: next + 5,
        loanDecimals: 6,
        loanUsd: null,
        complete: false,
      }
    );
    expect(points.some((point) => point.timestamp === day)).toBe(false);
    expect(points[0]?.timestamp).toBe(next);
    expect(points[0]?.outstandingAssets).toBe('10');
  });
});
