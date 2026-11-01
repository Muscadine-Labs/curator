import { gql } from 'graphql-request';
import { morphoGraphQLClient } from '@/lib/morpho/graphql-client';
import { withServerResponseCache } from '@/lib/api/server-response-cache';
import { API_CACHE_MAX_AGE_MS } from '@/lib/api/response-cache';
import { getVaultAddressesForProtocolStats } from '@/lib/config/vaults';
import { logger } from '@/lib/utils/logger';
import {
  collateralAtRiskCurve,
  collateralAtRiskFromMorpho,
  rawAmountString,
  type CollateralAtRiskPoint,
} from '@/lib/morpho/market-activity-math';

/**
 * Blue market activity for the market detail page: borrowers, suppliers,
 * liquidations, vaults listing the market, rate history and the IRM curve.
 * Cached ≤30s. `supplyingVaultV2s` only returns 20 vaults, so configured
 * Muscadine vault adapters are resolved afterward and their position on this
 * market is loaded with any listing-vault adapter missing from the top page.
 */

/**
 * Rows for the borrowers / suppliers / liquidations tables. Morpho's
 * `marketCollateralAtRisk` covers every position, so the borrower page doubles
 * as the (labelled) fallback curve instead of a separate 500-row fetch.
 */
const TABLE_ROWS = 100;
const HISTORY_DAYS = 90;
/** Utilization steps of 1% from 0% through 100% (101 samples). */
const IRM_POINTS = 100;
/** Price-drop steps of 1% from −99% through 0% (100 samples). */
const COLLATERAL_AT_RISK_POINTS = 100;

const MARKET_ACTIVITY_QUERY = gql`
  query CuratorMarketActivity(
    $marketId: String!
    $chainId: Int!
    $rows: Int!
    $since: Int!
    $irmPoints: Int!
    $riskPoints: Int!
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
    risk: marketCollateralAtRisk(uniqueKey: $marketId, chainId: $chainId, numberOfPoints: $riskPoints) {
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

/** Adapter addresses for configured vaults. Positions are a separate, cheaper query. */
const CONFIGURED_VAULT_ADAPTERS_QUERY = gql`
  query CuratorConfiguredVaultAdapters($chainId: Int!, $vaultAddresses: [String!]!) {
    configuredVaults: vaultV2s(
      first: 20
      where: { chainId_in: [$chainId], address_in: $vaultAddresses }
    ) {
      items {
        address
        name
        adapters(first: 10) {
          items {
            address
          }
        }
      }
    }
  }
