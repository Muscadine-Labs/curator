import { NextResponse } from 'next/server';
import {
  getActiveVaultAddressesForStats,
  getConfiguredVaultDisplayName,
  getVaultAddressesForProtocolStats,
  isFeeWrapperAdapterAddress,
  withFeeWrapperLabel,
} from '@/lib/config/vaults';
import {
  BASE_CHAIN_ID,
  GRAPHQL_FIRST_LIMIT,
  DAYS_30_MS,
} from '@/lib/constants';
import { handleApiError } from '@/lib/utils/error-handler';
import { createRateLimitMiddleware, RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS } from '@/lib/utils/rate-limit';
import { morphoGraphQLClient } from '@/lib/morpho/graphql-client';
import { gql } from 'graphql-request';
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

const TVL_HISTORY_START = Math.floor(new Date('2024-06-01').getTime() / 1000);

type VaultTvlSeries = {
  name: string;
  address: string;
  data: Array<{ date: string; value: number }>;
};

const VAULT_V2_TVL_FIELDS = `
      name
      address
      performanceFee
      totalAssetsUsd
      asset { symbol address }
      historicalState {
        totalAssetsUsd(options: $options) {
          x
          y
        }
      }`;

const VAULT_V2_TVL_QUERY = gql`
  query VaultV2HistoricalTvl($address: String!, $chainId: Int!, $options: TimeseriesOptions) {
    vaultV2ByAddress(address: $address, chainId: $chainId) {${VAULT_V2_TVL_FIELDS}
    }
  }
`;

type VaultTvlGraph = {
  name?: string | null;
  address?: string | null;
  totalAssetsUsd?: number | null;
  historicalState?: { totalAssetsUsd?: Array<{ x?: number; y?: number }> | null } | null;
} | null;

function tvlHistoryOptions() {
  return {
    startTimestamp: TVL_HISTORY_START,
    endTimestamp: Math.floor(Date.now() / 1000),
    interval: 'DAY' as const,
  };
}

/** One query for every vault: `v0: vaultV2ByAddress(...)`, `v1: ...` (aliases keep the shape). */
function aliasedVaultQuery(
  name: string,
  count: number,
  fields: string,
  extraVars: string
): string {
  const vars = Array.from({ length: count }, (_, i) => `$a${i}: String!`).join(', ');
  const roots = Array.from(
    { length: count },
    (_, i) => `v${i}: vaultV2ByAddress(address: $a${i}, chainId: $chainId) {${fields}\n    }`
  ).join('\n    ');
  return `query ${name}(${vars}, $chainId: Int!${extraVars}) {\n    ${roots}\n  }`;
}

function aliasedVariables(addrs: readonly string[]): Record<string, string> {
  return Object.fromEntries(addrs.map((address, i) => [`a${i}`, address]));
}

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

/** `'failed'` = the Morpho request errored (distinct from a vault with no TVL). */
async function fetchVaultV2TvlSeries(address: string): Promise<VaultTvlSeries | null | 'failed'> {
  try {
    const result = await morphoGraphQLClient.request<{ vaultV2ByAddress?: VaultTvlGraph }>(
      VAULT_V2_TVL_QUERY,
      { address, chainId: BASE_CHAIN_ID, options: tvlHistoryOptions() }
    );
    return tvlSeriesFromGraph(address, result.vaultV2ByAddress ?? null);
  } catch (error) {
    logger.warn('Failed to fetch V2 vault TVL history', {
      address,
      error: error instanceof Error ? error.message : String(error),
    });
    return 'failed';
  }
}

/**
 * TVL series for many vaults in one Morpho request. If the batch fails (one bad vault fails
 * the whole query), fall back to one request per vault so each failure stays per vault.
 */
async function fetchVaultV2TvlSeriesBatch(
  addrs: readonly string[]
): Promise<Array<VaultTvlSeries | null | 'failed'>> {
  if (addrs.length <= 1) return Promise.all(addrs.map((a) => fetchVaultV2TvlSeries(a)));
  try {
    const query = aliasedVaultQuery(
      'VaultV2HistoricalTvlBatch',
      addrs.length,
      VAULT_V2_TVL_FIELDS,
      ', $options: TimeseriesOptions'
    );
    const result = await morphoGraphQLClient.request<Record<string, VaultTvlGraph>>(query, {
      ...aliasedVariables(addrs),
      chainId: BASE_CHAIN_ID,
      options: tvlHistoryOptions(),
    });
    return addrs.map((address, i) => tvlSeriesFromGraph(address, result[`v${i}`] ?? null));
  } catch (error) {
    logger.warn('Batched TVL history failed; fetching per vault', {
      error: error instanceof Error ? error.message : String(error),
    });
    return Promise.all(addrs.map((a) => fetchVaultV2TvlSeries(a)));
  }
}

