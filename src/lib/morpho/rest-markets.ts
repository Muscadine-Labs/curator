import { morphoRestGet, morphoSelector } from '@/lib/morpho/rest-client';
import {
  getRestMarket,
  getRestMarketState,
  getRestToken,
  marketSupplyApy,
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
};

async function shortestSupplyApyAverage(chainId: number, marketId: string): Promise<number | null> {
  try {
    const data = await morphoRestGet<{ supply_apy_averages?: Record<string, number | null> | null }>(
      `/v0/blue/markets/${morphoSelector(chainId, marketId)}/apy-averages`
    );
    const apy = data.supply_apy_averages?.['6h'];
    return typeof apy === 'number' && Number.isFinite(apy) ? apy : null;
  } catch {
    return null;
  }
}

/**
 * Params, tokens and state of each Blue market (cached: params and tokens for an hour, state
 * for 60s). Supply APY is computed from the state for Adaptive Curve markets, else Morpho's
 * 6h average. Throws when a market or its state fails to load, so a table is never short.
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
      const supplyApy =
        marketSupplyApy(market, state) ?? (await shortestSupplyApyAverage(chainId, marketId));
      return { marketId: marketId.toLowerCase(), market, state, loanToken, collateralToken, supplyApy };
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
