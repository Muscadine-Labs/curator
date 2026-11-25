import { NextResponse } from 'next/server';
import {
  getActiveVaultAddressesForStats,
  getConfiguredVaultDisplayName,
  getVaultAddressesForProtocolStats,
  vaultDisplayName,
} from '@/lib/config/vaults';
import { BASE_CHAIN_ID, DAYS_30_MS } from '@/lib/constants';
import { handleApiError } from '@/lib/utils/error-handler';
import { createRateLimitMiddleware, RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS } from '@/lib/utils/rate-limit';
import { MorphoRestError, morphoRestGet, morphoSelector } from '@/lib/morpho/rest-client';
import { getRestTokenPriceUsd, getRestVault, getRestVaultState, rawToNumber } from '@/lib/morpho/rest-data';
import { getAddress } from 'viem';
import { logger } from '@/lib/utils/logger';
import { mergeApiCacheHeaders, API_CACHE_MAX_AGE_MS } from '@/lib/api/response-cache';
import { withServerResponseCache } from '@/lib/api/server-response-cache';
import {
  fetchDefiLlamaFees,
  fetchDefiLlamaRevenue,
  fetchDefiLlamaProtocol,
  getDailyFeesChart,
  getCumulativeFeesChart,
  getDailyRevenueChart,
  getCumulativeRevenueChart,
  getDailyInflowsChart,
  getCumulativeInflowsChart,
  getTvlChart,
  getLatestTvl,
  getTvlByTokenSeries,
} from '@/lib/defillama/service';
import { unauthorizedUnlessAdmin } from '@/lib/auth/require-admin';
import { utcDayKeyFromTimestamp, utcTodayStartMs } from '@/lib/utils/utc-calendar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


type VaultTvlSeries = {
  name: string;
  address: string;
  data: Array<{ date: string; value: number }>;
};

