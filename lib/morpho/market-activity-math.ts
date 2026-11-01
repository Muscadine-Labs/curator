/**
 * Pure helpers for the Blue market activity sections (borrowers, collateral at
 * risk, IRM). No I/O — safe to import from client components and tests.
 */

/** GraphQL BigInt arrives as a string or a JSON number; normalize to a raw integer string. */
export function rawAmountString(value: string | number | null | undefined): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    if (/^-?\d+$/.test(value)) return value;
    const n = Number(value);
    return Number.isFinite(n) ? BigInt(Math.round(n)).toString() : null;
  }
  if (!Number.isFinite(value)) return null;
  // Large values come back as floats (e.g. 1.2e21); BigInt(Math.round) keeps
  // them integral. Precision past 2^53 is already lost upstream — display only.
  return Number.isSafeInteger(value) ? String(value) : BigInt(Math.round(value)).toString();
}

export type RiskPosition = {
  collateralUsd: number | null;
  /**
   * Morpho `priceVariationToLiquidationPrice`: the collateral price move that
   * makes the position liquidatable (−0.27 = a 27% drop). ≥ 0 = already
   * liquidatable. Null when the position has no borrow.
   */
  priceVariationToLiquidationPrice: number | null;
};

export type CollateralAtRiskPoint = {
  /** Oracle price change as a fraction (−0.1 = −10%). */
  priceChange: number;
  collateralUsd: number;
  /** Positions counted (top-borrower fallback only; Morpho's curve has no count). */
  positions: number | null;
};

/**
 * Morpho `marketCollateralAtRisk` points (`collateralPriceRatio` 0.05 … 1 =
 * price after the move) → price-change points, 0% first.
 */
export function collateralAtRiskFromMorpho(
  points: ReadonlyArray<{ collateralPriceRatio: number; collateralUsd: number | null }>
): CollateralAtRiskPoint[] {
  return points
    .filter((p) => Number.isFinite(p.collateralPriceRatio))
    .map((p) => ({
      priceChange: Math.round((p.collateralPriceRatio - 1) * 1e6) / 1e6,
      collateralUsd: p.collateralUsd ?? 0,
      positions: null,
    }))
    .sort((a, b) => b.priceChange - a.priceChange);
}

/** Default x-axis: 0% down to −99% in 1% steps (Morpho `numberOfPoints: 100`). */
export const COLLATERAL_AT_RISK_STEPS: ReadonlyArray<number> = Array.from(
  { length: 100 },
  (_, i) => -i / 100
);

/**
 * Cumulative collateral that becomes liquidatable at each oracle price drop.
 * A position counts at drop `d` when its liquidation price is reached by a
 * move of `d` or less (`variation >= d`).
 */
export function collateralAtRiskCurve(
  positions: ReadonlyArray<RiskPosition>,
  steps: ReadonlyArray<number> = COLLATERAL_AT_RISK_STEPS
): CollateralAtRiskPoint[] {
  return steps.map((priceChange) => {
    let collateralUsd = 0;
    let count = 0;
    for (const p of positions) {
      const v = p.priceVariationToLiquidationPrice;
      if (v == null || !Number.isFinite(v)) continue;
      if (v >= priceChange - 1e-12) {
        collateralUsd += p.collateralUsd ?? 0;
        count += 1;
      }
    }
    return { priceChange, collateralUsd, positions: count };
  });
}

/**
 * USD that must be borrowed (positive) or repaid (negative) for utilization to
 * reach the IRM target: `target × supply − borrow`.
 */
export function borrowToTargetUsd(
  supplyUsd: number | null | undefined,
  borrowUsd: number | null | undefined,
  targetUtilization: number
): number | null {
  if (supplyUsd == null || borrowUsd == null) return null;
  if (!Number.isFinite(supplyUsd) || !Number.isFinite(borrowUsd)) return null;
  return targetUtilization * supplyUsd - borrowUsd;
}

/** `part / total` as a fraction; null when the total is not positive. */
export function shareOf(part: number | null | undefined, total: number | null | undefined): number | null {
  if (part == null || total == null || !(total > 0)) return null;
  return part / total;
}

export type HealthTone = 'liquidatable' | 'danger' | 'warning' | 'healthy' | 'unknown';

/** Health factor bands: < 1 liquidatable, < 1.05 danger, < 1.15 warning. */
export function healthTone(healthFactor: number | null | undefined): HealthTone {
  if (healthFactor == null || !Number.isFinite(healthFactor)) return 'unknown';
  if (healthFactor < 1) return 'liquidatable';
  if (healthFactor < 1.05) return 'danger';
  if (healthFactor < 1.15) return 'warning';
  return 'healthy';
}
