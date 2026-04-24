import type { CuratorConfig, CuratorWeights } from './types';
import { MORPHO_GRAPHQL_ENDPOINT } from '@/lib/constants';
import { logger } from '@/lib/utils/logger';

export type CuratorConfigOverrides = Partial<Omit<CuratorConfig, 'weights'>> & {
  weights?: Partial<CuratorWeights>;
};

const DEFAULT_WEIGHTS: CuratorWeights = {
  utilization: 0.2,
  rateAlignment: 0.15,
  stressExposure: 0.3,
  withdrawalLiquidity: 0.2,
  liquidationCapacity: 0.15,
};

/**
 * Clamps a value to [0, 1] range
 * Note: This function is used internally in compute.ts, kept here for potential reuse
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * Default curator configuration for Morpho market risk rating.
 * 
 * All *Pct fields are decimals (0.3 = 30%, not 30).
 * rateAlignmentEps and fallbackBenchmarkRate are APY fractions (0.05 = 5% APY).
 * 
 * Typical ranges:
 * - utilizationCeiling: 0.7-0.95 (70-95%)
 * - priceStressPct: 0.2-0.5 (20-50% price shock)
 * - liquidityStressPct: 0.3-0.6 (30-60% liquidity shock)
 * - withdrawalLiquidityMinPct: 0.05-0.2 (5-20% of TVL)
 * - insolvencyTolerancePctTvl: 0.001-0.02 (0.1-2% of TVL)
 * - rateAlignmentEps: 0.01-0.05 (1-5% APY tolerance)
 * - fallbackBenchmarkRate: 0.03-0.08 (3-8% APY)
 */
const DEFAULT_CURATOR_CONFIG: CuratorConfig = {
  morphoApiUrl: MORPHO_GRAPHQL_ENDPOINT,
  utilizationCeiling: 0.9, // 90% utilization ceiling
  utilizationBufferHours: 48,
  maxUtilizationBeyond: 1.1, // 110% max utilization for scoring
  rateAlignmentEps: 0.02, // 2% APY tolerance
  rateAlignmentHighYieldBuffer: 0.03, // 3% APY above benchmark triggers extra penalty
  rateAlignmentHighYieldEps: 0.01, // 1% APY for high yield penalty decay
  fallbackBenchmarkRate: 0.05, // 5% APY default benchmark
  priceStressPct: 0.3, // 30% price shock
  liquidityStressPct: 0.4, // 40% liquidity shock
  withdrawalLiquidityMinPct: 0.1, // 10% of TVL minimum withdrawal liquidity
  insolvencyTolerancePctTvl: 0.01, // 1% of TVL insolvency tolerance (updated from 0.0005)
  minTvlUsd: 10_000, // $10k minimum TVL threshold
  weights: DEFAULT_WEIGHTS,
  configVersion: '1.0.0',
};

function parseNumberEnv(key: string): number | undefined {
  const raw = process.env[key];
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Parses a percentage environment variable with validation.
 * Warns if the value looks like a percentage (1-100) when we expect a decimal (0-1).
 */
function parsePctEnv(key: string): number | undefined {
  const value = parseNumberEnv(key);
  if (value === undefined) return undefined;
  if (value > 1 && value <= 100) {
    logger.warn(`[curator] ${key} looks like a percent (${value}); expected 0–1`);
  }
  return value;
}

/**
 * Normalizes weights so they sum to 1.0.
 * Falls back to DEFAULT_WEIGHTS if sum is <= 0.
 */
function normalizeWeights(weights: CuratorWeights): CuratorWeights {
  const sum =
    weights.utilization +
    weights.rateAlignment +
    weights.stressExposure +
    weights.withdrawalLiquidity +
    weights.liquidationCapacity;
  if (sum <= 0) return DEFAULT_WEIGHTS; // fallback
  return {
    utilization: weights.utilization / sum,
    rateAlignment: weights.rateAlignment / sum,
    stressExposure: weights.stressExposure / sum,
    withdrawalLiquidity: weights.withdrawalLiquidity / sum,
    liquidationCapacity: weights.liquidationCapacity / sum,
  };
}

function loadConfigFromEnv(): CuratorConfigOverrides {
  const weights: Partial<CuratorWeights> = {};
  const weightKeys: Array<keyof CuratorWeights> = [
    'utilization',
    'rateAlignment',
    'stressExposure',
    'withdrawalLiquidity',
    'liquidationCapacity',
  ];

  weightKeys.forEach((key) => {
    const envKey = `CURATOR_WEIGHT_${key.toUpperCase()}`;
    const value = parseNumberEnv(envKey);
    if (value !== undefined) {
      weights[key] = value;
    }
  });

  const config: CuratorConfigOverrides = {
    morphoApiUrl: process.env.MORPHO_API_URL,
    utilizationCeiling: parsePctEnv('CURATOR_UTILIZATION_CEILING'),
    utilizationBufferHours: parseNumberEnv('CURATOR_UTILIZATION_BUFFER_HOURS'),
    maxUtilizationBeyond: parseNumberEnv('CURATOR_MAX_UTILIZATION_BEYOND'),
    rateAlignmentEps: parseNumberEnv('CURATOR_RATE_ALIGNMENT_EPS'),
    rateAlignmentHighYieldBuffer: parseNumberEnv('CURATOR_RATE_ALIGNMENT_HIGH_YIELD_BUFFER'),
    rateAlignmentHighYieldEps: parseNumberEnv('CURATOR_RATE_ALIGNMENT_HIGH_YIELD_EPS'),
    fallbackBenchmarkRate: parseNumberEnv('CURATOR_FALLBACK_BENCHMARK_RATE'),
    priceStressPct: parsePctEnv('CURATOR_PRICE_STRESS_PCT'),
    liquidityStressPct: parsePctEnv('CURATOR_LIQUIDITY_STRESS_PCT'),
    withdrawalLiquidityMinPct: parsePctEnv('CURATOR_WITHDRAWAL_LIQUIDITY_MIN_PCT'),
    insolvencyTolerancePctTvl: parsePctEnv('CURATOR_INSOLVENCY_TOLERANCE_PCT_TVL'),
    minTvlUsd: parseNumberEnv('CURATOR_MIN_TVL_USD'),
    weights: Object.keys(weights).length ? weights : undefined,
  };

  return Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== undefined)
  ) as CuratorConfigOverrides;
}

export function mergeConfig(overrides?: CuratorConfigOverrides): CuratorConfig {
  const envOverrides = loadConfigFromEnv();
  const source = { ...envOverrides, ...overrides };
  
  const mergedWeights = normalizeWeights({
    ...DEFAULT_CURATOR_CONFIG.weights,
    ...envOverrides.weights,
    ...overrides?.weights,
  });

  return {
    ...DEFAULT_CURATOR_CONFIG,
    ...source,
    weights: mergedWeights,
  };
}

