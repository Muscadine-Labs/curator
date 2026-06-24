import { NextResponse } from 'next/server';
import {
  getActiveVaultAddressesForStats,
  getVaultAddressesForBusinessViews,
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
} from '@/lib/defillama/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TVL_HISTORY_START = Math.floor(new Date('2024-06-01').getTime() / 1000);

type VaultTvlSeries = {
  name: string;
  address: string;
  data: Array<{ date: string; value: number }>;
};

const VAULT_V2_TVL_QUERY = gql`
  query VaultV2HistoricalTvl($address: String!, $chainId: Int!, $options: TimeseriesOptions) {
    vaultV2ByAddress(address: $address, chainId: $chainId) {
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
      }
    }
  }
`;

function normalizeDailyPoints(
  raw: Array<{ x?: number; y?: number }>
): Array<{ date: string; value: number }> {
  const dayMap = new Map<string, { date: string; value: number; timestamp: number }>();

  for (const point of raw) {
    if (point.x == null || point.y == null) continue;
    const pointDate = new Date(point.x * 1000);
    const normalized = new Date(pointDate);
    normalized.setHours(0, 0, 0, 0);
    const dateKey = normalized.toISOString();
    const existing = dayMap.get(dateKey);
    if (!existing || pointDate.getTime() > existing.timestamp) {
      dayMap.set(dateKey, { date: dateKey, value: point.y, timestamp: pointDate.getTime() });
    }
  }

  return Array.from(dayMap.values())
    .map(({ date, value }) => ({ date, value }))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

function appendCurrentTvlPoint(
  dataPoints: Array<{ date: string; value: number }>,
  currentTvl: number
): Array<{ date: string; value: number }> {
  const normalizedCurrentDate = new Date();
  normalizedCurrentDate.setHours(0, 0, 0, 0);
  const today = normalizedCurrentDate.toISOString();

  if (dataPoints.length === 0) {
    return currentTvl > 0 ? [{ date: today, value: currentTvl }] : [];
  }

  const latest = dataPoints[dataPoints.length - 1];
  if (latest.date === today && Math.abs(latest.value - currentTvl) <= 0.01) {
    return dataPoints;
  }

  return [...dataPoints.filter((p) => p.date !== today), { date: today, value: currentTvl }];
}

async function fetchVaultV2TvlSeries(address: string): Promise<VaultTvlSeries | null> {
  try {
    const options = {
      startTimestamp: TVL_HISTORY_START,
      endTimestamp: Math.floor(Date.now() / 1000),
      interval: 'DAY' as const,
    };

    const result = await morphoGraphQLClient.request<{
      vaultV2ByAddress?: {
        name?: string | null;
        address?: string | null;
        totalAssetsUsd?: number | null;
        historicalState?: { totalAssetsUsd?: Array<{ x?: number; y?: number }> | null } | null;
      } | null;
    }>(VAULT_V2_TVL_QUERY, { address, chainId: BASE_CHAIN_ID, options });

    const vault = result.vaultV2ByAddress;
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
      name: vault.name || `Vault ${address.slice(0, 6)}...`,
      address: address.toLowerCase(),
      data: dataPoints,
    };
  } catch (error) {
    logger.warn('Failed to fetch V2 vault TVL history', {
      address,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
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
    const stats = await withServerResponseCache('protocol-stats-v2', API_CACHE_MAX_AGE_MS, async () => {
    const businessVaults = getVaultAddressesForBusinessViews();
    const activeVaultsForStats = getActiveVaultAddressesForStats();
    const addresses = businessVaults.map((v) => getAddress(v.address));
    const activeAddresses = activeVaultsForStats.map((v) => getAddress(v.address));
    const activeVaults = activeVaultsForStats.length;

    const tvlByVaultResults = (
      await Promise.all(addresses.map((address) => fetchVaultV2TvlSeries(address)))
    ).filter((v): v is VaultTvlSeries => v !== null);

    const tvlByVault = tvlByVaultResults.map(padSinglePointSeries);

    let totalDeposited = tvlByVaultResults.reduce((sum, vault) => {
      const latest = vault.data[vault.data.length - 1];
      return sum + (latest?.value ?? 0);
    }, 0);

    let totalFeesGenerated = 0;
    let totalInterestGenerated = 0;

    const uniqueUsers = new Set<string>();
    const v2UserResults = await Promise.all(
      activeAddresses.map(async (address) => {
        try {
          const usersQuery = gql`
            query V2VaultDepositors($address: String!, $chainId: Int!) {
              vaultV2ByAddress(address: $address, chainId: $chainId) {
                positions(first: ${GRAPHQL_FIRST_LIMIT}) {
                  items {
                    user { address }
                  }
                }
              }
            }
          `;
          const result = await morphoGraphQLClient.request<{
            vaultV2ByAddress?: {
              positions?: {
                items?: Array<{ user?: { address?: string | null } | null } | null> | null;
              } | null;
            } | null;
          }>(usersQuery, { address, chainId: BASE_CHAIN_ID });
          return result.vaultV2ByAddress?.positions?.items ?? [];
        } catch {
          return [];
        }
      })
    );

    for (const items of v2UserResults) {
      for (const pos of items) {
        const userAddress = pos?.user?.address?.toLowerCase();
        if (userAddress) uniqueUsers.add(userAddress);
      }
    }

    const tvlByDate = new Map<string, number>();
    for (const vault of tvlByVault) {
      for (const point of vault.data) {
        const date = new Date(point.date);
        date.setHours(0, 0, 0, 0);
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
      totalDeposited,
      totalFeesGenerated,
      activeVaults,
      totalInterestGenerated,
      users: uniqueUsers.size,
      tvlTrend,
      tvlByVault: tvlByVault.map((v) => ({
        name: v.name,
        address: v.address,
        data: v.data,
      })),
      feesTrendDaily,
      feesTrendCumulative,
      revenueTrendDaily,
      revenueTrendCumulative,
      inflowsTrendDaily,
      inflowsTrendCumulative,
    };

    return stats;
    });

    const responseHeaders = mergeApiCacheHeaders(rateLimitResult.headers, 60);
    return NextResponse.json(stats, { headers: responseHeaders });
  } catch (err) {
    const { error, statusCode } = handleApiError(err, 'Failed to fetch protocol stats');
    return NextResponse.json(error, { status: statusCode });
  }
}
