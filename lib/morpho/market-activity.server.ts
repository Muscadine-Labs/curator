import { gql } from 'graphql-request';
import { morphoGraphQLClient } from '@/lib/morpho/graphql-client';
import { withServerResponseCache } from '@/lib/api/server-response-cache';
import { API_CACHE_MAX_AGE_MS } from '@/lib/api/response-cache';
import {
  collateralAtRiskCurve,
  collateralAtRiskFromMorpho,
  rawAmountString,
  type CollateralAtRiskPoint,
} from '@/lib/morpho/market-activity-math';

/**
 * Blue market activity for the market detail page: borrowers, suppliers,
 * liquidations, vaults listing the market, rate history and the IRM curve.
 * One Morpho GraphQL round trip, cached ≤30s.
 */

/**
 * Rows for the borrowers / suppliers / liquidations tables. Morpho's
 * `marketCollateralAtRisk` covers every position, so the borrower page doubles
 * as the (labelled) fallback curve instead of a separate 500-row fetch.
 */
const TABLE_ROWS = 100;
const HISTORY_DAYS = 90;
const IRM_POINTS = 40;

const MARKET_ACTIVITY_QUERY = gql`
  query CuratorMarketActivity(
    $marketId: String!
    $chainId: Int!
    $rows: Int!
    $since: Int!
    $irmPoints: Int!
  ) {
    market: marketById(marketId: $marketId, chainId: $chainId) {
      state {
        apyAtTarget
        fee
        utilization
        supplyAssetsUsd
        borrowAssetsUsd
        collateralAssetsUsd
      }
      currentIrmCurve(numberOfPoints: $irmPoints) {
        utilization
        supplyApy
        borrowApy
      }
      historicalState {
        borrowApy(options: { interval: DAY, startTimestamp: $since }) {
          x
          y
        }
        supplyApy(options: { interval: DAY, startTimestamp: $since }) {
          x
          y
        }
        utilization(options: { interval: DAY, startTimestamp: $since }) {
          x
          y
        }
        apyAtTarget(options: { interval: DAY, startTimestamp: $since }) {
          x
          y
        }
      }
      supplyingVaults {
        address
        name
        state {
          curator
          allocation {
            market {
              marketId
            }
            supplyAssets
            supplyAssetsUsd
          }
        }
      }
      supplyingVaultV2s {
        address
        name
        curators {
          items {
            name
          }
        }
        adapters {
          items {
            address
          }
        }
      }
    }
    risk: marketCollateralAtRisk(uniqueKey: $marketId, chainId: $chainId, numberOfPoints: 20) {
      collateralAtRisk {
        collateralPriceRatio
        collateralUsd
      }
    }
    borrowers: marketPositions(
      first: $rows
      orderBy: BorrowShares
      orderDirection: Desc
      where: { marketUniqueKey_in: [$marketId], chainId_in: [$chainId], borrowShares_gte: 1 }
    ) {
      pageInfo {
        countTotal
      }
      items {
        healthFactor
        priceVariationToLiquidationPrice
        user {
          address
        }
        state {
          collateral
          collateralUsd
          borrowAssets
          borrowAssetsUsd
        }
      }
    }
    suppliers: marketPositions(
      first: $rows
      orderBy: SupplyShares
      orderDirection: Desc
      where: { marketUniqueKey_in: [$marketId], chainId_in: [$chainId], supplyShares_gte: 1 }
    ) {
      pageInfo {
        countTotal
      }
      items {
        user {
          address
        }
        state {
          supplyAssets
          supplyAssetsUsd
        }
      }
    }
    liquidations: marketTransactions(
      first: $rows
      orderBy: Timestamp
      orderDirection: Desc
      where: { marketUniqueKey_in: [$marketId], chainId_in: [$chainId], type_in: [Liquidation] }
    ) {
      items {
        txHash
        timestamp
        user {
          address
        }
        data {
          __typename
          ... on MarketTransactionLiquidationData {
            liquidator
            repaidAssets
            seizedAssets
            badDebtAssets
          }
        }
      }
    }
  }
`;

type Num = number | string | null | undefined;
type Point = { x: number; y: number | null };

