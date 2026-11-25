import { morphoRestGet, morphoSelector } from '@/lib/morpho/rest-client';
import { getRestVault, rawToNumber, toBigInt, tryGetRestTokenPriceUsd } from '@/lib/morpho/rest-data';
import { utcDayKeyFromTimestamp } from '@/lib/utils/utc-calendar';

/** `y` is a number, or a raw integer string for token / share amounts. */
export type MorphoTimeseriesPoint = { x?: number | null; y?: number | string | null };

export type VaultHistoryChartPoint = {
  date: string;
  value: number;
};

export type VaultHistoryRawPoint = { date: string; value: string };

export type VaultHistorySeries = {
  /** Raw underlying token amount (stringified integer). */
  supplied: VaultHistoryRawPoint[];
  suppliedUsd: VaultHistoryChartPoint[];
  /** Liquidity (USD) = Morpho withdrawable amount. Not indexed historically — spot only. */
  liquidityUsd: VaultHistoryChartPoint[];
  /** Liquidity in raw token units. Not indexed historically — spot only. */
  liquidity: VaultHistoryRawPoint[];
  /** Net / avg net APY as percent (e.g. 4.5 = 4.5%). */
  apy: VaultHistoryChartPoint[];
  /** Price per vault share in underlying asset units (Morpho human decimal). */
  sharePrice: VaultHistoryChartPoint[];
  /** Price per vault share in USD. */
  sharePriceUsd: VaultHistoryChartPoint[];
};

/** ERC-4626 vault shares use 18 decimals on Morpho historical `totalSupply`. */
export const VAULT_SHARE_DECIMALS = 18;

type RestStatePoint = {
  timestamp: number;
  total_assets?: string | null;
  total_supply?: string | null;
  share_price_ray?: string | null;
};

const SECONDS_PER_YEAR = 31_536_000;

/**
 * Realized net APY per interval from the share price: (p₁ / p₀)^(year / Δt) − 1. Exact,
 * fees included, one point per REST point (daily) — unlike REST `apy/history`, whose
 * `inception` points are trailing 30-day averages. Falls back to those averages when the
 * share price series is too short.
 */
export function realizedApySeries(
  points: ReadonlyArray<{ timestamp: number; share_price_ray?: string | null }>,
  fallback: ReadonlyArray<{ timestamp: number; apy: number | null }>
): Array<{ x: number; y: number }> {
  const priced = points
    .filter((p) => p.share_price_ray && toBigInt(p.share_price_ray) > BigInt(0))
    .sort((a, b) => a.timestamp - b.timestamp);
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 1; i < priced.length; i++) {
    const prev = priced[i - 1]!;
    const cur = priced[i]!;
    const dt = cur.timestamp - prev.timestamp;
    if (dt < 3600) continue;
    const ratio = Number((toBigInt(cur.share_price_ray) * BigInt(1e18)) / toBigInt(prev.share_price_ray)) / 1e18;
    const apy = Math.pow(ratio, SECONDS_PER_YEAR / dt) - 1;
    if (Number.isFinite(apy) && apy > -1) out.push({ x: cur.timestamp, y: apy });
  }
  if (out.length > 0) return out;
  return fallback
    .filter((p) => typeof p.apy === 'number' && Number.isFinite(p.apy))
    .map((p) => ({ x: p.timestamp, y: p.apy as number }));
}

/**
 * A vault's daily history from Morpho REST (`state/history` + `apy/history`, `inception`
 * lookback: daily, can turn coarser as the vault ages), as `{x, y}` series for
 * `buildV2HistorySeries`. USD is today's spot price × tokens (REST has no historical prices).
 * APY points are Morpho's trailing 30-day averages at that lookback, not per-day APY.
 */
export async function loadVaultV2HistoricalState(
  chainId: number,
  address: string
): Promise<{ asset: { symbol: string | null; decimals: number }; historicalState: NonNullable<Parameters<typeof buildV2HistorySeries>[0]> }> {
  const selector = morphoSelector(chainId, address);
  const [vault, statePoints, apyPoints] = await Promise.all([
    getRestVault(chainId, address),
    morphoRestGet<RestStatePoint[]>(`/v0/vaults-v2/${selector}/state/history`, { lookback: 'inception' }),
    morphoRestGet<Array<{ timestamp: number; apy: number | null }>>(`/v0/vaults-v2/${selector}/apy/history`, {
      lookback: 'inception',
    }).catch(() => []),
  ]);
  const price = await tryGetRestTokenPriceUsd(chainId, vault.asset.address);
  const decimals = vault.asset.decimals;
  const points = (statePoints ?? []).filter((p) => Number.isFinite(p.timestamp));
  return {
    asset: { symbol: vault.asset.symbol, decimals },
    historicalState: {
      totalAssets: points.map((p) => ({ x: p.timestamp, y: toBigInt(p.total_assets).toString() })),
      totalAssetsUsd:
        price === null ? [] : points.map((p) => ({ x: p.timestamp, y: rawToNumber(p.total_assets, decimals) * price })),
      totalSupply: points.map((p) => ({ x: p.timestamp, y: toBigInt(p.total_supply).toString() })),
      // share_price_ray is decimals-adjusted: assets per share × 1e27.
      sharePrice: points
        .filter((p) => p.share_price_ray)
        .map((p) => ({ x: p.timestamp, y: Number(toBigInt(p.share_price_ray) / BigInt(1e9)) / 1e18 })),
      avgNetApy: realizedApySeries(points, apyPoints ?? []),
    },
  };
}