function normalizeDailyPoints(
  raw: Array<{ x?: number; y?: number }>
): Array<{ date: string; value: number }> {
  const dayMap = new Map<string, { date: string; value: number; timestamp: number }>();

  for (const point of raw) {
    if (point.x == null || point.y == null) continue;
    const timestamp = point.x * 1000;
    const dateKey = utcDayKeyFromTimestamp(point.x);
    const existing = dayMap.get(dateKey);
    if (!existing || timestamp > existing.timestamp) {
      dayMap.set(dateKey, { date: dateKey, value: point.y, timestamp });
    }
  }

  return Array.from(dayMap.values())
    .map(({ date, value }) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function appendCurrentTvlPoint(
  dataPoints: Array<{ date: string; value: number }>,
  currentTvl: number
): Array<{ date: string; value: number }> {
  const today = utcDayKeyFromTimestamp(Math.floor(utcTodayStartMs() / 1000));

  if (dataPoints.length === 0) {
    return currentTvl > 0 ? [{ date: today, value: currentTvl }] : [];
  }

  const latest = dataPoints[dataPoints.length - 1];
  if (latest.date === today && Math.abs(latest.value - currentTvl) <= 0.01) {
    return dataPoints;
  }

  return [...dataPoints.filter((p) => p.date !== today), { date: today, value: currentTvl }];
}

/**
 * One vault's daily TVL (USD) from Morpho REST `state/history` (inception, daily) at today's
 * spot price: REST has no historical prices, so a non-stablecoin vault's past TVL moves with
 * today's price, not that day's. `'failed'` = a Morpho read errored (not a vault with no TVL).
 */
async function fetchVaultV2TvlSeries(address: string): Promise<VaultTvlSeries | null | 'failed'> {
  try {
    const [vault, state, points] = await Promise.all([
      getRestVault(BASE_CHAIN_ID, address),
      getRestVaultState(BASE_CHAIN_ID, address),
      morphoRestGet<Array<{ timestamp: number; total_assets?: string | null }>>(
        `/v0/vaults-v2/${morphoSelector(BASE_CHAIN_ID, address)}/state/history`,
        { lookback: 'inception' }
      ),
    ]);
    const price = await getRestTokenPriceUsd(BASE_CHAIN_ID, vault.asset.address);
    if (price === null) return 'failed';
    const decimals = vault.asset.decimals;
    const currentTvl = rawToNumber(state.total_assets, decimals) * price;
    let dataPoints = normalizeDailyPoints(
      (points ?? []).map((p) => ({ x: p.timestamp, y: rawToNumber(p.total_assets, decimals) * price }))
    );
    dataPoints = dataPoints.length
      ? appendCurrentTvlPoint(dataPoints, currentTvl)
      : currentTvl > 0
        ? [{ date: new Date().toISOString(), value: currentTvl }]
        : [];
    if (dataPoints.length === 0) return null;
    return {
      name: vaultDisplayName(vault.name, `Vault ${address.slice(0, 6)}...`),
      address: address.toLowerCase(),
      data: dataPoints,
    };
  } catch (error) {
    if (error instanceof MorphoRestError && error.status === 404) return null;
    logger.warn('Failed to fetch V2 vault TVL history', {
      address,
      error: error instanceof Error ? error.message : String(error),
    });
    return 'failed';
  }
}

function padSinglePointSeries(series: VaultTvlSeries): VaultTvlSeries {
  if (series.data.length !== 1) return series;
  const currentPoint = series.data[0];
  const thirtyDaysAgo = new Date(new Date(currentPoint.date).getTime() - DAYS_30_MS);
  return {
    ...series,
    data: [{ date: thirtyDaysAgo.toISOString(), value: currentPoint.value }, currentPoint],
  };
}

export async function GET(request: Request) {
  const denied = await unauthorizedUnlessAdmin(request);
  if (denied) return denied;
  const rateLimitMiddleware = createRateLimitMiddleware(
    RATE_LIMIT_REQUESTS_PER_MINUTE,
    MINUTE_MS
  );
  const rateLimitResult = rateLimitMiddleware(request);

  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      { status: 429, headers: rateLimitResult.headers }
    );
  }

  try {
    const stats = await withServerResponseCache('protocol-stats-v5', API_CACHE_MAX_AGE_MS, async () => {
    const businessVaults = getVaultAddressesForProtocolStats();
    const activeVaultsForStats = getActiveVaultAddressesForStats();
    const addresses = businessVaults.map((v) => getAddress(v.address));
    const activeVaults = activeVaultsForStats.length;

    // Partial data is reported, never silently summed: a failed vault would
    // otherwise lower protocol TVL and the trend with no sign anything is off.
    const failedSources: string[] = [];
    const keepSeries = (results: Array<VaultTvlSeries | null | 'failed'>, addrs: string[]) =>
      results.filter((v, i): v is VaultTvlSeries => {
        if (v === 'failed') failedSources.push(`TVL ${addrs[i]}`);
        return v != null && v !== 'failed';
      });

    const tvlByVaultResults = keepSeries(await Promise.all(addresses.map(fetchVaultV2TvlSeries)), addresses);

    const tvlByVault = tvlByVaultResults.map(padSinglePointSeries);

    const tvlByAddress = new Map<string, VaultTvlSeries>();
    for (const series of tvlByVaultResults) {
      tvlByAddress.set(series.address.toLowerCase(), series);
    }

    const activeVaultsList = activeVaultsForStats.map((cfg) => {
      const series = tvlByAddress.get(cfg.address.toLowerCase());
      const latest = series?.data[series.data.length - 1]?.value ?? 0;
      return {
        name: vaultDisplayName(series?.name || getConfiguredVaultDisplayName(cfg)),
        address: cfg.address.toLowerCase(),
        tvl: latest,
      };
    });

    const totalDeposited = tvlByVaultResults.reduce((sum, vault) => {
      const latest = vault.data[vault.data.length - 1];
      return sum + (latest?.value ?? 0);
    }, 0);

    let totalFeesGenerated = 0;
    let totalInterestGenerated = 0;

    // Aggregate the real series only: the synthetic T−30d point that
    // padSinglePointSeries adds for per-vault lines would show up here as a
    // one-day TVL spike that never happened.
    const tvlByDate = new Map<string, number>();
    for (const vault of tvlByVaultResults) {
      for (const point of vault.data) {
        const date = new Date(point.date);
        date.setUTCHours(0, 0, 0, 0);
        const dateKey = date.toISOString();
        tvlByDate.set(dateKey, (tvlByDate.get(dateKey) ?? 0) + point.value);
      }
    }

    let tvlTrend = Array.from(tvlByDate.entries())
      .map(([date, value]) => ({ date, value }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    logger.info('TVL trend aggregated from Morpho V2', {
      tvlPoints: tvlTrend.length,
      vaultsCount: tvlByVault.length,
    });

    let feesTrendDaily: Array<{ date: string; value: number }> = [];
    let feesTrendCumulative: Array<{ date: string; value: number }> = [];
    let revenueTrendDaily: Array<{ date: string; value: number }> = [];
    let revenueTrendCumulative: Array<{ date: string; value: number }> = [];
    let inflowsTrendDaily: Array<{ date: string; value: number }> = [];
    let inflowsTrendCumulative: Array<{ date: string; value: number }> = [];
    let tvlTrendDefillama: Array<{ date: string; value: number }> = [];
    let tvlByTokenDefillama: VaultTvlSeries[] = [];
    let defillamaTvl = 0;

    try {
      const [feesData, revenueData, protocolData] = await Promise.all([
        fetchDefiLlamaFees(),
        fetchDefiLlamaRevenue(),
        fetchDefiLlamaProtocol(),
      ]);

      if (feesData) {
        feesTrendDaily = getDailyFeesChart(feesData);
        feesTrendCumulative = getCumulativeFeesChart(feesData);
        if (feesData.totalAllTime) totalInterestGenerated = feesData.totalAllTime;
      }

      if (revenueData) {
        revenueTrendDaily = getDailyRevenueChart(revenueData);
        revenueTrendCumulative = getCumulativeRevenueChart(revenueData);
        if (revenueData.totalAllTime) totalFeesGenerated = revenueData.totalAllTime;
      }

      if (protocolData) {
        inflowsTrendDaily = getDailyInflowsChart(protocolData, feesData);
        inflowsTrendCumulative = getCumulativeInflowsChart(protocolData, feesData);
        tvlTrendDefillama = getTvlChart(protocolData);
        tvlByTokenDefillama = getTvlByTokenSeries(protocolData);
        defillamaTvl = getLatestTvl(protocolData);
      }
    } catch (error) {
      logger.error('Failed to fetch DefiLlama data', error as Error);
    }

    if (tvlTrend.length === 0) {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - DAYS_30_MS);
      tvlTrend = Array.from({ length: 30 }, (_, i) => {
        const date = new Date(thirtyDaysAgo.getTime() + (i * DAYS_30_MS) / 30);
        return { date: date.toISOString(), value: totalDeposited };
      });
      logger.warn('No TVL trend data from Morpho V2, using fallback placeholder');
    }

    const stats = {
      /** Set when some Morpho reads failed: totals are understated. */
      warning:
        failedSources.length > 0
          ? `Some Morpho data failed to load (${failedSources.join(', ')}); TVL may be understated.`
          : null,
      totalDeposited,
      totalFeesGenerated,
      activeVaults,
      totalInterestGenerated,
      tvlTrend,
      tvlByVault: tvlByVault.map((v) => ({
        name: v.name,
        address: v.address,
        data: v.data,
      })),
      tvlTrendDefillama,
      tvlByTokenDefillama,
      defillamaTvl,
      activeVaultsList,
      feesTrendDaily,
      feesTrendCumulative,
      revenueTrendDaily,
      revenueTrendCumulative,
      inflowsTrendDaily,
      inflowsTrendCumulative,
    };

    return stats;
    }, (result) => result.warning == null);

    const responseHeaders = mergeApiCacheHeaders(rateLimitResult.headers, 60);
    return NextResponse.json(stats, { headers: responseHeaders });
  } catch (err) {
    const { error, statusCode } = handleApiError(err, 'Failed to fetch protocol stats');
    return NextResponse.json(error, { status: statusCode });
  }
}
