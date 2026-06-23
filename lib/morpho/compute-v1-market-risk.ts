import type { V1VaultMarketData } from './query-v1-vault-markets';
import type { OracleTimestampData } from './oracle-utils';
import { getIRMTargetUtilizationWithFallback } from './irm-utils';
import type { Address } from 'viem';

/**
 * Market Risk Scoring for Morpho V1 - Market Level Only
 * 
 * Formula: marketRiskScore = 0.25 * liquidationHeadroomScore + 0.25 * utilizationScore + 0.25 * coverageRatioScore + 0.25 * oracleScore
 * All component scores ∈ [0, 100]
 * Final marketRiskScore ∈ [0, 100]
 * 
 * Metrics:
 * 1. Liquidation Headroom (−5% or −2.5% shock) - 25% weight
 *    - 2.5% shock for same/derivative assets (e.g., USDC/USDC, wstETH/ETH)
 *    - 5% shock for different assets
 * 2. Utilization - 25% weight (100 at IRM target ≈90%; higher util → lower score)
 * 3. Liquidation Coverage Ratio - 25% weight
 * 4. Oracle Freshness & Reliability - 25% weight
 */

/**
 * Check if loan and collateral assets are the same or derivatives of each other
 * This allows using a lower price shock (2.5% vs 5%) for same-asset liquidations
 */
function isSameOrDerivativeAsset(market: V1VaultMarketData): boolean {
  const loanAsset = market.loanAsset;
  const collateralAsset = market.collateralAsset;

  if (!loanAsset || !collateralAsset) {
    return false;
  }

  // Check if addresses match (exact same asset)
  if (loanAsset.address.toLowerCase() === collateralAsset.address.toLowerCase()) {
    return true;
  }

  // Check if symbols match (same asset, different addresses possible)
  const loanSymbol = loanAsset.symbol?.toUpperCase() || '';
  const collateralSymbol = collateralAsset.symbol?.toUpperCase() || '';

  if (loanSymbol === collateralSymbol && loanSymbol !== '') {
    return true;
  }

  // Check for common derivative pairs
  // wstETH, stETH, rETH, cbETH, WETH, etc. are all ETH derivatives
  const ethDerivatives = ['WSTETH', 'STETH', 'RETH', 'CBETH', 'WETH', 'ETH'];
  const isLoanEthDerivative = ethDerivatives.includes(loanSymbol);
  const isCollateralEthDerivative = ethDerivatives.includes(collateralSymbol);

  if (isLoanEthDerivative && isCollateralEthDerivative) {
    return true;
  }

  // cbBTC, lBTC, etc. are all BTC derivatives
  const btcDerivatives = ['CBBTC', 'LBTC', 'WBTC', 'BTC'];
  const isLoanBtcDerivative = btcDerivatives.includes(loanSymbol);
  const isCollateralBtcDerivative = btcDerivatives.includes(collateralSymbol);

  if (isLoanBtcDerivative && isCollateralBtcDerivative) {
    return true;
  }

  // USDC/USDC.e, USDT/USDT.e, etc.
  if (
    (loanSymbol === 'USDC' || loanSymbol === 'USDC.E') &&
    (collateralSymbol === 'USDC' || collateralSymbol === 'USDC.E')
  ) {
    return true;
  }

  if (
    (loanSymbol === 'USDT' || loanSymbol === 'USDT.E') &&
    (collateralSymbol === 'USDT' || collateralSymbol === 'USDT.E')
  ) {
    return true;
  }

  return false;
}

// Letter Grade Mapping (0-100 scale)
export type MarketRiskGrade = 'A+' | 'A' | 'A−' | 'B+' | 'B' | 'B−' | 'C+' | 'C' | 'C−' | 'D' | 'F';

