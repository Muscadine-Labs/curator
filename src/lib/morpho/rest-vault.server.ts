import { getAddress, toFunctionSelector, type AbiFunction } from 'viem';
import { vaultV2Abi } from '@/lib/onchain/abis';
import { withServerResponseCache } from '@/lib/api/server-response-cache';
import { API_CACHE_MAX_AGE_MS } from '@/lib/api/response-cache';
import { logger } from '@/lib/utils/logger';
import {
  adapterTypeName,
  allRestCaps,
  getRestVault,
  getRestVaultAllocations,
  getRestVaultApy,
  getRestVaultRoleAddresses,
  getRestVaultState,
  getRestWithdrawalOptions,
  managementFeePerYear,
  rawToNumber,
  toBigInt,
  tryGetRestTokenPriceUsd,
  wadToFraction,
  type RestAllocations,
  type RestCap,
  type RestToken,
  type RestVault,
  type RestVaultState,
  type RestWithdrawalOptions,
} from '@/lib/morpho/rest-data';
import { loadMarketCollateralAssets, loadMarketDetails, type MarketDetails } from '@/lib/morpho/rest-markets';
import type { GraphCap } from '@/lib/morpho/vault-v2-governance-map';

/**
 * One Vault V2, read from Morpho REST and shaped like the GraphQL objects the vault routes
 * used to map (`vaultV2ByAddress` adapters, caps, liquidity data, timelocks), so the routes
 * keep their mapping code. Shared by the detail, governance and risk routes and cached 30s
 * per vault (`withServerResponseCache`), so one page load reads Morpho once.
 *
 * What REST does not have is computed: instant net APY (market rates, net of fees), USD
 * (spot price × amount). See `docs/morpho-rest-migration.md`.
 */

export type SnapshotAdapter = {
  __typename: string | null;
  address: string;
  type: string | null;
  assets: string;
  assetsUsd: number | null;
  /** WAD fraction, from REST `/withdrawal-options`; null when that read failed. */
  forceDeallocatePenalty: string | null;
  innerVault: { address: string; name: string | null; symbol: string | null } | null;
};

export type SnapshotLiquidityData =
  | {
      __typename: 'MarketV1LiquidityData';
      market: {
        marketId: string;
        loanAsset: { address: string; symbol: string | null };
        collateralAsset: { address: string; symbol: string | null };
        oracle: { address: string | null };
        irmAddress: string | null;
        lltv: string | null;
      };
    }
  | null;

export type RestVaultSnapshot = {
  address: string;
  chainId: number;
  vault: RestVault;
  state: RestVaultState;
  allocations: RestAllocations;
  withdrawal: RestWithdrawalOptions | null;
  sentinels: string[];
  allocators: string[];
  /** Spot USD price of the vault asset; null when Morpho has none. */
  priceUsd: number | null;
  /** Every listed market cap's market (params, tokens, state, rates), by lowercase id. */
  markets: Map<string, MarketDetails>;
  /** The vault's live supply per market (interest included), by lowercase market id. */
  suppliedByMarket: Map<string, bigint>;
  caps: GraphCap[];
  adapters: SnapshotAdapter[];
  liquidityAdapter: SnapshotAdapter | null;
  liquidityData: SnapshotLiquidityData;
  timelocks: Array<{ selector: string; functionName: string; duration: number; abdicatedAt: number | null }>;
  totalAssets: string;
  totalAssetsUsd: number | null;
  totalSupply: string;
  idleAssets: string;
  idleAssetsUsd: number | null;
  liquidity: string;
  liquidityUsd: number | null;
  /** Fractions (0.1 = 10%); management fee per year. */
  performanceFee: number;
  managementFee: number;
  /** Instant APY before / after fees (decimals), rewards excluded. */
  grossApy: number | null;
  netApy: number | null;
};

const SELECTOR_BY_NAME = new Map<string, string>(
  (vaultV2Abi as readonly unknown[])
    .filter((item): item is AbiFunction => (item as { type?: string }).type === 'function')
    .map((fn) => [fn.name, toFunctionSelector(fn)])
);

