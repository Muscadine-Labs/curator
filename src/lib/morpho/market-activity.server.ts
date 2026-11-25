import { withServerResponseCache } from '@/lib/api/server-response-cache';
import { API_CACHE_MAX_AGE_MS } from '@/lib/api/response-cache';
import { getVaultAddressesForProtocolStats } from '@/lib/config/vaults';
import { logger } from '@/lib/utils/logger';
import { MorphoRestError, morphoRestGet, morphoRestList, morphoSelector } from '@/lib/morpho/rest-client';
import {
  getRestMarket,
  getRestMarketState,
  getRestToken,
  adaptiveCurveBorrowRate,
  rawToNumber,
  SECONDS_PER_YEAR,
  toBigInt,
  tryGetRestTokenPriceUsd,
  wadToFraction,
} from '@/lib/morpho/rest-data';
import { loadRestVaultSnapshot } from '@/lib/morpho/rest-vault.server';
import { collateralAtRiskCurve, type CollateralAtRiskPoint } from '@/lib/morpho/market-activity-math';

/**
 * Blue market activity for the market detail page, from Morpho REST: rate history, the IRM
 * curve, and Muscadine vaults supplying the market. Cached ≤30s.
 *
 * REST has no liquidation list, no supplier list and (until `/positions/health` ships) no
 * borrower list; those sections are reported as unavailable (`unavailable`), never as empty.
 * Borrowers and the collateral-at-risk curve come back on their own once that route answers.
 */

const HISTORY_LOOKBACK = 'ninety_days';
/** Utilization steps of 1% from 0% through 100% (101 samples). */
const IRM_POINTS = 100;
const ADAPTIVE_CURVE_TARGET = 0.9;
/** Borrowers read from `/positions/health` (largest first is not guaranteed; the table pages). */
const BORROWER_ROWS = 1000;

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

export type MarketSeriesPoint = { x: number; y: number };

export type MarketActivity = {
  borrowers: MarketBorrowerRow[];
  borrowerCount: number | null;
  suppliers: MarketSupplierRow[];
  supplierCount: number | null;
  liquidations: MarketLiquidationRow[];
  /** Set when a supplier lookup failed: the list may be missing vaults (not cached). */
  warning?: string | null;
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
  /**
   * Sections Morpho REST cannot fill (no paid RPC or indexer is used): `borrowers` and
   * `collateralAtRisk` need REST `/positions/health` (in Morpho's spec, 404 on 2026-11-25),
   * `liquidations` has no REST route, and `suppliers` lists only Muscadine vaults.
   * The UI says so instead of showing an empty table.
   */
  unavailable: { borrowers: boolean; collateralAtRisk: boolean; liquidations: boolean; suppliersMuscadineOnly: boolean };
};

type HistoryPoint = {
  timestamp: number;
  total_supply_assets?: string | null;
  total_supply_shares?: string | null;
  total_borrow_assets?: string | null;
  total_borrow_shares?: string | null;
};

/**
 * Realized APY per day from the growth of assets per share (supply side: what suppliers
 * earned after the fee; borrow side: what borrowers paid). Exact from REST market history;
 * REST `apy/history` points are trailing averages instead.
 */
function realizedSeries(
  points: readonly HistoryPoint[],
  assetsKey: 'total_supply_assets' | 'total_borrow_assets',
  sharesKey: 'total_supply_shares' | 'total_borrow_shares'
): MarketSeriesPoint[] {
  const out: MarketSeriesPoint[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const dt = b.timestamp - a.timestamp;
    const sa = toBigInt(a[sharesKey]);
    const sb = toBigInt(b[sharesKey]);
    const aa = toBigInt(a[assetsKey]);
    const ab = toBigInt(b[assetsKey]);
    if (dt < 3600 || sa <= BigInt(0) || sb <= BigInt(0) || aa <= BigInt(0)) continue;
    // (assets/share at b) / (assets/share at a), in 1e18 fixed point.
    const ratio = Number((ab * sa * BigInt(1e18)) / (sb * aa)) / 1e18;
    const apy = Math.pow(ratio, SECONDS_PER_YEAR / dt) - 1;
    if (Number.isFinite(apy) && apy > -1) out.push({ x: b.timestamp, y: apy });
  }
  return out;
}

