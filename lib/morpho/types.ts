import type { Market } from '@morpho-org/blue-api-sdk';

/**
 * Use SDK Market type directly for type safety
 * This ensures our types stay in sync with Morpho's GraphQL schema
 */
export type MorphoMarketRaw = Market;

export type CuratorWeights = {
  utilization: number;
  rateAlignment: number;
  stressExposure: number;
  withdrawalLiquidity: number;
  liquidationCapacity: number;
};

export type CuratorConfig = {
  morphoApiUrl: string;
  utilizationCeiling: number;
  utilizationBufferHours: number;
  maxUtilizationBeyond?: number;
  rateAlignmentEps: number;
  rateAlignmentHighYieldBuffer?: number;
  rateAlignmentHighYieldEps?: number;
  fallbackBenchmarkRate: number;
  priceStressPct: number;
  liquidityStressPct: number;
  withdrawalLiquidityMinPct: number;
  insolvencyTolerancePctTvl: number;
  minTvlUsd?: number;
  weights: CuratorWeights;
  configVersion?: string;
};

export type MorphoMarketMetrics = {
  id: string;
  symbol: string;
  utilization: number;
  utilizationScore: number;
  supplyRate: number | null;
  borrowRate: number | null;
  benchmarkSupplyRate: number | null;
  rateAlignmentScore: number;
  potentialInsolvencyUsd: number;
  insolvencyPctOfTvl: number;
  stressExposureScore: number;
  availableLiquidity: number;
  requiredLiquidity: number;
  withdrawalLiquidityScore: number;
  liquidatorCapacityPostStress: number;
  liquidationCapacityScore: number;
  tvlUsd: number;
  minTvlThresholdHit: boolean;
  insufficientTvl: boolean;
  effectiveWeights: CuratorWeights;
  rating: number | null;
  configVersion?: string;
  raw: MorphoMarketRaw;
};