export interface MarketRiskScores {
  liquidationHeadroomScore: number; // [0, 100] - Liquidation Headroom (−5% shock)
  utilizationScore: number; // [0, 100] - Utilization
  coverageRatioScore: number; // [0, 100] - Liquidation Coverage Ratio
  oracleScore: number; // [0, 100] - Oracle Freshness & Reliability
  marketRiskScore: number; // [0, 100]
  grade: MarketRiskGrade;
  realizedBadDebt?: number | null; // Realized bad debt amount (USD) from Morpho GraphQL
  unrealizedBadDebt?: number | null; // Not available in GraphQL schema
  /** IRM kink used for utilization scoring (0–1). */
  targetUtilization?: number;
}

/**
 * Compute Oracle Freshness & Reliability Score (0-100)
 * 
 * Inputs:
 * - oracleAddress
 * - oracleTimestampData (optional) - timestamp data from Chainlink oracle
 * 
 * Compute:
 * - ageSeconds = now − lastUpdateTimestamp
 * - stalenessRatio = ageSeconds / expectedHeartbeatSeconds
 * 
 * Score (continuous):
 * - 100 = Chainlink oracle with recent update (< 1 hour old)
 * - Linear decay: 100 → 80 (1-24 hours), 80 → 60 (24-168 hours), 60 → 20 (168+ hours)
 * - 20 = No oracle address or zero address (opaque/fixed oracle)
 */
function computeOracleScore(
  market: V1VaultMarketData,
  oracleTimestampData?: OracleTimestampData | null
): number {
  const oracleAddress = market.oracleAddress;

  // If no oracle address or zero address, treat as opaque (score 20)
  if (!oracleAddress || oracleAddress.toLowerCase() === '0x0000000000000000000000000000000000000000') {
    return 20;
  }

  // If we have timestamp data from Chainlink oracle, score based on freshness
  if (oracleTimestampData?.updatedAt && oracleTimestampData.ageSeconds !== null) {
    const ageHours = oracleTimestampData.ageSeconds / 3600;
    
    // Recent update (< 1 hour) - perfect score
    if (ageHours < 1) {
      return 100;
    }
    
    // Linear decay from 100 to 80 between 1-24 hours
    if (ageHours < 24) {
      const progress = (ageHours - 1) / (24 - 1); // 0 to 1
      return 100 - (progress * 20); // 100 → 80
    }
    
    // Linear decay from 80 to 60 between 24-168 hours (1 week)
    if (ageHours < 168) {
      const progress = (ageHours - 24) / (168 - 24); // 0 to 1
      return 80 - (progress * 20); // 80 → 60
    }
    
    // Linear decay from 60 to 20 for > 168 hours
    // Cap at 20 for very stale data (e.g., > 720 hours = 30 days)
    const maxAge = 720; // 30 days
    if (ageHours >= maxAge) {
      return 20;
    }
    const progress = (ageHours - 168) / (maxAge - 168); // 0 to 1
    return 60 - (progress * 40); // 60 → 20
  }

  // Valid oracle address exists but no timestamp data available
  // This could be a custom oracle or Chainlink feed we couldn't resolve
  return 60;
}

/**
 * Compute Liquidation Headroom Score (0-100)
 * 
 * Inputs:
 * - lltv
 * - state.borrowAssetsUsd
 * - state.collateralAssetsUsd (must be borrower-side collateral, not supply)
 * - loanAsset and collateralAsset (to determine if same/derivative)
 * 
 * Compute:
 * - Uses -2.5% shock for same/derivative assets (e.g., USDC/USDC, wstETH/ETH)
 * - Uses -5% shock for different assets
 * - headroom = collateralUsd * shockMultiplier * lltvRatio − borrowUsd
 * - headroomRatio = headroom / borrowUsd
 * 
 * Score (continuous):
 * - Higher headroom ratio = better score
 * - Negative headroom (underwater) = 0
 * - Positive headroom scored based on ratio
 */
