import { MorphoRestError, morphoRestGet, morphoRestList, morphoSelector } from '@/lib/morpho/rest-client';
import { rawToNumber, toBigInt, tryGetRestTokenPriceUsd, type RestMarket } from '@/lib/morpho/rest-data';
import { loadMarketCollateralAssets, loadMarketDetails, loadPrices, type MarketDetails } from '@/lib/morpho/rest-markets';
import { loadRestVaultSnapshot } from '@/lib/morpho/rest-vault.server';
import { getVaultAddressesForProtocolStats } from '@/lib/config/vaults';
import { isAllocatableMarketCap } from '@/lib/morpho/v2-allocation-targets';
import { isMarketCap } from '@/lib/morpho/cap-utils';
import { mapCap } from '@/lib/morpho/vault-v2-governance-map';
import { asBlueMarketData } from '@/lib/morpho/blue-market-data';
import {
  computeBlueMarketRiskScores,
  isMarketIdle,
  type MarketRiskScores,
} from '@/lib/morpho/compute-blue-market-risk';
import { getIRMTargetUtilizationWithFallback } from '@/lib/morpho/irm-utils';
import {
  getOracleTimestampData,
  oracleTimestampFromFeeds,
  type OracleTimestampData,
} from '@/lib/morpho/oracle-utils';
import { getOraclePriceSnapshot, type OraclePriceSnapshot } from '@/lib/morpho/oracle-price';
import { BASE_CHAIN_ID } from '@/lib/constants';
import type { Address } from 'viem';

export type CuratorMarketListItem = {
  marketId: string;
  chainId: number;
  listed: boolean;
  lltv: string | null;
  loanSymbol: string;
  loanAddress: string | null;
  collateralSymbol: string;
  collateralAddress: string | null;
  /** Morpho `sizeUsd` — total market size (matches Morpho app “Total Market Size”). */
  sizeUsd: number | null;
  supplyAssetsUsd: number | null;
  /** Raw loan supply assets (token units as decimal string). */
  supplyAssets: string | null;
  loanDecimals: number | null;
  /** Morpho `totalLiquidityUsd` — total market liquidity (matches Morpho app column). */
  totalLiquidityUsd: number | null;
  /** Available loan liquidity in the market (`liquidityAssetsUsd`). */
  liquidityAssetsUsd: number | null;
  /** Raw available loan liquidity (token units as decimal string). */
  liquidityAssets: string | null;
  /** Raw borrow assets (loan token units). */
  borrowAssets: string | null;
  /** Raw collateral assets (collateral token units). */
  collateralAssets: string | null;
  /** Rolling average net supply APY (Morpho `avgNetSupplyApy`, ≈ recent net rate). */
  avgNetSupplyApy: number | null;
  netSupplyApy: number | null;
  utilization: number | null;
  muscadineVaults: MuscadineMarketVaultRef[];
};

export type MuscadineMarketVaultRef = {
  address: string;
  name: string;
  symbol: string;
};

export type MarketBadDebtAmount = {
  usd: number | null;
  /** Loan-token raw units from Morpho GraphQL. */
  underlying: string | null;
};

export type CuratorMarketDetail = CuratorMarketListItem & {
  oracleAddress: string | null;
  irmAddress: string | null;
  loanDecimals: number | null;
  collateralDecimals: number | null;
  supplyApy: number | null;
  borrowApy: number | null;
  borrowAssetsUsd: number | null;
  collateralAssetsUsd: number | null;
  realizedBadDebt: MarketBadDebtAmount | null;
  /** Morpho `badDebt` — open / unrealized bad debt at the market level. */
  unrealizedBadDebt: MarketBadDebtAmount | null;
  scores: MarketRiskScores | null;
  oracleTimestampData: OracleTimestampData | null;
  oraclePrice: OraclePriceSnapshot | null;
  spotCollateralUsd: number | null;
  spotLoanUsd: number | null;
  /** Unix seconds — market creation. */
  createdAt: number | null;
  /** Unix seconds — oracle deployment (Morpho only indexes Chainlink V2 factory oracles). */
  oracleCreatedAt: number | null;
  /** Morpho GraphQL oracle `type` (e.g. ChainlinkOracleV2, Unknown). */
  oracleIndexedType: string | null;
  /** Morpho market warnings (e.g. unrecognized_collateral_asset). */
  warnings: MarketWarning[];
  /** IRM target utilization (fraction); Base only. */
  targetUtilization: number | null;
};

