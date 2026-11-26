import { morphoRestGet, morphoRestList, morphoSelector } from '@/lib/morpho/rest-client';
import { API_CACHE_MAX_AGE_SECONDS } from '@/lib/api/response-cache';

/** Typed Morpho REST reads shared by the API routes, each cached for how often it changes. */

export const SECONDS_PER_YEAR = 31_536_000;
const WAD = 1e18;

/** Vault config: curator caps every cache at 30s (roles and fees change right after a tx). */
const VAULT_CONFIG_REVALIDATE = API_CACHE_MAX_AGE_SECONDS;
/** Token metadata and market params never change. */
const STATIC_REVALIDATE = 3600;

export type RestVault = {
  address: string;
  name: string | null;
  symbol: string | null;
  asset: { address: string; decimals: number; name: string | null; symbol: string | null };
  owner: string | null;
  curator: string | null;
  governance?: {
    timelocks?: Array<{
      function_name: string;
      timelock_seconds: string | number | null;
      is_abdicated: boolean | null;
    }> | null;
  } | null;
  management_fee_wad: string | null;
  management_fee_recipient?: string | null;
  performance_fee_wad: string | null;
  performance_fee_recipient?: string | null;
  gates?: {
    send_shares?: string | null;
    receive_shares?: string | null;
    send_assets?: string | null;
    receive_assets?: string | null;
  } | null;
  max_rate_per_second_wad: string | null;
  liquidity_adapter: string | null;
  liquidity_data: string | null;
};

export type RestVaultState = {
  total_assets: string;
  total_supply: string;
  withdrawable_assets: string;
  idle_assets: string;
  share_price_ray: string;
};

export type RestCap = {
  cap_id?: string | null;
  cap_type?: string | null;
  absolute_cap?: string | null;
  relative_cap_wad?: string | null;
  allocated_assets?: string | null;
  /** Market caps: the adapter's live supply in that market (interest included). */
  expected_supply_assets?: string | null;
  /** Adapter caps: the adapter's live assets. */
  real_assets?: string | null;
  market_id?: string | null;
  collateral_address?: string | null;
};

export type RestAllocations = {
  allocations?: Array<{
    adapter_address?: string | null;
    adapter_kind?: string | null;
    target?: { type?: string | null; vault_address?: string | null; address?: string | null } | null;
    caps?: RestCap[] | null;
  } | null> | null;
  unscoped_caps?: RestCap[] | null;
};

export type RestToken = {
  address: string;
  decimals: number;
  symbol: string | null;
  name: string | null;
  logo_uri: string | null;
};

export type RestMarket = {
  market_id: string;
  loan_token: string;
  collateral_token: string | null;
  oracle_address: string | null;
  irm_address: string | null;
  lltv_wad: string | null;
};

export type RestMarketState = {
  last_accrual_timestamp: number;
  total_supply_assets: string;
  total_borrow_assets: string;
  fee_wad: string | null;
  rate_at_target_per_second_wad: string | null;
};

export type RestVaultApyLookback = 'one_hour' | 'six_hours' | 'one_day' | 'seven_days' | 'thirty_days';

const vaultPath = (chainId: number, vault: string) =>
  `/v0/vaults-v2/${morphoSelector(chainId, vault)}`;

export function getRestVault(chainId: number, vault: string): Promise<RestVault> {
  return morphoRestGet<RestVault>(vaultPath(chainId, vault), undefined, {
    revalidate: VAULT_CONFIG_REVALIDATE,
  });
}

export function getRestVaultState(chainId: number, vault: string): Promise<RestVaultState> {
  return morphoRestGet<RestVaultState>(`/v1/vaults-v2/${morphoSelector(chainId, vault)}/state`);
}

export function getRestVaultAllocations(chainId: number, vault: string): Promise<RestAllocations> {
  return morphoRestGet<RestAllocations>(`${vaultPath(chainId, vault)}/allocations`);
}