/** keccak256 of empty bytes: what REST sends as `liquidity_data` when nothing is set. */
const EMPTY_BYTES_HASH = '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470';

function isListedCap(cap: RestCap): boolean {
  return toBigInt(cap.absolute_cap) > BigInt(0) || toBigInt(cap.allocated_assets) > BigInt(0);
}

function capSuppliedRaw(cap: RestCap): bigint {
  const live = toBigInt(cap.expected_supply_assets);
  return live > BigInt(0) ? live : toBigInt(cap.allocated_assets);
}

const GRAPH_CAP_TYPE: Record<string, string> = { market_v1: 'MarketV1', collateral: 'Collateral', adapter: 'Adapter' };

function tokenRef(token: RestToken | null, address: string | null) {
  return { address: address ?? '', symbol: token?.symbol ?? null, decimals: token?.decimals ?? null };
}

/**
 * Instant gross APY like Morpho's `netApy` before fees: each funded market's current supply
 * APY weighted by the vault's supply there, over total assets (idle earns nothing). `null`
 * when a funded market's APY is unknown.
 */
function instantGrossApy(
  supplied: ReadonlyMap<string, bigint>,
  markets: ReadonlyMap<string, MarketDetails>,
  totalAssets: bigint
): number | null {
  if (totalAssets <= BigInt(0)) return null;
  let weighted = 0;
  for (const [id, amount] of supplied) {
    if (amount <= BigInt(0)) continue;
    const apy = markets.get(id)?.supplyApy;
    if (apy === null || apy === undefined) return null;
    weighted += Number(amount) * apy;
  }
  const apy = weighted / Number(totalAssets);
  return Number.isFinite(apy) ? apy : null;
}