export type MarketWarning = { type: string; level: string | null };

type MuscadineIndex = Map<string, MuscadineMarketVaultRef[]>;

let muscadineIndexCache: { chainId: number; fetchedAt: number; index: MuscadineIndex } | null =
  null;

const MUSCADINE_INDEX_TTL_MS = 30_000;

/** Business vaults' allocatable market caps, from the shared REST vault snapshots. */
async function fetchMuscadineMarketIndex(chainId: number): Promise<MuscadineIndex> {
  const now = Date.now();
  if (
    muscadineIndexCache &&
    muscadineIndexCache.chainId === chainId &&
    now - muscadineIndexCache.fetchedAt < MUSCADINE_INDEX_TTL_MS
  ) {
    return muscadineIndexCache.index;
  }

  const vaults = getVaultAddressesForProtocolStats().filter((v) => v.chainId === chainId);
  const index: MuscadineIndex = new Map();

  await Promise.all(
    vaults.map(async (vault) => {
      try {
        const snap = await loadRestVaultSnapshot(chainId, vault.address);
        const caps = snap.caps.map(mapCap).filter(Boolean);
        const name = snap.vault.name ?? 'Muscadine Vault';
        const symbol = snap.vault.symbol ?? 'VAULT';
        for (const cap of caps) {
          if (!cap || !isMarketCap(cap) || !isAllocatableMarketCap(cap) || !cap.marketKey) continue;
          const key = cap.marketKey.toLowerCase();
          const existing = index.get(key) ?? [];
          if (!existing.some((v) => v.address.toLowerCase() === vault.address.toLowerCase())) {
            existing.push({ address: vault.address, name, symbol });
            index.set(key, existing);
          }
        }
      } catch {
        /* skip a vault whose REST read failed */
      }
    })
  );

  muscadineIndexCache = { chainId, fetchedAt: now, index };
  return index;
}

/** List row from REST market params + state, priced with the loan token's spot USD. */
function restMarketToListItem(
  m: MarketDetails,
  chainId: number,
  listed: boolean,
  loanPrice: number | null,
  muscadineIndex: MuscadineIndex
): CuratorMarketListItem {
  const decimals = m.loanToken.decimals;
  const supply = toBigInt(m.state.total_supply_assets);
  const borrow = toBigInt(m.state.total_borrow_assets);
  const cash = supply > borrow ? supply - borrow : BigInt(0);
  const usd = (raw: bigint) => (loanPrice === null ? null : rawToNumber(raw, decimals) * loanPrice);
  return {
    marketId: m.market.market_id,
    chainId,
    listed,
    lltv: m.market.lltv_wad,
    loanSymbol: m.loanToken.symbol ?? 'Unknown',
    loanAddress: m.market.loan_token,
    collateralSymbol: m.collateralToken?.symbol ?? 'Unknown',
    collateralAddress: m.market.collateral_token,
    sizeUsd: usd(supply),
    supplyAssetsUsd: usd(supply),
    supplyAssets: supply.toString(),
    loanDecimals: decimals,
    // REST has no list-wide Public Allocator liquidity; the detail page reads `/liquidity`.
    totalLiquidityUsd: null,
    liquidityAssetsUsd: usd(cash),
    liquidityAssets: cash.toString(),
    borrowAssets: borrow.toString(),
    collateralAssets: null,
    // Instant supply APY from the market's IRM state (REST has no rolling net APY per market
    // in the list; the 6h average is one more call per market).
    avgNetSupplyApy: m.supplyApy,
    netSupplyApy: m.supplyApy,
    utilization: m.utilization,
    muscadineVaults: muscadineIndex.get(m.marketId) ?? [],
  };
}

/**
 * The browser list is cached 2 minutes, an exception to the 30s ceiling: each refresh is ~1
 * REST call per market (~110), and a tab polls every 30s, which at 30s would use most of the
 * public 333 req/min sustained limit (a 7-day IP block past it). Set `MORPHO_API_KEY` before
 * shortening this.
 */
const BROWSER_CACHE_MS = 120_000;
const browserCache = new Map<number, { expiresAt: number; promise: Promise<CuratorMarketListItem[]> }>();

/**
 * Morpho-listed Blue markets plus every market a Muscadine vault caps. GraphQL listed the
 * chain's top 1,000 by size with state in one query; REST lists params only, so each market
 * costs a state read and unlisted markets outside Muscadine are no longer shown.
 */
