import { morphoRestGet, morphoSelector } from '@/lib/morpho/rest-client';
import {
  getRestMarket,
  getRestMarketState,
  getRestToken,
  marketRates,
  type MarketRates,
  tryGetRestTokenPriceUsd,
  type RestMarket,
  type RestMarketState,
  type RestToken,
} from '@/lib/morpho/rest-data';

export type MarketDetails = {
  marketId: string;
  market: RestMarket;
  state: RestMarketState;
  loanToken: RestToken;
  collateralToken: RestToken | null;
  /** Current supply APY (decimal); `null` when unknown. */
  supplyApy: number | null;
  /** Current borrow APY (decimal); `null` when unknown. */
  borrowApy: number | null;
  /** Borrow / supply (0–1). */
  utilization: number;
};

function utilizationOf(state: RestMarketState): number {
  const supply = Number(state.total_supply_assets);
  const borrow = Number(state.total_borrow_assets);
  return supply > 0 && Number.isFinite(borrow) ? Math.min(1, Math.max(0, borrow / supply)) : 0;
}

async function shortestApyAverages(chainId: number, marketId: string): Promise<Pick<MarketRates, 'supplyApy' | 'borrowApy'> | null> {
  try {
    const data = await morphoRestGet<{
      supply_apy_averages?: Record<string, number | null> | null;
      borrow_apy_averages?: Record<string, number | null> | null;
    }>(`/v0/blue/markets/${morphoSelector(chainId, marketId)}/apy-averages`);
    const supply = data.supply_apy_averages?.['6h'];
    const borrow = data.borrow_apy_averages?.['6h'];
    return typeof supply === 'number' && typeof borrow === 'number' ? { supplyApy: supply, borrowApy: borrow } : null;
  } catch {
    return null;
  }
}

/**
 * Params, tokens and state of each Blue market (cached: params and tokens for an hour, state
 * for 60s). Rates are computed from the state for Adaptive Curve markets, else Morpho's
 * 6h averages. Throws when a market or its state fails to load, so a table is never short.
 */
/** Parallel market reads at a time: the browser loads ~100 markets per refresh. */
const MARKET_CONCURRENCY = 10;

async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function loadMarketDetails(
  chainId: number,
  marketIds: readonly string[],
  /** Market params the caller already has (e.g. from `/v0/blue/markets`), by lowercase id. */
  knownParams?: ReadonlyMap<string, RestMarket>
): Promise<MarketDetails[]> {
  return mapWithConcurrency(marketIds, MARKET_CONCURRENCY, async (marketId) => {
      const known = knownParams?.get(marketId.toLowerCase());
      const [market, state] = await Promise.all([
        known ? Promise.resolve(known) : getRestMarket(chainId, marketId),
        getRestMarketState(chainId, marketId),
      ]);
      const [loanToken, collateralToken] = await Promise.all([
        getRestToken(chainId, market.loan_token),
        market.collateral_token ? getRestToken(chainId, market.collateral_token).catch(() => null) : null,
      ]);
      const rates = marketRates(market, state) ?? (await shortestApyAverages(chainId, marketId));
      return {
        marketId: marketId.toLowerCase(),
        market,
        state,
        loanToken,
        collateralToken,
        supplyApy: rates?.supplyApy ?? null,
        borrowApy: rates?.borrowApy ?? null,
        utilization: utilizationOf(state),
      };
  });
}

/** Spot USD price per token (lowercase address); a token with no price is left out. */
export async function loadPrices(chainId: number, tokens: readonly string[]): Promise<Map<string, number>> {
  const unique = [...new Set(tokens.map((t) => t.toLowerCase()))];
  const prices = await Promise.all(unique.map((t) => tryGetRestTokenPriceUsd(chainId, t)));
  const out = new Map<string, number>();
  unique.forEach((token, i) => {
    const price = prices[i];
    if (price !== null && price !== undefined) out.set(token, price);
  });
  return out;
}

/**
 * Total collateral of a Blue market (raw collateral units): `total_collateral_assets` on the
 * newest point of Morpho REST `state/history` (hourly `one_day` lookback). The spot `/state`
 * route does not carry it. Matched GraphQL `state.collateralAssets` exactly (2026-11-25).
 * `null` on a failed read (unknown, never 0): risk scoring then leaves headroom and coverage out.
 */
export async function loadMarketCollateralAssets(chainId: number, marketId: string): Promise<bigint | null> {
  try {
    const points = await morphoRestGet<Array<{ timestamp: number; total_collateral_assets?: string | null }>>(
      `/v0/blue/markets/${morphoSelector(chainId, marketId)}/state/history`,
      { lookback: 'one_day' }
    );
    const latest = [...(points ?? [])]
      .filter((p) => p.total_collateral_assets != null)
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    return latest ? BigInt(latest.total_collateral_assets!) : null;
  } catch {
    return null;
  }
}
