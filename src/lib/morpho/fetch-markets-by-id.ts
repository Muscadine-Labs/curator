import type { CapInfo } from '@/app/api/vaults/[id]/governance/route';
import { isCollateralCap, isMarketCap } from '@/lib/morpho/cap-utils';
import { getRestToken, rawToNumber, toBigInt, tryGetRestTokenPriceUsd } from '@/lib/morpho/rest-data';
import { loadMarketCollateralAssets, loadMarketDetails, type MarketDetails } from '@/lib/morpho/rest-markets';
import { logger } from '@/lib/utils/logger';

/**
 * Fill cap labels and market data from Morpho REST, by market id (`/v0/blue/markets/{id}`
 * + `/state`) and token address (`/v0/tokens/{t}`). GraphQL used to load the chain's whole
 * market index for this; REST reads only the markets and tokens the caps name (cached:
 * params and tokens 1h, state 30s).
 */

export type MarketStateSnapshot = {
  supplyApy?: number | null;
  borrowApy?: number | null;
  utilization?: number | null;
  liquidityAssets?: string | number | null;
  liquidityAssetsUsd?: number | null;
  /** Needed to score cap-only markets (no vault position to read them from). */
  supplyAssetsUsd?: number | null;
  borrowAssetsUsd?: number | null;
  /** `null` = unknown (a failed read), never 0. */
  collateralAssetsUsd?: number | null;
};

function stateFromMarket(
  m: MarketDetails,
  loanPrice: number | null,
  collateralUsd: number | null
): MarketStateSnapshot {
  const decimals = m.loanToken.decimals;
  const usd = (raw: bigint) => (loanPrice === null ? null : rawToNumber(raw, decimals) * loanPrice);
  const supply = toBigInt(m.state.total_supply_assets);
  const borrow = toBigInt(m.state.total_borrow_assets);
  const cash = supply > borrow ? supply - borrow : BigInt(0);
  return {
    supplyApy: m.supplyApy,
    borrowApy: m.borrowApy,
    utilization: m.utilization,
    liquidityAssets: cash.toString(),
    liquidityAssetsUsd: usd(cash),
    supplyAssetsUsd: usd(supply),
    borrowAssetsUsd: usd(borrow),
    collateralAssetsUsd: collateralUsd,
  };
}

function hasCompleteMarketParams(params: CapInfo['marketParams']): boolean {
  return Boolean(
    params?.loanAsset?.address &&
      params?.collateralAsset?.address &&
      params?.oracleAddress &&
      params?.irmAddress &&
      params?.lltv
  );
}

/**
 * Fill marketParams and spot state (USD totals included) on market caps. A market that
 * fails to load keeps the cap as it was; the cap list never shrinks.
 */
export async function enrichMarketCapParams(caps: CapInfo[], chainId: number): Promise<CapInfo[]> {
  const ids = [
    ...new Set(
      caps.filter((cap) => isMarketCap(cap) && cap.marketKey).map((cap) => cap.marketKey!.toLowerCase())
    ),
  ];
  if (ids.length === 0) return caps;

  const markets = new Map<string, MarketDetails>();
  await Promise.all(
    ids.map(async (id) => {
      try {
        const [m] = await loadMarketDetails(chainId, [id]);
        if (m) markets.set(id, m);
      } catch (error) {
        logger.warn('Morpho REST market read failed for a cap', {
          marketId: id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })
  );
  const tokens = [
    ...new Set(
      [...markets.values()].flatMap((m) => [m.market.loan_token, m.market.collateral_token ?? ''].filter(Boolean).map((t) => t.toLowerCase()))
    ),
  ];
  const [prices, collateralById] = await Promise.all([
    Promise.all(tokens.map(async (t) => [t, await tryGetRestTokenPriceUsd(chainId, t)] as const)).then((e) => new Map(e)),
    Promise.all([...markets.keys()].map(async (id) => [id, await loadMarketCollateralAssets(chainId, id)] as const)).then(
      (e) => new Map(e)
    ),
  ]);
  const collateralUsdOf = (m: MarketDetails): number | null => {
    const raw = collateralById.get(m.marketId);
    const price = m.market.collateral_token ? prices.get(m.market.collateral_token.toLowerCase()) ?? null : null;
    return raw == null || price == null ? null : rawToNumber(raw, m.collateralToken?.decimals ?? 18) * price;
  };

  return caps.map((cap) => {
    if (!isMarketCap(cap) || !cap.marketKey) return cap;
    const m = markets.get(cap.marketKey.toLowerCase());
    if (!m) return cap;
    const state = stateFromMarket(m, prices.get(m.market.loan_token.toLowerCase()) ?? null, collateralUsdOf(m));
    const existing = cap.marketParams;
    const params = hasCompleteMarketParams(existing)
      ? { ...existing!, state: { ...(existing?.state ?? {}), ...state } }
      : {
          loanAsset: { address: m.market.loan_token, symbol: m.loanToken.symbol, decimals: m.loanToken.decimals },
          collateralAsset: {
            address: m.market.collateral_token ?? '',
            symbol: m.collateralToken?.symbol ?? null,
            decimals: m.collateralToken?.decimals ?? null,
          },
          oracleAddress: m.market.oracle_address,
          irmAddress: m.market.irm_address,
          lltv: m.market.lltv_wad,
          state,
        };
    return { ...cap, marketParams: params };
  });
}

/** Collateral cap labels from Morpho REST token metadata. */
export async function enrichCollateralCapSymbols(caps: CapInfo[], chainId: number): Promise<CapInfo[]> {
  const missing = [
    ...new Set(
      caps
        .filter((cap) => isCollateralCap(cap) && cap.collateralAddress && !cap.collateralSymbol)
        .map((cap) => cap.collateralAddress!.toLowerCase())
    ),
  ];
  if (missing.length === 0) return caps;
  const symbols = new Map<string, string>();
  await Promise.all(
    missing.map(async (address) => {
      const token = await getRestToken(chainId, address).catch(() => null);
      if (token?.symbol) symbols.set(address, token.symbol);
    })
  );
  return caps.map((cap) => {
    if (!isCollateralCap(cap) || !cap.collateralAddress || cap.collateralSymbol) return cap;
    const symbol = symbols.get(cap.collateralAddress.toLowerCase());
    return symbol ? { ...cap, collateralSymbol: symbol } : cap;
  });
}