export async function fetchCuratorMarkets(chainId: number): Promise<CuratorMarketListItem[]> {
  const cached = browserCache.get(chainId);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const promise = loadCuratorMarkets(chainId);
  browserCache.set(chainId, { expiresAt: Date.now() + BROWSER_CACHE_MS, promise });
  // A failed load is not kept.
  promise.catch(() => {
    if (browserCache.get(chainId)?.promise === promise) browserCache.delete(chainId);
  });
  return promise;
}

async function loadCuratorMarkets(chainId: number): Promise<CuratorMarketListItem[]> {
  {
    const [listedRows, muscadineIndex] = await Promise.all([
      morphoRestList<RestMarket & { creation_timestamp?: number | null }>('/v0/blue/markets', {
        chain_id: chainId,
        listed: 'true',
        limit: 1000,
      }),
      fetchMuscadineMarketIndex(chainId),
    ]);
    const known = new Map(listedRows.map((r) => [r.market_id.toLowerCase(), r]));
    const listedIds = new Set(known.keys());
    const ids = [...new Set([...listedIds, ...muscadineIndex.keys()])];
    const markets = await loadMarketDetails(chainId, ids, known);
    const prices = await loadPrices(chainId, markets.map((m) => m.market.loan_token));
    return markets
      .map((m) =>
        restMarketToListItem(
          m,
          chainId,
          listedIds.has(m.marketId),
          prices.get(m.market.loan_token.toLowerCase()) ?? null,
          muscadineIndex
        )
      )
      .sort((a, b) => (b.sizeUsd ?? 0) - (a.sizeUsd ?? 0));
  }
}

