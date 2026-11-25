import { morphoRestGet, morphoRestList, morphoSelector } from '@/lib/morpho/rest-client';
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
export async function loadMarketDetails(chainId: number, marketIds: readonly string[]): Promise<MarketDetails[]> {
  return Promise.all(
    marketIds.map(async (marketId) => {
      const [market, state] = await Promise.all([
        getRestMarket(chainId, marketId),
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
    })
  );
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
 * Total borrower collateral of a Blue market (raw collateral units), summed from Morpho REST
 * `/positions/health`. That route is in Morpho's spec but returned 404 on 2026-11-25; until it
 * ships this returns `null` (unknown, never 0), and risk scoring leaves headroom and coverage
 * out instead of grading them 0.
 */
export async function loadMarketCollateralAssets(chainId: number, marketId: string): Promise<bigint | null> {
  try {
    const rows = await morphoRestList<{ collateral_assets?: string | null }>(
      `/v0/blue/markets/${morphoSelector(chainId, marketId)}/positions/health`,
      { limit: 1000 }
    );
    return rows.reduce((sum, row) => {
      try {
        return sum + BigInt(row.collateral_assets ?? '0');
      } catch {
        return sum;
      }
    }, BigInt(0));
  } catch {
    return null;
  }
}