/** Net APY averaged over `lookback` (Morpho has no instant vault APY; rewards excluded). */
export async function getRestVaultApy(
  chainId: number,
  vault: string,
  lookback: RestVaultApyLookback
): Promise<number | null> {
  const data = await morphoRestGet<{ apy: number | null }>(
    `/v1/vaults-v2/${morphoSelector(chainId, vault)}/apy-averages`,
    { lookback }
  );
  return typeof data.apy === 'number' && Number.isFinite(data.apy) ? data.apy : null;
}

export async function getRestVaultRoleAddresses(
  chainId: number,
  vault: string,
  role: 'sentinels' | 'allocators'
): Promise<string[]> {
  const rows = await morphoRestList<{ role_address?: string | null }>(
    `${vaultPath(chainId, vault)}/${role}`,
    {},
    { revalidate: VAULT_CONFIG_REVALIDATE }
  );
  return rows.map((row) => row.role_address).filter((a): a is string => !!a);
}

export type RestWithdrawalOptions = {
  idle_assets?: string | null;
  liquidity_adapter_available_assets?: string | null;
  adapter_penalties?: Array<{
    adapter_address?: string | null;
    adapter_kind?: string | null;
    force_deallocatable_assets?: string | null;
    /** Force-deallocation penalty (WAD fraction). */
    penalty_rate_wad?: string | null;
  } | null> | null;
};

/** Per-adapter force-deallocation penalty and deallocatable assets (GraphQL had both on adapters). */
export function getRestWithdrawalOptions(chainId: number, vault: string): Promise<RestWithdrawalOptions> {
  return morphoRestGet<RestWithdrawalOptions>(`${vaultPath(chainId, vault)}/withdrawal-options`);
}

export function getRestToken(chainId: number, token: string): Promise<RestToken> {
  return morphoRestGet<RestToken>(`/v0/tokens/${morphoSelector(chainId, token)}`, undefined, {
    revalidate: STATIC_REVALIDATE,
  });
}

/** Spot USD price (Morpho's provider, e.g. DefiLlama). `null` when Morpho has none. */
export async function getRestTokenPriceUsd(chainId: number, token: string): Promise<number | null> {
  const data = await morphoRestGet<{ price: number | null }>(
    `/v0/tokens/${morphoSelector(chainId, token)}/price`
  );
  return typeof data.price === 'number' && Number.isFinite(data.price) && data.price > 0
    ? data.price
    : null;
}

/** Spot price, or `null` on a failed read too (callers fall back like a missing price). */
export async function tryGetRestTokenPriceUsd(chainId: number, token: string): Promise<number | null> {
  try {
    return await getRestTokenPriceUsd(chainId, token);
  } catch {
    return null;
  }
}

export function getRestMarket(chainId: number, marketId: string): Promise<RestMarket> {
  return morphoRestGet<RestMarket>(`/v0/blue/markets/${morphoSelector(chainId, marketId)}`, undefined, {
    revalidate: STATIC_REVALIDATE,
  });
}

export function getRestMarketState(chainId: number, marketId: string): Promise<RestMarketState> {
  return morphoRestGet<RestMarketState>(`/v0/blue/markets/${morphoSelector(chainId, marketId)}/state`);
}

export function toBigInt(value: string | number | null | undefined): bigint {
  if (value === null || value === undefined || value === '') return BigInt(0);
  try {
    return BigInt(typeof value === 'number' ? Math.trunc(value) : value.split('.')[0]!);
  } catch {
    return BigInt(0);
  }
}

/** Raw base units → decimal number (display / USD math only). */
export function rawToNumber(raw: string | bigint | null | undefined, decimals: number): number {
  const value = typeof raw === 'bigint' ? raw : toBigInt(raw);
  return Number(value) / 10 ** decimals;
}

/** WAD fraction (1e18 = 100%) → fraction, `null` stays `null`. */
export function wadToFraction(wad: string | null | undefined): number | null {
  if (wad === null || wad === undefined) return null;
  const n = Number(wad) / WAD;
  return Number.isFinite(n) ? n : null;
}

/** REST `management_fee_wad` is per second; the UI shows a yearly fraction. */
export function managementFeePerYear(perSecondWad: string | null | undefined): number {
  return (wadToFraction(perSecondWad) ?? 0) * SECONDS_PER_YEAR;
}