export async function fetchCuratorMarketDetail(
  marketId: string,
  chainId: number
): Promise<CuratorMarketDetail | null> {
  let details: MarketDetails;
  let listedRow: (RestMarket & { creation_timestamp?: number | null }) | undefined;
  let muscadineIndex: MuscadineIndex;
  let liquidity: { market_liquidity?: string | null; reallocatable_liquidity?: string | null } | null;
  try {
    const [loaded, rows, index, liq] = await Promise.all([
      loadMarketDetails(chainId, [marketId]),
      morphoRestList<RestMarket & { creation_timestamp?: number | null }>('/v0/blue/markets', {
        chain_id: chainId,
        market_id: marketId,
      }).catch(() => []),
      fetchMuscadineMarketIndex(chainId),
      morphoRestGet<{ market_liquidity?: string | null; reallocatable_liquidity?: string | null }>(
        `/v0/blue/markets/${morphoSelector(chainId, marketId)}/liquidity`
      ).catch(() => null),
    ]);
    details = loaded[0]!;
    listedRow = rows[0];
    muscadineIndex = index;
    liquidity = liq;
  } catch (error) {
    if (error instanceof MorphoRestError && error.status === 404) return null;
    throw error;
  }

  const loanDecimals = details.loanToken.decimals;
  const collateralDecimals = details.collateralToken?.decimals ?? 18;
  const [spotLoanUsd, spotCollateralUsd, collateralRaw, listedCheck, sixHourSupplyApy] = await Promise.all([
    tryGetRestTokenPriceUsd(chainId, details.market.loan_token),
    details.market.collateral_token ? tryGetRestTokenPriceUsd(chainId, details.market.collateral_token) : Promise.resolve(null),
    loadMarketCollateralAssets(chainId, details.marketId),
    // `listed` is a list filter, not a field: ask whether this market is in the listed set.
    morphoRestList<{ market_id: string }>('/v0/blue/markets', {
      chain_id: chainId,
      market_id: marketId,
      listed: 'true',
    }).catch(() => []),
    morphoRestGet<{ supply_apy_averages?: Record<string, number | null> | null }>(
      `/v0/blue/markets/${morphoSelector(chainId, marketId)}/apy-averages`
    )
      .then((d) => d.supply_apy_averages?.['6h'] ?? null)
      .catch(() => null),
  ]);
  const listItem = restMarketToListItem(details, chainId, listedCheck.length > 0, spotLoanUsd, muscadineIndex);
  // The detail's "6H net supply APY" row is Morpho's 6h average (one call; too many for the list).
  listItem.avgNetSupplyApy = sixHourSupplyApy ?? listItem.avgNetSupplyApy;
  const toLoanUsd = (raw: bigint) => (spotLoanUsd === null ? null : rawToNumber(raw, loanDecimals) * spotLoanUsd);
  const borrowRaw = toBigInt(details.state.total_borrow_assets);
  const collateralAssetsUsd =
    collateralRaw === null || spotCollateralUsd === null
      ? null
      : rawToNumber(collateralRaw, collateralDecimals) * spotCollateralUsd;
  const totalLiquidityUsd =
    liquidity?.market_liquidity != null
      ? toLoanUsd(toBigInt(liquidity.market_liquidity) + toBigInt(liquidity.reallocatable_liquidity))
      : null;

  const market = asBlueMarketData({
    id: details.market.market_id,
    marketId: details.market.market_id,
    loanAsset: { address: details.market.loan_token, symbol: listItem.loanSymbol, decimals: loanDecimals },
    collateralAsset: {
      address: details.market.collateral_token ?? '',
      symbol: listItem.collateralSymbol,
      decimals: collateralDecimals,
    },
    oracleAddress: details.market.oracle_address,
    oracle: null,
    irmAddress: details.market.irm_address,
    lltv: details.market.lltv_wad,
    // Not in Morpho REST: the bad-debt F override cannot fire.
    realizedBadDebt: null,
    state: {
      sizeUsd: listItem.sizeUsd,
      supplyAssetsUsd: listItem.supplyAssetsUsd,
      supplyAssets: listItem.supplyAssets,
      borrowAssetsUsd: toLoanUsd(borrowRaw),
      borrowAssets: borrowRaw.toString(),
      collateralAssetsUsd,
      collateralAssets: collateralRaw?.toString() ?? null,
      totalLiquidityUsd,
      liquidityAssets: listItem.liquidityAssets,
      liquidityAssetsUsd: listItem.liquidityAssetsUsd,
      utilization: details.utilization,
      supplyApy: details.supplyApy,
      borrowApy: details.borrowApy,
    },
    vaultSupplyAssets: null,
    vaultSupplyAssetsUsd: null,
    vaultTotalAssetsUsd: null,
    marketTotalSupplyUsd: listItem.supplyAssetsUsd,
  });

  let scores: MarketRiskScores | null = null;
  let oracleTimestampData: OracleTimestampData | null = null;
  let oraclePrice: OraclePriceSnapshot | null = null;
  let targetUtilization: number | null = null;

  // Oracle freshness, price bounds and IRM kink are read on Base RPC (feeds decoded on chain).
  if (chainId === BASE_CHAIN_ID && !isMarketIdle(market)) {
    const oracleAddr = market.oracleAddress ? (market.oracleAddress as Address) : null;
    const [targetUtil, priceSnapshot] = await Promise.all([
      getIRMTargetUtilizationWithFallback(
        market.irmAddress ? (market.irmAddress as Address) : null
      ),
      getOraclePriceSnapshot({
        oracleAddress: market.oracleAddress,
        feedHints: undefined,
        loanDecimals,
        collateralDecimals,
        spotCollateralUsd,
        spotLoanUsd,
        chainId,
      }),
    ]);
    // The snapshot already read the active source's feeds; reuse them.
    const oracleData =
      priceSnapshot && priceSnapshot.kind !== 'error'
        ? oracleTimestampFromFeeds(priceSnapshot.feeds)
        : await getOracleTimestampData(oracleAddr, undefined);
    oracleTimestampData = oracleData;
    oraclePrice = priceSnapshot;
    targetUtilization = targetUtil;
    scores = await computeBlueMarketRiskScores(market, oracleData, targetUtil);
  }

  return {
    ...listItem,
    totalLiquidityUsd,
    collateralAssets: collateralRaw?.toString() ?? null,
    oracleAddress: details.market.oracle_address,
    irmAddress: details.market.irm_address,
    loanDecimals,
    collateralDecimals,
    supplyApy: details.supplyApy,
    borrowApy: details.borrowApy,
    borrowAssetsUsd: toLoanUsd(borrowRaw),
    collateralAssetsUsd,
    // Not in Morpho REST.
    realizedBadDebt: null,
    unrealizedBadDebt: null,
    scores,
    oracleTimestampData,
    oraclePrice,
    spotCollateralUsd,
    spotLoanUsd,
    createdAt: toUnixSeconds(listedRow?.creation_timestamp),
    // Not in Morpho REST (GraphQL indexed Chainlink factory oracles only).
    oracleCreatedAt: null,
    oracleIndexedType: null,
    targetUtilization,
    warnings: [],
  };
}

function toUnixSeconds(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function defaultCuratorMarketChainId(): number {
  return BASE_CHAIN_ID;
}