function tvlSeriesFromGraph(address: string, vault: VaultTvlGraph): VaultTvlSeries | null {
    if (vault == null) return null;

    const currentTvl = vault.totalAssetsUsd ?? 0;
    let dataPoints: Array<{ date: string; value: number }> = [];

    if (vault.historicalState?.totalAssetsUsd?.length) {
      dataPoints = normalizeDailyPoints(vault.historicalState.totalAssetsUsd);
      dataPoints = appendCurrentTvlPoint(dataPoints, currentTvl);
    } else if (currentTvl > 0) {
      dataPoints = [{ date: new Date().toISOString(), value: currentTvl }];
    }

    if (dataPoints.length === 0) return null;

    return {
      name: withFeeWrapperLabel(
        vault.name || `Vault ${address.slice(0, 6)}...`,
        address
      ),
      address: address.toLowerCase(),
      data: dataPoints,
    };
}

const DEPOSITORS_FIELDS = `
      positions(first: $first, skip: $skip) {
        items {
          user {
            address
          }
        }
      }`;

const DEPOSITORS_QUERY = gql`
  query V2VaultDepositors($address: String!, $chainId: Int!, $first: Int!, $skip: Int!) {
    vaultV2ByAddress(address: $address, chainId: $chainId) {${DEPOSITORS_FIELDS}
    }
  }
`;

type DepositorsGraph = {
  positions?: {
    items?: Array<{ user?: { address?: string | null } | null } | null> | null;
  } | null;
} | null;

/**
 * Depositors for many vaults: the first page of every vault in one request, then the rest
 * page by page only for vaults that filled it. Each entry is the addresses, or an Error when
 * that vault's read failed. A failed batch falls back to one request per vault.
 */
async function fetchDepositorAddressesBatch(
  addrs: readonly string[]
): Promise<Array<string[] | Error>> {
  const perVault = (address: string) =>
    fetchAllDepositorAddresses(address).catch((error: unknown) =>
      error instanceof Error ? error : new Error(String(error))
    );
  if (addrs.length <= 1) return Promise.all(addrs.map(perVault));
  let firstPages: Record<string, DepositorsGraph>;
  try {
    firstPages = await morphoGraphQLClient.request<Record<string, DepositorsGraph>>(
      aliasedVaultQuery('V2VaultDepositorsBatch', addrs.length, DEPOSITORS_FIELDS, ', $first: Int!, $skip: Int!'),
      { ...aliasedVariables(addrs), chainId: BASE_CHAIN_ID, first: GRAPHQL_FIRST_LIMIT, skip: 0 }
    );
  } catch (error) {
    logger.warn('Batched depositors read failed; fetching per vault', {
      error: error instanceof Error ? error.message : String(error),
    });
    return Promise.all(addrs.map(perVault));
  }
  return Promise.all(
    addrs.map(async (address, i) => {
      const items = firstPages[`v${i}`]?.positions?.items ?? [];
      const first = items.flatMap((item) => (item?.user?.address ? [item.user.address] : []));
      if (items.length < GRAPHQL_FIRST_LIMIT) return first;
      try {
        return [...first, ...(await fetchAllDepositorAddresses(address, GRAPHQL_FIRST_LIMIT))];
      } catch (error) {
        return error instanceof Error ? error : new Error(String(error));
      }
    })
  );
}

/** Every depositor address, paging past the 1,000-row GraphQL limit. Throws on failure. */
async function fetchAllDepositorAddresses(address: string, startSkip = 0): Promise<string[]> {
  const out: string[] = [];
  for (let skip = startSkip; skip < MAX_DEPOSITOR_ROWS; skip += GRAPHQL_FIRST_LIMIT) {
    const result = await morphoGraphQLClient.request<{
      vaultV2ByAddress?: {
        positions?: {
          items?: Array<{ user?: { address?: string | null } | null } | null> | null;
        } | null;
      } | null;
    }>(DEPOSITORS_QUERY, { address, chainId: BASE_CHAIN_ID, first: GRAPHQL_FIRST_LIMIT, skip });
    const items = result.vaultV2ByAddress?.positions?.items ?? [];
    for (const item of items) {
      if (item?.user?.address) out.push(item.user.address);
    }
    if (items.length < GRAPHQL_FIRST_LIMIT) break;
  }
  return out;
}

