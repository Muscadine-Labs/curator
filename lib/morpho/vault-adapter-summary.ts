/**
 * Per-adapter rollups for the vault Overview adapters table (Morpho Curator
 * style): allocation, withdrawable liquidity and allocation-weighted rate.
 * Pure — inputs are the risk route's adapter rows.
 */

export type AdapterMarketInput = {
  allocationUsd: number;
  /** Market `state.liquidityAssetsUsd` (Blue market depth). */
  liquidityUsd: number | null | undefined;
  /** Market supply APY as a fraction (GraphQL). */
  supplyApy: number | null | undefined;
};

export type AdapterSummaryInput = {
  allocationUsd: number;
  markets: ReadonlyArray<AdapterMarketInput>;
  /** Fee-wrapper child vault (MorphoVaultV2Adapter). */
  underlying?: {
    liquidityUsd?: number | null;
    avgNetApy?: number | null;
    netApy?: number | null;
  } | null;
};

export type AdapterSummary = {
  /** Withdrawable now: Σ min(allocation, market liquidity), or min(allocation, child liquidity). */
  liquidityUsd: number | null;
  /** Allocation-weighted supply APY (fraction), or the child vault's net APY. */
  rate: number | null;
  marketsCount: number;
  /** Markets with a non-zero allocation. */
  activeMarketsCount: number;
};

export function summarizeAdapter(adapter: AdapterSummaryInput): AdapterSummary {
  const markets = adapter.markets;
  if (markets.length === 0 && adapter.underlying) {
    const u = adapter.underlying;
    const childLiquidity = u.liquidityUsd ?? null;
    return {
      liquidityUsd:
        childLiquidity != null ? Math.min(adapter.allocationUsd, childLiquidity) : null,
      rate: u.avgNetApy ?? u.netApy ?? null,
      marketsCount: 0,
      activeMarketsCount: 0,
    };
  }

  let liquidity = 0;
  let liquidityKnown = false;
  let weighted = 0;
  let weight = 0;
  let active = 0;
  for (const m of markets) {
    if (m.allocationUsd > 0) active += 1;
    if (m.liquidityUsd != null && Number.isFinite(m.liquidityUsd)) {
      liquidity += Math.min(m.allocationUsd, m.liquidityUsd);
      liquidityKnown = true;
    }
    if (m.supplyApy != null && Number.isFinite(m.supplyApy) && m.allocationUsd > 0) {
      weighted += m.supplyApy * m.allocationUsd;
      weight += m.allocationUsd;
    }
  }
  return {
    liquidityUsd: liquidityKnown ? liquidity : null,
    rate: weight > 0 ? weighted / weight : null,
    marketsCount: markets.length,
    activeMarketsCount: active,
  };
}