type GraphActivity = {
  risk?: {
    collateralAtRisk?: Array<{ collateralPriceRatio: number; collateralUsd: number | null }> | null;
  } | null;
  market?: {
    state?: {
      apyAtTarget?: number | null;
      fee?: number | null;
      utilization?: number | null;
      supplyAssetsUsd?: number | null;
      borrowAssetsUsd?: number | null;
      collateralAssetsUsd?: number | null;
    } | null;
    currentIrmCurve?: Array<{ utilization: number; supplyApy: number; borrowApy: number }> | null;
    historicalState?: {
      borrowApy?: Point[] | null;
      supplyApy?: Point[] | null;
      utilization?: Point[] | null;
      apyAtTarget?: Point[] | null;
    } | null;
    supplyingVaults?: Array<{
      address: string;
      name: string;
      state?: {
        curator?: string | null;
        allocation?: Array<{
          market?: { marketId?: string | null } | null;
          supplyAssets?: Num;
          supplyAssetsUsd?: number | null;
        }> | null;
      } | null;
    }> | null;
    supplyingVaultV2s?: Array<{
      address: string;
      name: string;
      curators?: { items?: Array<{ name?: string | null }> | null } | null;
      adapters?: { items?: Array<{ address: string }> | null } | null;
    }> | null;
  } | null;
  borrowers?: {
    pageInfo?: { countTotal?: number | null } | null;
    items?: Array<{
      healthFactor?: number | null;
      priceVariationToLiquidationPrice?: number | null;
      user?: { address?: string | null } | null;
      state?: {
        collateral?: Num;
        collateralUsd?: number | null;
        borrowAssets?: Num;
        borrowAssetsUsd?: number | null;
      } | null;
    }> | null;
  } | null;
  suppliers?: {
    pageInfo?: { countTotal?: number | null } | null;
    items?: Array<{
      user?: { address?: string | null } | null;
      state?: { supplyAssets?: Num; supplyAssetsUsd?: number | null } | null;
    }> | null;
  } | null;
  liquidations?: {
    items?: Array<{
      txHash: string;
      timestamp: number;
      user?: { address?: string | null } | null;
      data?: {
        __typename?: string;
        liquidator?: string | null;
        repaidAssets?: Num;
        seizedAssets?: Num;
        badDebtAssets?: Num;
      } | null;
    }> | null;
  } | null;
};

export type MarketBorrowerRow = {
  address: string;
  collateral: string | null;
  collateralUsd: number | null;
  borrowAssets: string | null;
  borrowAssetsUsd: number | null;
  healthFactor: number | null;
  priceVariationToLiquidationPrice: number | null;
};

export type MarketSupplierRow = {
  address: string;
  supplyAssets: string | null;
  supplyAssetsUsd: number | null;
};

export type MarketLiquidationRow = {
  txHash: string;
  timestamp: number;
  borrower: string | null;
  liquidator: string | null;
  repaidAssets: string | null;
  seizedAssets: string | null;
  badDebtAssets: string | null;
};

export type MarketListingVault = {
  address: string;
  name: string;
  version: 'v1' | 'v2';
  /** V2 curator names, or the V1 curator address. */
  curator: string | null;
  /** Loan-token raw units in this market; null when it could not be resolved. */
  allocation: string | null;
  allocationUsd: number | null;
};

export type MarketSeriesPoint = { x: number; y: number };

export type MarketActivity = {
  borrowers: MarketBorrowerRow[];
  borrowerCount: number | null;
  suppliers: MarketSupplierRow[];
  supplierCount: number | null;
  liquidations: MarketLiquidationRow[];
  vaults: MarketListingVault[];
  collateralAtRisk: CollateralAtRiskPoint[];
  /**
   * `morpho` = Morpho's full-market curve; `topBorrowers` = our fallback from
   * the largest borrow positions only.
   */
  collateralAtRiskSource: 'morpho' | 'topBorrowers';
  /** Borrow USD covered by the positions behind the fallback curve (≤ market borrow). */
  collateralAtRiskBorrowUsd: number;
  marketBorrowUsd: number | null;
  history: {
    borrowApy: MarketSeriesPoint[];
    supplyApy: MarketSeriesPoint[];
    utilization: MarketSeriesPoint[];
    apyAtTarget: MarketSeriesPoint[];
  };
  irmCurve: Array<{ utilization: number; supplyApy: number; borrowApy: number }>;
  apyAtTarget: number | null;
  fee: number | null;
};

function series(points: Point[] | null | undefined): MarketSeriesPoint[] {
  return (points ?? [])
    .filter((p): p is { x: number; y: number } => p.y != null && Number.isFinite(p.y))
    .map((p) => ({ x: p.x, y: p.y }))
    .sort((a, b) => a.x - b.x);
}

function collateralAtRiskFields(
  data: GraphActivity,
  borrowers: MarketBorrowerRow[]
): Pick<MarketActivity, 'collateralAtRisk' | 'collateralAtRiskSource'> {
  const morpho = data.risk?.collateralAtRisk ?? [];
  if (morpho.length > 0) {
    return { collateralAtRisk: collateralAtRiskFromMorpho(morpho), collateralAtRiskSource: 'morpho' };
  }
  return { collateralAtRisk: collateralAtRiskCurve(borrowers), collateralAtRiskSource: 'topBorrowers' };
}