/** Safety bound on depositor paging (10 pages). */
const MAX_DEPOSITOR_ROWS = 10_000;

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
    const stats = await withServerResponseCache('protocol-stats-v4', API_CACHE_MAX_AGE_MS, async () => {
    const businessVaults = getVaultAddressesForProtocolStats();
    const activeVaultsForStats = getActiveVaultAddressesForStats();
    const addresses = businessVaults.map((v) => getAddress(v.address));
    const activeAddresses = activeVaultsForStats.map((v) => getAddress(v.address));
    const activeVaults = activeVaultsForStats.length;

    // Partial data is reported, never silently summed: a failed vault would
    // otherwise lower protocol TVL and the trend with no sign anything is off.
    const failedSources: string[] = [];
    const keepSeries = (results: Array<VaultTvlSeries | null | 'failed'>, addrs: string[]) =>
      results.filter((v, i): v is VaultTvlSeries => {
        if (v === 'failed') failedSources.push(`TVL ${addrs[i]}`);
        return v != null && v !== 'failed';
      });

    const wrapperConfigs = activeVaultsForStats.filter((v) => v.kind === 'feeWrapper');
    const wrapperAddresses = wrapperConfigs.map((v) => getAddress(v.address));
    // Business vaults and wrappers in one Morpho request (was one request per vault).
    const allTvlResults = await fetchVaultV2TvlSeriesBatch([...addresses, ...wrapperAddresses]);
    const tvlByVaultResults = keepSeries(allTvlResults.slice(0, addresses.length), addresses);

    const tvlByVault = tvlByVaultResults.map(padSinglePointSeries);

    const wrapperSeries = keepSeries(allTvlResults.slice(addresses.length), wrapperAddresses);

    const tvlByAddress = new Map<string, VaultTvlSeries>();
    for (const series of [...tvlByVaultResults, ...wrapperSeries]) {
      tvlByAddress.set(series.address.toLowerCase(), series);
    }

    const activeVaultsList = activeVaultsForStats.map((cfg) => {
      const series = tvlByAddress.get(cfg.address.toLowerCase());
      const latest = series?.data[series.data.length - 1]?.value ?? 0;
      return {
        name: withFeeWrapperLabel(
          series?.name || getConfiguredVaultDisplayName(cfg),
          cfg.address
        ),
        address: cfg.address.toLowerCase(),
        tvl: latest,
        kind: cfg.kind ?? 'strategy',
      };
    });

    const totalDeposited = tvlByVaultResults.reduce((sum, vault) => {
      const latest = vault.data[vault.data.length - 1];
      return sum + (latest?.value ?? 0);
    }, 0);

    let totalFeesGenerated = 0;
    let totalInterestGenerated = 0;

    const uniqueUsers = new Set<string>();
    const v2UserResults = (await fetchDepositorAddressesBatch(activeAddresses)).map(
      (result, i) => {
        if (!(result instanceof Error)) return result;
        failedSources.push(`users ${activeAddresses[i]}`);
        logger.warn('Failed to fetch V2 vault depositors', {
          address: activeAddresses[i],
          error: result.message,
        });
        return [];
      }
    );

    for (const items of v2UserResults) {
      for (const address of items) {
        const userAddress = address.toLowerCase();
        if (
          userAddress &&
          userAddress !== '0x0000000000000000000000000000000000000000' &&
          userAddress !== '0x000000000000000000000000000000000000dead' &&
          !isFeeWrapperAdapterAddress(userAddress)
        ) {
          uniqueUsers.add(userAddress);
        }
      }
    }

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
      /** Set when some Morpho reads failed: totals and users are understated. */
      warning:
        failedSources.length > 0
          ? `Some Morpho data failed to load (${failedSources.join(', ')}); TVL and user counts may be understated.`
          : null,
      totalDeposited,
      totalFeesGenerated,
      activeVaults,
      totalInterestGenerated,
      users: uniqueUsers.size,
      tvlTrend,
      tvlByVault: tvlByVault.map((v) => ({
        name: withFeeWrapperLabel(v.name, v.address),
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
