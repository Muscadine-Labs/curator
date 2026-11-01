import type { CuratorMarketListItem } from '@/lib/morpho/curator-markets';
import type { MidnightMarketListItem } from '@/lib/morpho/midnight-markets';
import { lltvToFraction } from '@/lib/format/number';

export type BrowseSortKey =
  | 'pair'
  | 'lltv'
  | 'sizeUsd'
  | 'liquidity'
  | 'apy'
  | 'maturity'
  | 'listed'
  | 'muscadine';

export type BrowseSortDir = 'asc' | 'desc';

/** One browse row. Fields a product does not have stay null so the shared table can leave them blank. */
export type MarketsBrowseRow = {
  id: string;
  product: 'blue' | 'midnight';
  pair: string;
  lltv: number | null;
  sizeUsd: number | null;
  liquidityUsd: number | null;
  /** Net supply APY as a fraction. Midnight has no variable rate. */
  apy: number | null;
  /** Unix seconds. Blue has no maturity. */
  maturity: number | null;
  listed: boolean | null;
  muscadineCount: number | null;
  blue: CuratorMarketListItem | null;
  midnight: MidnightMarketListItem | null;
};

export function blueBrowseRow(market: CuratorMarketListItem): MarketsBrowseRow {
  return {
    id: `blue:${market.marketId}`,
    product: 'blue',
    pair: `${market.collateralSymbol}/${market.loanSymbol}`,
    lltv: lltvToFraction(market.lltv),
    sizeUsd: market.sizeUsd,
    liquidityUsd: market.liquidityAssetsUsd,
    apy: market.avgNetSupplyApy,
    maturity: null,
    listed: market.listed,
    muscadineCount: market.muscadineVaults.length,
    blue: market,
    midnight: null,
  };
}

export function midnightBrowseRow(market: MidnightMarketListItem): MarketsBrowseRow {
  return {
    id: `midnight:${market.marketId}`,
    product: 'midnight',
    pair: `${market.collateralLabel}/${market.loanSymbol}`,
    lltv: market.lltvRatio,
    sizeUsd: market.sizeUsd,
    liquidityUsd: null,
    apy: null,
    maturity: market.maturity > 0 ? market.maturity : null,
    listed: null,
    muscadineCount: null,
    blue: null,
    midnight: market,
  };
}

function sortValue(row: MarketsBrowseRow, key: BrowseSortKey): number | string | null {
  switch (key) {
    case 'pair':
      return row.pair.toLowerCase();
    case 'lltv':
      return row.lltv;
    case 'sizeUsd':
      return row.sizeUsd;
    case 'liquidity':
      return row.liquidityUsd;
    case 'apy':
      return row.apy;
    case 'maturity':
      return row.maturity;
    case 'listed':
      return row.listed == null ? null : Number(row.listed);
    case 'muscadine':
      return row.muscadineCount;
    default:
      return null;
  }
}

/** Missing values stay at the bottom in either direction, so a blank APY does not sort as 0%. */
export function compareBrowseRows(
  a: MarketsBrowseRow,
  b: MarketsBrowseRow,
  key: BrowseSortKey,
  dir: BrowseSortDir
): number {
  const left = sortValue(a, key);
  const right = sortValue(b, key);
  if (left == null || right == null) {
    if (left == null && right == null) return 0;
    return left == null ? 1 : -1;
  }
  const cmp =
    typeof left === 'string' && typeof right === 'string'
      ? left.localeCompare(right)
      : (left as number) - (right as number);
  return dir === 'asc' ? cmp : -cmp;
}