export function irmCurveFromRateAtTarget(
  rateAtTargetPerSecondWad: string | null | undefined,
  fee: number
): Array<{ utilization: number; supplyApy: number; borrowApy: number }> {
  const rateAtTarget = Number(rateAtTargetPerSecondWad) / 1e18;
  if (!Number.isFinite(rateAtTarget) || rateAtTarget <= 0) return [];
  return Array.from({ length: IRM_POINTS + 1 }, (_, i) => {
    const utilization = i / IRM_POINTS;
    const borrowApy = Math.expm1(adaptiveCurveBorrowRate(utilization, rateAtTarget) * SECONDS_PER_YEAR);
    return { utilization, borrowApy, supplyApy: borrowApy * utilization * (1 - fee) };
  });
}

type HealthRow = { user_address?: string | null; collateral_assets?: string | null; borrow_shares?: string | null; ltv_wad?: string | null };

async function loadBorrowers(
  chainId: number,
  marketId: string,
  ctx: { lltv: number; borrowAssets: bigint; borrowShares: bigint; loanDecimals: number; collateralDecimals: number; loanPrice: number | null; collateralPrice: number | null }
): Promise<MarketBorrowerRow[] | null> {
  let rows: HealthRow[];
  try {
    rows = await morphoRestList<HealthRow>(`/v0/blue/markets/${morphoSelector(chainId, marketId)}/positions/health`, {
      limit: BORROWER_ROWS,
    });
  } catch (error) {
    if (error instanceof MorphoRestError && error.status === 404) return null;
    throw error;
  }
  return rows
    .filter((r) => r.user_address)
    .map((r) => {
      const borrowAssets =
        ctx.borrowShares > BigInt(0) ? (toBigInt(r.borrow_shares) * ctx.borrowAssets) / ctx.borrowShares : BigInt(0);
      const ltv = wadToFraction(r.ltv_wad ?? null);
      const healthFactor = ltv && ltv > 0 ? ctx.lltv / ltv : null;
      return {
        address: r.user_address!,
        collateral: toBigInt(r.collateral_assets).toString(),
        collateralUsd: ctx.collateralPrice === null ? null : rawToNumber(r.collateral_assets, ctx.collateralDecimals) * ctx.collateralPrice,
        borrowAssets: borrowAssets.toString(),
        borrowAssetsUsd: ctx.loanPrice === null ? null : rawToNumber(borrowAssets, ctx.loanDecimals) * ctx.loanPrice,
        healthFactor,
        // Price drop that takes this position to its LLTV.
        priceVariationToLiquidationPrice: healthFactor && healthFactor > 0 ? 1 / healthFactor - 1 : null,
      };
    })
    .sort((a, b) => (b.borrowAssetsUsd ?? 0) - (a.borrowAssetsUsd ?? 0));
}