function computeLiquidationHeadroomScore(market: V1VaultMarketData): number {
  const state = market.state;
  if (!state) {
    return 0; // No state data = highest risk
  }

  const lltvRaw = market.lltv;
  if (!lltvRaw) {
    return 0; // No LTV = highest risk
  }

  // Convert LTV from wei format to ratio for calculations
  // Wei to ratio: divide by 1e18 (e.g., 860000000000000000 -> 0.86)
  const lltvRatio = Number(lltvRaw) / 1e18;

  // Get USD values - MUST use collateralAssetsUsd (borrower-side collateral)
  const collateralUsd = state.collateralAssetsUsd ? Number(state.collateralAssetsUsd) : 0;
  const borrowUsd = state.borrowAssetsUsd ? Number(state.borrowAssetsUsd) : 0;

  if (borrowUsd === 0) {
    return 100; // No borrow = safest
  }

  if (collateralUsd === 0) {
    return 0; // No collateral = highest risk
  }

  // Determine price shock: 2.5% for same/derivative assets, 5% for different assets
  const isSameAsset = isSameOrDerivativeAsset(market);
  const priceShock = isSameAsset ? 0.025 : 0.05; // 2.5% or 5%
  const shockMultiplier = 1 - priceShock; // 0.975 or 0.95

  // Compute headroom with price shock
  // headroom = collateralUsd * shockMultiplier * lltvRatio − borrowUsd
  const headroom = collateralUsd * shockMultiplier * lltvRatio - borrowUsd;
  const headroomRatio = headroom / borrowUsd;

  // If underwater (negative headroom), score is 0
  if (headroomRatio < 0) {
    return 0;
  }

  // Score based on headroom ratio
  // Higher headroom = better score
  // 0% headroom = 0 score
  // 10% headroom = 60 score
  // 20% headroom = 80 score
  // 30%+ headroom = 100 score
  if (headroomRatio >= 0.30) {
    return 100;
  } else if (headroomRatio >= 0.20) {
    // 20% → 30%: 80 → 100
    const progress = (headroomRatio - 0.20) / 0.10;
    return 80 + (progress * 20);
  } else if (headroomRatio >= 0.10) {
    // 10% → 20%: 60 → 80
    const progress = (headroomRatio - 0.10) / 0.10;
    return 60 + (progress * 20);
  } else {
    // 0% → 10%: 0 → 60
    const progress = headroomRatio / 0.10;
    return progress * 60;
  }
}

/**
 * Utilization risk score (0–100).
 *
 * Target utilization (typically 90% IRM kink) is optimal → 100.
 * At or below target stays at 100 (not riskier). Above target, score falls
 * linearly to 0 at 100% utilization.
 */
function scoreUtilizationRatio(
  utilization: number,
  targetUtilization: number
): number {
  const util = Math.max(0, Math.min(1, utilization));
  const target = Math.max(0, Math.min(1, targetUtilization));

  if (util <= target) {
    return 100;
  }

  const roomAbove = 1 - target;
  if (roomAbove <= 0) {
    return 0;
  }

  const excess = util - target;
  return Math.max(0, 100 - (excess / roomAbove) * 100);
}

/**
 * Compute Utilization Score (0-100) - Based on IRM target utilization
 *
 * Optimal utilization equals the IRM target (default 90%) → score 100.
 * Higher utilization is riskier (score decreases toward 0 at 100% util).
 */
async function computeUtilizationScore(
  market: V1VaultMarketData,
  targetUtilization: number
): Promise<number> {
  const state = market.state;
  if (!state) {
    return 0;
  }

  const supplyUsd = state.supplyAssetsUsd ? Number(state.supplyAssetsUsd) : 0;
  const borrowUsd = state.borrowAssetsUsd ? Number(state.borrowAssetsUsd) : 0;

  let utilization = state.utilization;
  if (utilization === null || utilization === undefined) {
    if (supplyUsd === 0) {
      return 0;
    }
    utilization = borrowUsd / supplyUsd;
  }

  return scoreUtilizationRatio(utilization, targetUtilization);
}