/** Pure mapping, exported for tests. */
export function mapMarketActivity(data: GraphActivity, marketId: string): MarketActivity {
  const market = data.market;
  const id = marketId.toLowerCase();

  const allBorrowers: MarketBorrowerRow[] = (data.borrowers?.items ?? [])
    .filter((b) => b.user?.address)
    .map((b) => ({
      address: b.user!.address!,
      collateral: rawAmountString(b.state?.collateral),
      collateralUsd: b.state?.collateralUsd ?? null,
      borrowAssets: rawAmountString(b.state?.borrowAssets),
      borrowAssetsUsd: b.state?.borrowAssetsUsd ?? null,
      healthFactor: b.healthFactor ?? null,
      priceVariationToLiquidationPrice: b.priceVariationToLiquidationPrice ?? null,
    }));

  const suppliers: MarketSupplierRow[] = (data.suppliers?.items ?? [])
    .filter((s) => s.user?.address)
    .map((s) => ({
      address: s.user!.address!,
      supplyAssets: rawAmountString(s.state?.supplyAssets),
      supplyAssetsUsd: s.state?.supplyAssetsUsd ?? null,
    }));

  // V2 vaults supply through their adapter, so match supplier rows by adapter.
  const supplyByAddress = new Map(suppliers.map((s) => [s.address.toLowerCase(), s]));

  const v1: MarketListingVault[] = (market?.supplyingVaults ?? []).map((v) => {
    const alloc = (v.state?.allocation ?? []).find(
      (a) => a.market?.marketId?.toLowerCase() === id
    );
    return {
      address: v.address,
      name: v.name,
      version: 'v1',
      curator: v.state?.curator ?? null,
      allocation: rawAmountString(alloc?.supplyAssets),
      allocationUsd: alloc?.supplyAssetsUsd ?? null,
    };
  });

  const v2: MarketListingVault[] = (market?.supplyingVaultV2s ?? []).map((v) => {
    let raw = 0n;
    let usd = 0;
    let found = false;
    for (const a of v.adapters?.items ?? []) {
      const s = supplyByAddress.get(a.address.toLowerCase());
      if (!s) continue;
      found = true;
      raw += BigInt(s.supplyAssets ?? '0');
      usd += s.supplyAssetsUsd ?? 0;
    }
    const names = (v.curators?.items ?? [])
      .map((c) => c.name)
      .filter((n): n is string => Boolean(n));
    return {
      address: v.address,
      name: v.name,
      version: 'v2',
      curator: names.length > 0 ? names.join(', ') : null,
      allocation: found ? raw.toString() : null,
      allocationUsd: found ? usd : null,
    };
  });

  const vaults = [...v1, ...v2].sort(
    (a, b) => (b.allocationUsd ?? -1) - (a.allocationUsd ?? -1)
  );

  const liquidations: MarketLiquidationRow[] = (data.liquidations?.items ?? []).map((l) => ({
    txHash: l.txHash,
    timestamp: l.timestamp,
    borrower: l.user?.address ?? null,
    liquidator: l.data?.liquidator ?? null,
    repaidAssets: rawAmountString(l.data?.repaidAssets),
    seizedAssets: rawAmountString(l.data?.seizedAssets),
    badDebtAssets: rawAmountString(l.data?.badDebtAssets),
  }));

  return {
    borrowers: allBorrowers,
    borrowerCount: data.borrowers?.pageInfo?.countTotal ?? null,
    suppliers,
    supplierCount: data.suppliers?.pageInfo?.countTotal ?? null,
    liquidations,
    vaults,
    ...collateralAtRiskFields(data, allBorrowers),
    collateralAtRiskBorrowUsd: allBorrowers.reduce((s, b) => s + (b.borrowAssetsUsd ?? 0), 0),
    marketBorrowUsd: market?.state?.borrowAssetsUsd ?? null,
    history: {
      borrowApy: series(market?.historicalState?.borrowApy),
      supplyApy: series(market?.historicalState?.supplyApy),
      utilization: series(market?.historicalState?.utilization),
      apyAtTarget: series(market?.historicalState?.apyAtTarget),
    },
    irmCurve: market?.currentIrmCurve ?? [],
    apyAtTarget: market?.state?.apyAtTarget ?? null,
    fee: market?.state?.fee ?? null,
  };
}

export async function fetchMarketActivity(
  marketId: string,
  chainId: number
): Promise<MarketActivity | null> {
  return withServerResponseCache(
    `market-activity:${chainId}:${marketId.toLowerCase()}`,
    API_CACHE_MAX_AGE_MS,
    async () => {
      const since = Math.floor(Date.now() / 1000) - HISTORY_DAYS * 86400;
      const data = await morphoGraphQLClient.request<GraphActivity>(MARKET_ACTIVITY_QUERY, {
        marketId,
        chainId,
        rows: TABLE_ROWS,
        since,
        irmPoints: IRM_POINTS,
      });
      if (!data.market) return null;
      return mapMarketActivity(data, marketId);
    }
  );
}