function dayKeyFromTimestamp(seconds: number): string {
  return utcDayKeyFromTimestamp(seconds);
}

/** Normalize Morpho `{x,y}` points to one value per calendar day (latest sample wins). */
export function mapMorphoTimeseries(
  points: MorphoTimeseriesPoint[] | null | undefined,
  transform: (y: number) => number = (y) => y
): VaultHistoryChartPoint[] {
  if (!points?.length) return [];

  const dayMap = new Map<string, { date: string; value: number; timestamp: number }>();

  for (const point of points) {
    if (point.x == null || point.y == null) continue;
    const date = dayKeyFromTimestamp(point.x);
    const timestamp = point.x * 1000;
    const value = transform(Number(point.y));
    const existing = dayMap.get(date);
    if (!existing || timestamp > existing.timestamp) {
      dayMap.set(date, { date, value, timestamp });
    }
  }

  return Array.from(dayMap.values())
    .map(({ date, value }) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function mapMorphoTimeseriesRaw(
  points: MorphoTimeseriesPoint[] | null | undefined
): Array<{ date: string; value: string }> {
  if (!points?.length) return [];

  const dayMap = new Map<string, { date: string; value: string; timestamp: number }>();

  for (const point of points) {
    if (point.x == null || point.y == null) continue;
    const date = dayKeyFromTimestamp(point.x);
    const timestamp = point.x * 1000;
    const value = String(point.y);
    const existing = dayMap.get(date);
    if (!existing || timestamp > existing.timestamp) {
      dayMap.set(date, { date, value, timestamp });
    }
  }

  return Array.from(dayMap.values())
    .map(({ date, value }) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** USD per share from `totalAssetsUsd / totalSupply` (V2 has no indexed `sharePriceUsd`). */
export function computeSharePriceUsdSeries(
  totalAssetsUsd: VaultHistoryChartPoint[],
  totalSupplyRaw: VaultHistoryRawPoint[],
  shareDecimals: number = VAULT_SHARE_DECIMALS
): VaultHistoryChartPoint[] {
  if (!totalAssetsUsd.length || !totalSupplyRaw.length) return [];

  const supplyByDate = new Map(totalSupplyRaw.map((p) => [p.date, p.value]));
  const divisor = 10 ** shareDecimals;
  const result: VaultHistoryChartPoint[] = [];

  for (const point of totalAssetsUsd) {
    const supplyRaw = supplyByDate.get(point.date);
    if (supplyRaw == null) continue;
    try {
      const shares = Number(BigInt(supplyRaw)) / divisor;
      if (!Number.isFinite(shares) || shares <= 0) continue;
      result.push({ date: point.date, value: point.value / shares });
    } catch {
      continue;
    }
  }

  return result;
}

function seriesHasPositiveValue(points: VaultHistoryChartPoint[]): boolean {
  return points.some((p) => Number.isFinite(p.value) && p.value > 0);
}

export function buildV2HistorySeries(historicalState?: {
  totalAssets?: MorphoTimeseriesPoint[] | null;
  totalAssetsUsd?: MorphoTimeseriesPoint[] | null;
  avgNetApy?: MorphoTimeseriesPoint[] | null;
  sharePrice?: MorphoTimeseriesPoint[] | null;
  totalSupply?: MorphoTimeseriesPoint[] | null;
} | null): VaultHistorySeries {
  const totalAssetsUsd = mapMorphoTimeseries(historicalState?.totalAssetsUsd);
  const totalAssets = mapMorphoTimeseriesRaw(historicalState?.totalAssets);
  const totalSupply = mapMorphoTimeseriesRaw(historicalState?.totalSupply);
  const apy = mapMorphoTimeseries(historicalState?.avgNetApy, (y) => y * 100);

  return {
    supplied: totalAssets,
    suppliedUsd: totalAssetsUsd,
    liquidityUsd: [],
    liquidity: [],
    // A new vault often has TVL and share price before Morpho indexes
    // avgNetApy. Keep deposits; hide a flat 0% APY series until a rate exists.
    apy: seriesHasPositiveValue(apy) ? apy : [],
    sharePrice: mapMorphoTimeseries(historicalState?.sharePrice),
    sharePriceUsd: computeSharePriceUsdSeries(totalAssetsUsd, totalSupply),
  };
}