/** Muscadine vaults supplying this market (from the shared vault snapshots). */
async function loadMuscadineSuppliers(chainId: number, marketId: string): Promise<{ rows: MarketSupplierRow[]; failed: boolean }> {
  const id = marketId.toLowerCase();
  const vaults = getVaultAddressesForProtocolStats().filter((v) => v.chainId === chainId);
  let failed = false;
  const rows = (
    await Promise.all(
      vaults.map(async (vault) => {
        try {
          const snap = await loadRestVaultSnapshot(chainId, vault.address);
          const supplied = snap.suppliedByMarket.get(id) ?? BigInt(0);
          if (supplied <= BigInt(0)) return null;
          const adapter = (snap.allocations.allocations ?? []).find((a) =>
            (a?.caps ?? []).some((c) => c.market_id?.toLowerCase() === id)
          )?.adapter_address;
          const row: MarketSupplierRow = {
            address: adapter ?? snap.address,
            supplyAssets: supplied.toString(),
            supplyAssetsUsd: snap.priceUsd === null ? null : rawToNumber(supplied, snap.vault.asset.decimals) * snap.priceUsd,
            vaultAddress: snap.address,
            vaultName: snap.vault.name,
          };
          return row;
        } catch (error) {
          failed = true;
          logger.warn('Vault snapshot failed for market suppliers', {
            vault: vault.address,
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        }
      })
    )
  ).filter((r): r is MarketSupplierRow => r !== null);
  rows.sort((a, b) => (b.supplyAssetsUsd ?? 0) - (a.supplyAssetsUsd ?? 0));
  return { rows, failed };
}

export async function fetchMarketActivity(marketId: string, chainId: number): Promise<MarketActivity | null> {
  return withServerResponseCache(
    `market-activity:${chainId}:${marketId.toLowerCase()}`,
    API_CACHE_MAX_AGE_MS,
    async () => {
      let market: Awaited<ReturnType<typeof getRestMarket>>;
      let state: Awaited<ReturnType<typeof getRestMarketState>>;
      let history: HistoryPoint[];
      try {
        [market, state, history] = await Promise.all([
          getRestMarket(chainId, marketId),
          getRestMarketState(chainId, marketId),
          morphoRestGet<HistoryPoint[]>(`/v0/blue/markets/${morphoSelector(chainId, marketId)}/state/history`, {
            lookback: HISTORY_LOOKBACK,
          }),
        ]);
      } catch (error) {
        if (error instanceof MorphoRestError && error.status === 404) return null;
        throw error;
      }
      const [loanToken, collateralToken, loanPrice, collateralPrice, suppliers] = await Promise.all([
        getRestToken(chainId, market.loan_token),
        market.collateral_token ? getRestToken(chainId, market.collateral_token).catch(() => null) : Promise.resolve(null),
        tryGetRestTokenPriceUsd(chainId, market.loan_token),
        market.collateral_token ? tryGetRestTokenPriceUsd(chainId, market.collateral_token) : Promise.resolve(null),
        loadMuscadineSuppliers(chainId, marketId),
      ]);
      const sorted = [...(history ?? [])].filter((p) => Number.isFinite(p.timestamp)).sort((a, b) => a.timestamp - b.timestamp);
      const fee = wadToFraction(state.fee_wad) ?? 0;
      const rateAtTarget = Number(state.rate_at_target_per_second_wad) / 1e18;
      const borrowAssets = toBigInt(state.total_borrow_assets);
      const lltv = wadToFraction(market.lltv_wad) ?? 0;

      const borrowers = await loadBorrowers(chainId, marketId, {
        lltv,
        borrowAssets,
        borrowShares: toBigInt((state as { total_borrow_shares?: string | null }).total_borrow_shares),
        loanDecimals: loanToken.decimals,
        collateralDecimals: collateralToken?.decimals ?? 18,
        loanPrice,
        collateralPrice,
      }).catch((error: unknown) => {
        logger.warn('Morpho REST borrowers read failed', { marketId, error: error instanceof Error ? error.message : String(error) });
        return null;
      });

      return {
        borrowers: borrowers ?? [],
        borrowerCount: borrowers ? borrowers.length : null,
        suppliers: suppliers.rows,
        supplierCount: null,
        liquidations: [],
        warning: suppliers.failed ? 'Some Muscadine vault reads failed; vaults may be missing from Suppliers.' : null,
        collateralAtRisk: borrowers ? collateralAtRiskCurve(borrowers) : [],
        collateralAtRiskSource: 'topBorrowers',
        collateralAtRiskBorrowUsd: (borrowers ?? []).reduce((s, b) => s + (b.borrowAssetsUsd ?? 0), 0),
        marketBorrowUsd: loanPrice === null ? null : rawToNumber(borrowAssets, loanToken.decimals) * loanPrice,
        history: {
          borrowApy: realizedSeries(sorted, 'total_borrow_assets', 'total_borrow_shares'),
          supplyApy: realizedSeries(sorted, 'total_supply_assets', 'total_supply_shares'),
          utilization: sorted
            .filter((p) => toBigInt(p.total_supply_assets) > BigInt(0))
            .map((p) => ({ x: p.timestamp, y: Number(toBigInt(p.total_borrow_assets)) / Number(toBigInt(p.total_supply_assets)) })),
          // Not in REST market history (only the current rate at target is).
          apyAtTarget: [],
        },
        irmCurve: irmCurveFromRateAtTarget(state.rate_at_target_per_second_wad, fee),
        apyAtTarget: Number.isFinite(rateAtTarget) && rateAtTarget > 0 ? Math.expm1(rateAtTarget * SECONDS_PER_YEAR) : null,
        fee,
        unavailable: {
          borrowers: borrowers === null,
          collateralAtRisk: borrowers === null,
          liquidations: true,
          suppliersMuscadineOnly: true,
        },
      } satisfies MarketActivity;
    },
    (activity) => activity == null || activity.warning == null
  );
}

/** Target utilization of Morpho's Adaptive Curve IRM (the activity page's target line). */
export const MARKET_ACTIVITY_TARGET_UTILIZATION = ADAPTIVE_CURVE_TARGET;