/** Morpho Blue's Adaptive Curve IRM on Base. */
export const ADAPTIVE_CURVE_IRM = '0x46415998764c29ab2a25cbea6254146d50d22687';
const CURVE_STEEPNESS = 4;
const TARGET_UTILIZATION = 0.9;

export type MarketRates = { utilization: number; borrowApy: number; supplyApy: number };

/**
 * Adaptive Curve IRM borrow rate (per second) at a utilization, given the rate at target:
 * rateAtTarget × curve(err), where err is the normalized distance from 90% utilization.
 */
export function adaptiveCurveBorrowRate(utilization: number, rateAtTargetPerSecond: number): number {
  const errNorm = utilization > TARGET_UTILIZATION ? 1 - TARGET_UTILIZATION : TARGET_UTILIZATION;
  const err = (utilization - TARGET_UTILIZATION) / errNorm;
  const coeff = err < 0 ? 1 - 1 / CURVE_STEEPNESS : CURVE_STEEPNESS - 1;
  return rateAtTargetPerSecond * (coeff * err + 1);
}

/**
 * Current rates of a Blue market from its indexed state: Morpho's Adaptive Curve IRM at the
 * current utilization with the rate at target stored at the last accrual (what Morpho's GraphQL
 * `supplyApy` / `borrowApy` and app show; adapting it for the time since then overstates a
 * market that has not accrued in days). Supply APY = borrow APY × utilization × (1 − fee).
 * REST only has window averages for markets, so this keeps instant rates.
 * Returns `null` for any other IRM or missing data (callers then use a REST average).
 */
export function marketRates(
  market: Pick<RestMarket, 'irm_address'>,
  state: RestMarketState
): MarketRates | null {
  if (market.irm_address?.toLowerCase() !== ADAPTIVE_CURVE_IRM) return null;
  const supply = Number(state.total_supply_assets);
  const borrow = Number(state.total_borrow_assets);
  const rateAtTarget = Number(state.rate_at_target_per_second_wad) / WAD;
  if (!Number.isFinite(supply) || !Number.isFinite(borrow) || !Number.isFinite(rateAtTarget)) return null;
  if (supply <= 0 || borrow <= 0 || rateAtTarget <= 0) {
    return { utilization: supply > 0 ? Math.min(1, Math.max(0, borrow / supply)) : 0, borrowApy: 0, supplyApy: 0 };
  }

  const utilization = Math.min(1, borrow / supply);
  const borrowRate = adaptiveCurveBorrowRate(utilization, rateAtTarget);
  const borrowApy = Math.expm1(borrowRate * SECONDS_PER_YEAR);
  const fee = wadToFraction(state.fee_wad) ?? 0;
  const supplyApy = borrowApy * utilization * (1 - fee);
  return Number.isFinite(supplyApy) && Number.isFinite(borrowApy) ? { utilization, borrowApy, supplyApy } : null;
}

/** Current supply APY (see `marketRates`). */
export function marketSupplyApy(market: Pick<RestMarket, 'irm_address'>, state: RestMarketState): number | null {
  return marketRates(market, state)?.supplyApy ?? null;
}

/** Every cap of a vault (adapter-scoped and unscoped), from `/allocations`. */
export function allRestCaps(allocations: RestAllocations): Array<RestCap & { adapter_address?: string | null; adapter_kind?: string | null }> {
  return [
    ...(allocations.unscoped_caps ?? []),
    ...(allocations.allocations ?? []).flatMap((a) =>
      (a?.caps ?? []).map((cap) => ({ ...cap, adapter_address: a?.adapter_address, adapter_kind: a?.adapter_kind }))
    ),
  ];
}

/** REST adapter kind → the adapter type name the UI labels (GraphQL `__typename`). */
export function adapterTypeName(kind: string | null | undefined): string | null {
  if (!kind) return null;
  if (kind.startsWith('morpho_market_v1')) return 'MorphoMarketV1Adapter';
  if (kind.startsWith('morpho_vault_v2')) return 'MorphoVaultV2Adapter';
  if (kind.startsWith('morpho_vault_v1') || kind.startsWith('meta_morpho')) return 'MetaMorphoAdapter';
  return kind;
}