/**
 * Compute Liquidation Coverage Ratio Score (0-100)
 * 
 * Inputs:
 * - Everything from Liquidation Headroom (lltv, borrowAssetsUsd, collateralAssetsUsd)
 * - Everything from Utilization (supplyAssetsUsd, borrowAssetsUsd)
 * 
 * Compute:
 * - liquidatableBorrow = max(0, borrowUsd − collateralUsd*shockMultiplier*lltvRatio)
 *   - Uses 2.5% shock for same/derivative assets, 5% for different assets
 * - coverage = availableLiquidityUsd / liquidatableBorrow
 * 
 * Score (continuous):
 * - Higher coverage ratio = better score
 * - Full coverage (≥1.0) = 100
 * - Partial coverage scored based on ratio
 */
function computeCoverageRatioScore(market: V1VaultMarketData): number {
  const state = market.state;
  if (!state) {
    return 0; // No state data = highest risk
  }

  const lltvRaw = market.lltv;
  if (!lltvRaw) {
    return 0; // No LTV = highest risk
  }

  // Convert LTV from wei format to ratio for calculations
  // Wei to ratio: divide by 1e18 (e.g., 860000000000000000 -> 0.86)
  const lltvRatio = Number(lltvRaw) / 1e18;

  // Get USD values - MUST use collateralAssetsUsd (borrower-side collateral)
  const collateralUsd = state.collateralAssetsUsd ? Number(state.collateralAssetsUsd) : 0;
  const borrowUsd = state.borrowAssetsUsd ? Number(state.borrowAssetsUsd) : 0;
  const supplyUsd = state.supplyAssetsUsd ? Number(state.supplyAssetsUsd) : 0;

  // Compute available liquidity
  const availableLiquidityUsd = supplyUsd - borrowUsd;

  if (borrowUsd === 0) {
    return 100; // No borrow = safest
  }

  if (collateralUsd === 0) {
    return 0; // No collateral = highest risk
  }

  // Determine price shock: 2.5% for same/derivative assets, 5% for different assets
  const isSameAsset = isSameOrDerivativeAsset(market);
  const priceShock = isSameAsset ? 0.025 : 0.05; // 2.5% or 5%
  const shockMultiplier = 1 - priceShock; // 0.975 or 0.95

  // Compute liquidatable borrow with price shock
  // liquidatableBorrow = max(0, borrowUsd − collateralUsd*shockMultiplier*lltvRatio)
  const liquidatableBorrow = Math.max(0, borrowUsd - collateralUsd * shockMultiplier * lltvRatio);

  // If no liquidations needed, perfect score
  if (liquidatableBorrow === 0) {
    return 100;
  }

  // Compute coverage ratio
  // coverage = availableLiquidityUsd / liquidatableBorrow
  if (availableLiquidityUsd <= 0) {
    return 0; // No liquidity available = highest risk
  }

  const coverage = availableLiquidityUsd / liquidatableBorrow;

  // Score based on coverage ratio
  // Full coverage (≥1.0) = 100
  // Partial coverage scored linearly
  if (coverage >= 1.0) {
    return 100; // Full coverage
  } else if (coverage >= 0.8) {
    // 80% → 100% coverage: 80 → 100 score
    const progress = (coverage - 0.8) / 0.2;
    return 80 + (progress * 20);
  } else if (coverage >= 0.5) {
    // 50% → 80% coverage: 60 → 80 score
    const progress = (coverage - 0.5) / 0.3;
    return 60 + (progress * 20);
  } else if (coverage >= 0.25) {
    // 25% → 50% coverage: 40 → 60 score
    const progress = (coverage - 0.25) / 0.25;
    return 40 + (progress * 20);
  } else {
    // 0% → 25% coverage: 0 → 40 score
    const progress = coverage / 0.25;
    return progress * 40;
  }
}

/**
 * Map market risk score to letter grade (0-100 scale)
 */