async function loadSnapshot(chainId: number, address: string): Promise<RestVaultSnapshot> {
  const [vault, state, allocations, sentinels, allocators, withdrawal] = await Promise.all([
    getRestVault(chainId, address),
    getRestVaultState(chainId, address),
    getRestVaultAllocations(chainId, address),
    getRestVaultRoleAddresses(chainId, address, 'sentinels'),
    getRestVaultRoleAddresses(chainId, address, 'allocators'),
    getRestWithdrawalOptions(chainId, address).catch((error: unknown) => {
      logger.warn('Morpho REST withdrawal options failed; force penalties unknown', {
        address,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }),
  ]);
  const decimals = vault.asset.decimals;
  const priceUsd = await tryGetRestTokenPriceUsd(chainId, vault.asset.address);
  const usd = (raw: string | bigint) => (priceUsd === null ? null : rawToNumber(raw, decimals) * priceUsd);

  // A cap at 0 that holds nothing is a removed market or token (GraphQL left those out too).
  const caps = allRestCaps(allocations).filter(isListedCap);
  const suppliedByMarket = new Map<string, bigint>();
  for (const cap of caps) {
    if (cap.cap_type !== 'market_v1' || !cap.market_id) continue;
    const id = cap.market_id.toLowerCase();
    suppliedByMarket.set(id, (suppliedByMarket.get(id) ?? BigInt(0)) + capSuppliedRaw(cap));
  }
  // REST `liquidity_data` is the route market's id. With no liquidity adapter it is
  // keccak256 of empty bytes (no market), which must not be looked up.
  const routeMarket =
    vault.liquidity_adapter &&
    vault.liquidity_data &&
    vault.liquidity_data.length === 66 &&
    vault.liquidity_data.toLowerCase() !== EMPTY_BYTES_HASH
      ? vault.liquidity_data.toLowerCase()
      : null;
  const marketIds = [...new Set([...suppliedByMarket.keys(), ...(routeMarket ? [routeMarket] : [])])];
  const marketList = await loadMarketDetails(chainId, marketIds);
  const markets = new Map(marketList.map((m) => [m.marketId, m]));

  // GraphQL-shaped caps (mapCap reads them).
  const seen = new Set<string>();
  const graphCaps: GraphCap[] = [];
  for (const cap of caps) {
    const key = `${cap.cap_type}:${(cap.cap_id ?? cap.market_id ?? cap.collateral_address ?? cap.adapter_address ?? '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const base = {
      type: GRAPH_CAP_TYPE[cap.cap_type ?? ''] ?? cap.cap_type ?? 'Unknown',
      absoluteCap: cap.absolute_cap ?? '0',
      relativeCap: cap.relative_cap_wad ?? '0',
      allocation: cap.allocated_assets ?? '0',
    };
    if (cap.cap_type === 'market_v1' && cap.market_id) {
      const m = markets.get(cap.market_id.toLowerCase());
      const liquidityAssets = m
        ? (() => {
            const cash = toBigInt(m.state.total_supply_assets) - toBigInt(m.state.total_borrow_assets);
            return cash > BigInt(0) ? cash : BigInt(0);
          })()
        : null;
      graphCaps.push({
        ...base,
        data: {
          __typename: 'MarketV1CapData',
          adapterAddress: cap.adapter_address ?? null,
          market: {
            marketId: cap.market_id,
            loanAsset: m ? tokenRef(m.loanToken, m.market.loan_token) : null,
            collateralAsset: m ? tokenRef(m.collateralToken, m.market.collateral_token) : null,
            oracle: { address: m?.market.oracle_address ?? null },
            irmAddress: m?.market.irm_address ?? null,
            lltv: m?.market.lltv_wad ?? null,
            state: m
              ? {
                  supplyApy: m.supplyApy,
                  borrowApy: m.borrowApy,
                  utilization: m.utilization,
                  liquidityAssets: liquidityAssets?.toString() ?? null,
                  liquidityAssetsUsd: liquidityAssets === null ? null : usd(liquidityAssets),
                }
              : null,
          },
        },
      });
    } else if (cap.cap_type === 'collateral' && cap.collateral_address) {
      graphCaps.push({ ...base, data: { __typename: 'CollateralCapData', collateralAddress: getAddress(cap.collateral_address) } });
    } else if (cap.cap_type === 'adapter' && cap.adapter_address) {
      graphCaps.push({ ...base, data: { __typename: 'AdapterCapData', adapterAddress: cap.adapter_address } });
    }
  }

  // Adapters: live assets from the adapter cap (vault adapters) or the sum of its markets.
  const penaltyByAdapter = new Map(
    (withdrawal?.adapter_penalties ?? [])
      .filter((p): p is NonNullable<typeof p> => !!p?.adapter_address)
      .map((p) => [p.adapter_address!.toLowerCase(), p.penalty_rate_wad ?? null])
  );
  const adapters: SnapshotAdapter[] = await Promise.all(
    (allocations.allocations ?? [])
      .filter((a): a is NonNullable<typeof a> & { adapter_address: string } => !!a?.adapter_address)
      .map(async (a) => {
        const adapterCap = (a.caps ?? []).find((c) => c.cap_type === 'adapter');
        const marketSum = (a.caps ?? [])
          .filter((c) => c.cap_type === 'market_v1')
          .reduce((sum, c) => sum + capSuppliedRaw(c), BigInt(0));
        const assets = toBigInt(adapterCap?.real_assets) > BigInt(0) ? toBigInt(adapterCap?.real_assets) : marketSum > BigInt(0) ? marketSum : toBigInt(adapterCap?.allocated_assets);
        const typeName = adapterTypeName(a.adapter_kind);
        const innerAddress = a.target?.vault_address ?? null;
        let innerVault: SnapshotAdapter['innerVault'] = null;
        if (typeName === 'MorphoVaultV2Adapter' && innerAddress) {
          const child = await getRestVault(chainId, innerAddress).catch(() => null);
          innerVault = { address: innerAddress, name: child?.name ?? null, symbol: child?.symbol ?? null };
        }
        return {
          __typename: typeName,
          address: a.adapter_address,
          type: typeName === 'MorphoMarketV1Adapter' ? 'MorphoMarketV1' : typeName === 'MorphoVaultV2Adapter' ? 'MorphoVaultV2' : a.adapter_kind ?? null,
          assets: assets.toString(),
          assetsUsd: usd(assets),
          forceDeallocatePenalty: penaltyByAdapter.get(a.adapter_address.toLowerCase()) ?? null,
          innerVault,
        };
      })
  );
  const liquidityAdapter =
    adapters.find((a) => a.address.toLowerCase() === vault.liquidity_adapter?.toLowerCase()) ?? null;

  const route = routeMarket ? markets.get(routeMarket) : undefined;
  const liquidityData: SnapshotLiquidityData = route
    ? {
        __typename: 'MarketV1LiquidityData',
        market: {
          marketId: route.marketId,
          loanAsset: { address: route.market.loan_token, symbol: route.loanToken.symbol },
          collateralAsset: { address: route.market.collateral_token ?? '', symbol: route.collateralToken?.symbol ?? null },
          oracle: { address: route.market.oracle_address },
          irmAddress: route.market.irm_address,
          lltv: route.market.lltv_wad,
        },
      }
    : null;

  const timelocks = (vault.governance?.timelocks ?? [])
    .filter((t) => !!t?.function_name)
    .map((t) => ({
      selector: SELECTOR_BY_NAME.get(t.function_name) ?? '',
      functionName: t.function_name,
      duration: Number(t.timelock_seconds ?? 0),
      abdicatedAt: t.is_abdicated ? Number((t as { abdicated_at_timestamp?: number | null }).abdicated_at_timestamp ?? 1) : null,
    }));

  const totalAssets = toBigInt(state.total_assets);
  const performanceFee = wadToFraction(vault.performance_fee_wad) ?? 0;
  const managementFee = managementFeePerYear(vault.management_fee_wad);
  const gross = instantGrossApy(suppliedByMarket, markets, totalAssets);
  let netApy = gross === null ? null : gross * (1 - performanceFee) - managementFee;
  if (netApy === null) {
    netApy = await getRestVaultApy(chainId, address, 'six_hours').catch(() => null);
  }
  const grossApy =
    gross ?? (netApy !== null && performanceFee < 1 ? (netApy + managementFee) / (1 - performanceFee) : null);

  return {
    address,
    chainId,
    vault,
    state,
    allocations,
    withdrawal,
    sentinels,
    allocators,
    priceUsd,
    markets,
    suppliedByMarket,
    caps: graphCaps,
    adapters,
    liquidityAdapter,
    liquidityData,
    timelocks,
    totalAssets: totalAssets.toString(),
    totalAssetsUsd: usd(totalAssets),
    totalSupply: toBigInt(state.total_supply).toString(),
    idleAssets: toBigInt(state.idle_assets).toString(),
    idleAssetsUsd: usd(toBigInt(state.idle_assets)),
    liquidity: toBigInt(state.withdrawable_assets).toString(),
    liquidityUsd: usd(toBigInt(state.withdrawable_assets)),
    performanceFee,
    managementFee,
    grossApy,
    netApy,
  };
}

/** The vault snapshot, cached 30s per vault and shared across routes. Throws on a failed read. */
export function loadRestVaultSnapshot(chainId: number, vaultAddress: string): Promise<RestVaultSnapshot> {
  const address = getAddress(vaultAddress);
  return withServerResponseCache(`rest-vault-snapshot:${chainId}:${address.toLowerCase()}`, API_CACHE_MAX_AGE_MS, () =>
    loadSnapshot(chainId, address)
  );
}


export type SnapshotRiskPosition = {
  state: { supplyAssets: string; supplyAssetsUsd: number | null };
  market: {
    id: string;
    marketId: string;
    loanAsset: { address: string; symbol: string; decimals: number };
    collateralAsset: { address: string; symbol: string; decimals: number };
    oracleAddress: string | null;
    oracle: { address: string | null; data: null };
    irmAddress: string | null;
    lltv: string | null;
    /** Not in Morpho REST; the bad-debt F override cannot fire. */
    realizedBadDebt: null;
    state: {
      supplyAssetsUsd: number | null;
      borrowAssetsUsd: number | null;
      /** `null` = unknown (REST has no collateral total yet), never 0. */
      collateralAssetsUsd: number | null;
      liquidityAssets: string;
      liquidityAssetsUsd: number | null;
      utilization: number;
      supplyApy: number | null;
      borrowApy: number | null;
    };
  };
};

/**
 * The vault's funded Blue markets per market adapter, shaped like GraphQL
 * `MorphoMarketV1Adapter.positions` for the risk route. Collateral USD comes from
 * `loadMarketCollateralAssets` × the collateral's spot price, or stays null.
 */
export async function loadRiskPositions(snap: RestVaultSnapshot): Promise<Map<string, SnapshotRiskPosition[]>> {
  const loanPrice = snap.priceUsd;
  const byAdapter = new Map<string, SnapshotRiskPosition[]>();
  const tasks: Array<Promise<void>> = [];
  const seen = new Set<string>();
  for (const a of snap.allocations.allocations ?? []) {
    if (!a?.adapter_address) continue;
    const adapterKey = a.adapter_address.toLowerCase();
    for (const cap of a.caps ?? []) {
      if (cap.cap_type !== 'market_v1' || !cap.market_id) continue;
      const id = cap.market_id.toLowerCase();
      const supplied = capSuppliedRaw(cap);
      const m = snap.markets.get(id);
      if (!m || supplied <= BigInt(0) || seen.has(`${adapterKey}:${id}`)) continue;
      seen.add(`${adapterKey}:${id}`);
      tasks.push(
        (async () => {
          const loanDecimals = m.loanToken.decimals;
          const collateralDecimals = m.collateralToken?.decimals ?? 18;
          const [collateralRaw, collateralPrice] = await Promise.all([
            loadMarketCollateralAssets(snap.chainId, id),
            m.market.collateral_token ? tryGetRestTokenPriceUsd(snap.chainId, m.market.collateral_token) : Promise.resolve(null),
          ]);
          const toLoanUsd = (raw: bigint) => (loanPrice === null ? null : rawToNumber(raw, loanDecimals) * loanPrice);
          const supply = toBigInt(m.state.total_supply_assets);
          const borrow = toBigInt(m.state.total_borrow_assets);
          const cash = supply > borrow ? supply - borrow : BigInt(0);
          const position: SnapshotRiskPosition = {
            state: { supplyAssets: supplied.toString(), supplyAssetsUsd: toLoanUsd(supplied) },
            market: {
              id: m.marketId,
              marketId: m.marketId,
              loanAsset: { address: m.market.loan_token, symbol: m.loanToken.symbol ?? 'Unknown', decimals: loanDecimals },
              collateralAsset: {
                address: m.market.collateral_token ?? '',
                symbol: m.collateralToken?.symbol ?? 'Unknown',
                decimals: collateralDecimals,
              },
              oracleAddress: m.market.oracle_address,
              oracle: { address: m.market.oracle_address, data: null },
              irmAddress: m.market.irm_address,
              lltv: m.market.lltv_wad,
              realizedBadDebt: null,
              state: {
                supplyAssetsUsd: toLoanUsd(supply),
                borrowAssetsUsd: toLoanUsd(borrow),
                collateralAssetsUsd:
                  collateralRaw === null || collateralPrice === null
                    ? null
                    : rawToNumber(collateralRaw, collateralDecimals) * collateralPrice,
                liquidityAssets: cash.toString(),
                liquidityAssetsUsd: toLoanUsd(cash),
                utilization: m.utilization,
                supplyApy: m.supplyApy,
                borrowApy: m.borrowApy,
              },
            },
          };
          byAdapter.set(adapterKey, [...(byAdapter.get(adapterKey) ?? []), position]);
        })()
      );
    }
  }
  await Promise.all(tasks);
  return byAdapter;
}
