import { describe, expect, it } from 'vitest';
import type { CuratorMarketListItem } from '@/lib/morpho/curator-markets';
import type { MidnightMarketListItem } from '@/lib/morpho/midnight-markets';
import {
  blueBrowseRow,
  compareBrowseRows,
  midnightBrowseRow,
  type MarketsBrowseRow,
} from './markets-browse-rows';

function blue(overrides: Partial<CuratorMarketListItem> = {}): MarketsBrowseRow {
  return blueBrowseRow({
    marketId: '0xblue',
    collateralSymbol: 'cbBTC',
    loanSymbol: 'USDC',
    lltv: '860000000000000000',
    sizeUsd: 100,
    liquidityAssetsUsd: 40,
    avgNetSupplyApy: 0.05,
    listed: true,
    muscadineVaults: [],
    ...overrides,
  } as CuratorMarketListItem);
}

function midnight(overrides: Partial<MidnightMarketListItem> = {}): MarketsBrowseRow {
  return midnightBrowseRow({
    marketId: '0xmidnight',
    collateralLabel: 'cbBTC',
    loanSymbol: 'USDC',
    lltvRatio: 0.86,
    sizeUsd: 20,
    maturity: 1_800_000_000,
    ...overrides,
  } as MidnightMarketListItem);
}

describe('compareBrowseRows', () => {
  it('sorts Blue and Midnight together by market size', () => {
    const rows = [midnight(), blue()].sort((a, b) => compareBrowseRows(a, b, 'sizeUsd', 'desc'));
    expect(rows.map((row) => row.product)).toEqual(['blue', 'midnight']);
  });

  it('keeps a blank Midnight APY below a real Blue rate in either direction', () => {
    const rows = [midnight(), blue()];
    expect(
      [...rows].sort((a, b) => compareBrowseRows(a, b, 'apy', 'desc')).map((row) => row.product)
    ).toEqual(['blue', 'midnight']);
    expect(
      [...rows].sort((a, b) => compareBrowseRows(a, b, 'apy', 'asc')).map((row) => row.product)
    ).toEqual(['blue', 'midnight']);
  });

  it('keeps Blue, which has no maturity, below a Midnight maturity', () => {
    const rows = [blue(), midnight()].sort((a, b) =>
      compareBrowseRows(a, b, 'maturity', 'asc')
    );
    expect(rows.map((row) => row.product)).toEqual(['midnight', 'blue']);
  });

  it('reads Blue LLTV from WAD and leaves Midnight without a variable rate', () => {
    expect(blue().lltv).toBeCloseTo(0.86);
    expect(midnight().apy).toBeNull();
    expect(midnight().liquidityUsd).toBeNull();
    expect(midnight().listed).toBeNull();
    expect(blue().maturity).toBeNull();
  });
});