function getMarketRiskGrade(score: number): MarketRiskGrade {
  if (score >= 93) return 'A+';
  if (score >= 90) return 'A';
  if (score >= 87) return 'A−';
  if (score >= 84) return 'B+';
  if (score >= 80) return 'B';
  if (score >= 77) return 'B−';
  if (score >= 74) return 'C+';
  if (score >= 70) return 'C';
  if (score >= 65) return 'C−';
  if (score >= 60) return 'D';
  return 'F';
}

/**
 * Apply global caps based on component scores (0-100 scale)
 */
function applyGlobalCaps(
  oracleScore: number,
  utilizationScore: number,
  coverageRatioScore: number,
  baseScore: number
): number {
  let cappedScore = baseScore;

  // oracleScore ≤ 20 ⇒ grade ≤ C+ (54)
  if (oracleScore <= 20 && cappedScore > 54) {
    cappedScore = 54; // C+ max
  }

  // utilization ≥ 95% ⇒ grade ≤ B− (60)
  // (handled in utilizationScore, but also check if utilizationScore ≤ 20)
  if (utilizationScore <= 20 && cappedScore > 60) {
    cappedScore = 60; // B− max
  }

  // Coverage ratio < 1.0 (cannot fully cover -5% shock liquidations) ⇒ grade ≤ B (68)
  // If coverage ratio score < 100, then cannot fully cover liquidations
  if (coverageRatioScore < 100 && cappedScore > 68) {
    cappedScore = 68; // B max
  }

  return cappedScore;
}

/**
 * Check if market is idle (should not be scored)
 */
export function isMarketIdle(market: V1VaultMarketData): boolean {
  return !market.lltv || !market.collateralAsset?.symbol || market.collateralAsset.symbol === 'Unknown';
}

/**
 * Compute all market risk scores for a V1 vault market
 */
export async function computeV1MarketRiskScores(
  market: V1VaultMarketData,
  oracleTimestampData?: OracleTimestampData | null,
  targetUtilization?: number | null
): Promise<MarketRiskScores> {
  // Get target utilization from IRM if not provided
  let targetUtil = targetUtilization ?? null;
  if (targetUtil === null) {
    targetUtil = await getIRMTargetUtilizationWithFallback(
      market.irmAddress ? (market.irmAddress as Address) : null
    );
  }

  const liquidationHeadroomScore = computeLiquidationHeadroomScore(market);
  const utilizationScore = await computeUtilizationScore(market, targetUtil);
  const coverageRatioScore = computeCoverageRatioScore(market);
  const oracleScore = computeOracleScore(market, oracleTimestampData);

  // Compute base market risk score (weighted average)
  // All metrics weighted equally at 25% each
  const baseMarketRiskScore = 
    0.25 * liquidationHeadroomScore +
    0.25 * utilizationScore +
    0.25 * coverageRatioScore +
    0.25 * oracleScore;

  // Apply global caps
  const marketRiskScore = applyGlobalCaps(
    oracleScore,
    utilizationScore,
    coverageRatioScore,
    baseMarketRiskScore
  );

  // Check for bad debt and override grade if present
  // realizedBadDebt is on the Market type (not MarketState), it's a MarketBadDebt object with usd field
  const badDebtUsd = market.realizedBadDebt?.usd ?? null;
  
  let finalGrade: MarketRiskGrade;
  let finalScore = marketRiskScore;
  
  // If market has bad debt greater than $1.00, automatically grade F
  if (badDebtUsd != null && badDebtUsd > 1.0) {
    finalGrade = 'F';
    finalScore = 0; // F grade corresponds to score < 60, set to 0 for clarity
  }
  // Otherwise use calculated grade
  else {
    finalGrade = getMarketRiskGrade(marketRiskScore);
  }

  return {
    liquidationHeadroomScore,
    utilizationScore,
    coverageRatioScore,
    oracleScore,
    marketRiskScore: finalScore,
    grade: finalGrade,
    realizedBadDebt: badDebtUsd,
    unrealizedBadDebt: null, // Not available in GraphQL schema
    targetUtilization: targetUtil,
  };
}