`;

/** Positions for adapters missing from the top supplier page. */
const MISSING_ADAPTER_SUPPLIERS_QUERY = gql`
  query CuratorMissingAdapterSuppliers(
    $marketId: String!
    $chainId: Int!
    $addresses: [String!]!
    $rows: Int!
  ) {
    marketPositions(
      first: $rows
      where: {
        marketUniqueKey_in: [$marketId]
        chainId_in: [$chainId]
        userAddress_in: $addresses
        supplyShares_gte: 1
      }
    ) {
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
  configuredVaults?: {
    items?: Array<{
      address?: string | null;
      name?: string | null;
      adapters?: {
        items?: Array<{
          address?: string | null;
          positions?: {
            items?: Array<{
              market?: { marketId?: string | null } | null;
              state?: { supplyAssets?: Num; supplyAssetsUsd?: number | null } | null;
            }> | null;
          } | null;
        }> | null;
      } | null;
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
  /** Set when this position is a vault, or the adapter a V2 vault supplies through. */
  vaultAddress: string | null;
  vaultName: string | null;
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

type SupplierPosition = {
  address: string;
  supplyAssets: string | null;
  supplyAssetsUsd: number | null;
};

type VaultDraft = {
  address: string;
  name: string;
  version: 'v1' | 'v2';
  curator: string | null;
  allocation: string | null;
  allocationUsd: number | null;
  supplierAddresses: string[];
};

function hasPositiveSupply(assets: string | null, usd: number | null): boolean {
  if (usd != null && Number.isFinite(usd) && usd > 0) return true;
  if (assets == null) return false;
  try {
    return BigInt(assets) > 0n;
  } catch {
    return false;
  }
}

/** Sum every adapter that holds this market. The explorer address is the largest one. */
function sumAdapterSupply(
  addresses: readonly string[],
  supplyByAddress: ReadonlyMap<string, SupplierPosition>
): { assets: string | null; usd: number | null; address: string | null } {
  let raw = 0n;
  let usd = 0;
  let found = false;
  let bestAddress: string | null = null;
  let bestUsd = Number.NEGATIVE_INFINITY;
  for (const address of addresses) {
    const position = supplyByAddress.get(address.toLowerCase());
    if (!position) continue;
    found = true;
    raw += BigInt(position.supplyAssets ?? '0');
    const rowUsd = position.supplyAssetsUsd ?? 0;
    usd += rowUsd;
    if (bestAddress == null || rowUsd > bestUsd) {
      bestUsd = rowUsd;
      bestAddress = position.address;
    }
  }
  return {
    assets: found ? raw.toString() : null,
    usd: found ? usd : null,
    address: bestAddress,
  };
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

  const supplierPositions = (data.suppliers?.items ?? [])
    .filter((s) => s.user?.address)
    .map((s) => ({
      address: s.user!.address!,
      supplyAssets: rawAmountString(s.state?.supplyAssets),
      supplyAssetsUsd: s.state?.supplyAssetsUsd ?? null,
    }));

  // V2 vaults supply through an adapter, so match positions by adapter address.
  const supplyByAddress = new Map(supplierPositions.map((s) => [s.address.toLowerCase(), s]));

  const v1: VaultDraft[] = (market?.supplyingVaults ?? []).map((v) => {
    const alloc = (v.state?.allocation ?? []).find(
      (a) => a.market?.marketId?.toLowerCase() === id
    );
    return {
      address: v.address,
      name: v.name,
      version: 'v1' as const,
      curator: v.state?.curator ?? null,
      allocation: rawAmountString(alloc?.supplyAssets),
      allocationUsd: alloc?.supplyAssetsUsd ?? null,
      supplierAddresses: [v.address],
    };
  });

  const v2: VaultDraft[] = (market?.supplyingVaultV2s ?? []).map((v) => {
    const names = (v.curators?.items ?? [])
      .map((c) => c.name)
      .filter((n): n is string => Boolean(n));
    return {
      address: v.address,
      name: v.name,
      version: 'v2' as const,
      curator: names.length > 0 ? names.join(', ') : null,
      allocation: null,
      allocationUsd: null,
      supplierAddresses: (v.adapters?.items ?? []).map((a) => a.address),
    };
  });

  // supplyingVaultV2s is capped at 20 vaults, so a Muscadine vault can be
  // allocated and still missing from that list and from the top supplier page.
  for (const vault of data.configuredVaults?.items ?? []) {
    if (!vault.address) continue;
    const holdings: string[] = [];
    for (const adapter of vault.adapters?.items ?? []) {
      if (!adapter.address) continue;
      for (const position of adapter.positions?.items ?? []) {
        if (position.market?.marketId?.toLowerCase() !== id) continue;
        const assets = rawAmountString(position.state?.supplyAssets);
        const usd = position.state?.supplyAssetsUsd ?? null;
        if (!hasPositiveSupply(assets, usd)) continue;
        supplyByAddress.set(adapter.address.toLowerCase(), {
          address: adapter.address,
          supplyAssets: assets,
          supplyAssetsUsd: usd,
        });
        if (!holdings.some((address) => address.toLowerCase() === adapter.address!.toLowerCase())) {
          holdings.push(adapter.address);
        }
      }
    }
    if (holdings.length === 0) continue;
    let draft = v2.find((candidate) => candidate.address.toLowerCase() === vault.address!.toLowerCase());
    if (!draft) {
      draft = {
        address: vault.address,
        name: vault.name ?? 'Vault',
        version: 'v2',
        curator: null,
        allocation: null,
        allocationUsd: null,
        supplierAddresses: [],
      };
      v2.push(draft);
    } else if (vault.name) {
      draft.name = vault.name;
    }
    for (const address of holdings) {
      if (!draft.supplierAddresses.some((existing) => existing.toLowerCase() === address.toLowerCase())) {
        draft.supplierAddresses.push(address);
      }
    }
  }

  for (const vault of v2) {
    const summed = sumAdapterSupply(vault.supplierAddresses, supplyByAddress);
    vault.allocation = summed.assets;
    vault.allocationUsd = summed.usd;
  }

  const vaultBySupplier = new Map<string, VaultDraft>();
  for (const vault of [...v1, ...v2]) {
    for (const supplier of vault.supplierAddresses) {
      vaultBySupplier.set(supplier.toLowerCase(), vault);
    }
  }

  const emittedVaults = new Set<string>();
  const suppliers: MarketSupplierRow[] = [];
  for (const position of supplierPositions) {
    const vault = vaultBySupplier.get(position.address.toLowerCase());
    if (vault?.version === 'v2') {
      const key = vault.address.toLowerCase();
      if (emittedVaults.has(key)) continue;
      emittedVaults.add(key);
      const summed = sumAdapterSupply(vault.supplierAddresses, supplyByAddress);
      suppliers.push({
        address: summed.address ?? position.address,
        supplyAssets: summed.assets,
        supplyAssetsUsd: summed.usd,
        vaultAddress: vault.address,
        vaultName: vault.name,
      });
      continue;
    }
    if (vault) emittedVaults.add(vault.address.toLowerCase());
    suppliers.push({
      ...position,
      vaultAddress: vault?.address ?? null,
      vaultName: vault?.name ?? null,
    });
  }

  const vaults: MarketListingVault[] = [...v1, ...v2]
    .map((vault) => ({
      address: vault.address,
      name: vault.name,
      version: vault.version,
      curator: vault.curator,
      allocation: vault.allocation,
      allocationUsd: vault.allocationUsd,
    }))
    .sort((a, b) => (b.allocationUsd ?? -1) - (a.allocationUsd ?? -1));

  const draftByAddress = new Map(
    [...v1, ...v2].map((vault) => [vault.address.toLowerCase(), vault])
  );
  for (const listing of vaults) {
    if (emittedVaults.has(listing.address.toLowerCase())) continue;
    const vault = draftByAddress.get(listing.address.toLowerCase());
    if (!vault) continue;
    const summed =
      vault.version === 'v2' ? sumAdapterSupply(vault.supplierAddresses, supplyByAddress) : null;
    suppliers.push({
      address:
        summed?.address ??
        (vault.version === 'v2' ? vault.supplierAddresses[0] : vault.address) ??
        vault.address,
      supplyAssets: summed?.assets ?? vault.allocation,
      supplyAssetsUsd: summed?.usd ?? vault.allocationUsd,
      vaultAddress: vault.address,
      vaultName: vault.name,
    });
  }

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

async function attachVaultSuppliers(
  data: GraphActivity,
  marketId: string,
  chainId: number,
  vaultAddresses: string[]
): Promise<void> {
  const known = new Set(
    (data.suppliers?.items ?? [])
      .map((item) => item.user?.address?.toLowerCase())
      .filter((address): address is string => Boolean(address))
  );
  const listingAdapters: string[] = [];
  for (const vault of data.market?.supplyingVaultV2s ?? []) {
    for (const adapter of vault.adapters?.items ?? []) {
      const address = adapter.address.toLowerCase();
      if (known.has(address) || listingAdapters.some((item) => item.toLowerCase() === address)) continue;
      listingAdapters.push(adapter.address);
    }
  }

  if (vaultAddresses.length > 0) {
    try {
      const vaults = await morphoGraphQLClient.request<{
        configuredVaults?: GraphActivity['configuredVaults'];
      }>(CONFIGURED_VAULT_ADAPTERS_QUERY, { chainId, vaultAddresses });
      data.configuredVaults = vaults.configuredVaults;
    } catch (error) {
      logger.warn('Failed to load configured vault adapters for this market', {
        marketId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const existing = new Map(
    (data.suppliers?.items ?? [])
      .filter((item) => item.user?.address)
      .map((item) => [item.user!.address!.toLowerCase(), item])
  );
  const configuredAdapters = (data.configuredVaults?.items ?? []).flatMap((vault) =>
    (vault.adapters?.items ?? [])
      .map((adapter) => adapter.address)
      .filter((address): address is string => Boolean(address))
  );
  const wanted = [...listingAdapters];
  for (const address of configuredAdapters) {
    if (existing.has(address.toLowerCase())) continue;
    if (wanted.some((item) => item.toLowerCase() === address.toLowerCase())) continue;
    wanted.push(address);
  }

  let fetched: NonNullable<GraphActivity['suppliers']>['items'] = [];
  if (wanted.length > 0) {
    try {
      const extra = await morphoGraphQLClient.request<{
        marketPositions?: GraphActivity['suppliers'];
      }>(MISSING_ADAPTER_SUPPLIERS_QUERY, {
        marketId,
        chainId,
        addresses: wanted,
        rows: wanted.length,
      });
      fetched = extra.marketPositions?.items ?? [];
    } catch (error) {
      logger.warn('Failed to load vault adapters outside the top suppliers', {
        marketId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const byAddress = new Map(existing);
  for (const item of fetched ?? []) {
    if (!item.user?.address) continue;
    byAddress.set(item.user.address.toLowerCase(), item);
  }
  for (const vault of data.configuredVaults?.items ?? []) {
    for (const adapter of vault.adapters?.items ?? []) {
      if (!adapter.address) continue;
      const hit = byAddress.get(adapter.address.toLowerCase());
      if (!hit) continue;
      adapter.positions = {
        items: [{ market: { marketId }, state: hit.state }],
      };
    }
  }
  const listingItems = (fetched ?? []).filter((item) => {
    const address = item.user?.address?.toLowerCase();
    return (
      address != null &&
      !known.has(address) &&
      listingAdapters.some((adapter) => adapter.toLowerCase() === address)
    );
  });
  if (listingItems.length === 0) return;
  data.suppliers = {
    pageInfo: data.suppliers?.pageInfo,
    items: [...(data.suppliers?.items ?? []), ...listingItems],
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
      const vaultAddresses = getVaultAddressesForProtocolStats()
        .filter((vault) => vault.chainId === chainId)
        .map((vault) => vault.address);
      const data = await morphoGraphQLClient.request<GraphActivity>(MARKET_ACTIVITY_QUERY, {
        marketId,
        chainId,
        rows: TABLE_ROWS,
        since,
        irmPoints: IRM_POINTS,
        riskPoints: COLLATERAL_AT_RISK_POINTS,
      });
      if (!data.market) return null;
      await attachVaultSuppliers(data, marketId, chainId, vaultAddresses);
      return mapMarketActivity(data, marketId);
    }
  );
}
