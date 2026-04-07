import { NextResponse } from 'next/server';
import { getVaultAddressesForBusinessViews } from '@/lib/config/vaults';
import { 
  BASE_CHAIN_ID, 
  GRAPHQL_FIRST_LIMIT,
  DAYS_30_MS,
  getDaysAgoTimestamp,
} from '@/lib/constants';
import { handleApiError } from '@/lib/utils/error-handler';
import { createRateLimitMiddleware, RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS } from '@/lib/utils/rate-limit';
import { morphoGraphQLClient } from '@/lib/morpho/graphql-client';
import { gql } from 'graphql-request';
import { getAddress } from 'viem';
import type { Vault, VaultPosition, Maybe } from '@morpho-org/blue-api-sdk';
import { logger } from '@/lib/utils/logger';
import { 
  fetchDefiLlamaFees, 
  fetchDefiLlamaRevenue,
  fetchDefiLlamaProtocol,
  getDailyFeesChart,
  getCumulativeFeesChart,
  getDailyRevenueChart,
  getCumulativeRevenueChart,
  getDailyInflowsChart,
  getCumulativeInflowsChart 
} from '@/lib/defillama/service';

// Ensure Node.js runtime for API routes (required for external API calls)
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Type-safe response matching our query structure
type ProtocolStatsQueryResponse = {
  vaults: {
    items: Maybe<Vault>[] | null;
  } | null;
  vaultPositions: {
    items: Maybe<VaultPosition>[] | null;
  } | null;
};

export async function GET(request: Request) {
  // Rate limiting
  const rateLimitMiddleware = createRateLimitMiddleware(
    RATE_LIMIT_REQUESTS_PER_MINUTE,
    MINUTE_MS
  );
  const rateLimitResult = rateLimitMiddleware(request);
  
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      { 
        status: 429,
        headers: rateLimitResult.headers,
      }
    );
  }

  try {
    const businessVaults = getVaultAddressesForBusinessViews();
    const addresses = businessVaults.map((v) => getAddress(v.address));

    const query = gql`
      query FetchProtocolStats($addresses: [String!]) {
        vaults(
          first: ${GRAPHQL_FIRST_LIMIT}
          where: { address_in: $addresses, chainId_in: [${BASE_CHAIN_ID}] }
        ) {
          items {
            address
            state { 
              totalAssetsUsd
              fee
            }
          }
        }

        vaultPositions(
          first: ${GRAPHQL_FIRST_LIMIT}
          where: { vaultAddress_in: $addresses }
        ) {
          items {
            vault { address }
            user { address }
          }
        }
      }
    `;

    const data = await morphoGraphQLClient.request<ProtocolStatsQueryResponse>(
      query,
      { addresses }
    );

    const morphoVaults = data.vaults?.items?.filter((v): v is Vault => v !== null) ?? [];
    const positions = data.vaultPositions?.items?.filter((p): p is VaultPosition => p !== null) ?? [];

    // Calculate totalDeposited from V1 vaults (from main query)
    let totalDeposited = morphoVaults.reduce((sum, v) => sum + (v.state?.totalAssetsUsd ?? 0), 0);
    const activeVaults = businessVaults.length;

    // Create a map of V1 vault current TVL for fallback
    const v1VaultCurrentTvl = new Map<string, number>();
    morphoVaults.forEach(v => {
      if (v.address && v.state?.totalAssetsUsd != null) {
        v1VaultCurrentTvl.set(v.address.toLowerCase(), v.state.totalAssetsUsd);
      }
    });
    
    logger.info('V1 vaults from main query', {
      totalMorphoVaults: morphoVaults.length,
      vaultAddresses: morphoVaults.map(v => v.address?.toLowerCase()),
      v1VaultCurrentTvlMap: Array.from(v1VaultCurrentTvl.entries()),
      allAddresses: addresses.map(a => a.toLowerCase()),
      totalAddresses: addresses.length,
    });
    
    // Ensure all V1 vaults from main query are included in results
    // This is a safeguard in case individual queries fail
    const v1VaultsFromMainQuery = new Set(morphoVaults.map(v => v.address?.toLowerCase()).filter((a): a is string => !!a));

    // Fetch historical TVL data per vault (V1 has historical, V2 has current only)
    // Also collect V2 performance fees for revenue calculation and asset information
    // Note: V2 vaults will be added to totalDeposited below
    const tvlByVaultPromises = addresses.map(async (address) => {
      try {
        // First check if it's a V1 vault (from main query) - prioritize V1 since we know they exist
        const currentTvl = v1VaultCurrentTvl.get(address.toLowerCase());
        const isV1VaultFromMainQuery = currentTvl != null;
        
        if (isV1VaultFromMainQuery) {
          // This is definitely a V1 vault, fetch historical data directly
          logger.info('V1 vault detected from main query, fetching historical data', {
            address,
            currentTvl,
          });
          
          try {
            const historicalQuery = gql`
              query VaultHistoricalTvl($address: String!, $chainId: Int!, $options: TimeseriesOptions) {
                vault: vaultByAddress(address: $address, chainId: $chainId) {
                  name
                  address
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
            // Fetch historical data from June 2024 (when vaults started) to now
            const june2024Timestamp = Math.floor(new Date('2024-06-01').getTime() / 1000);
            const histResult = await morphoGraphQLClient.request<{ vault?: { name?: string; address?: string; asset?: { symbol?: string; address?: string } | null; historicalState?: { totalAssetsUsd?: Array<{ x?: number; y?: number }> } } | null }>(historicalQuery, {
              address,
              chainId: BASE_CHAIN_ID,
              options: {
                startTimestamp: june2024Timestamp, // Historical data from June 2024
                endTimestamp: Math.floor(Date.now() / 1000),
                interval: 'DAY'
              }
            });
            
            if (histResult.vault?.historicalState?.totalAssetsUsd) {
              const rawDataPoints = histResult.vault.historicalState.totalAssetsUsd;
              
              logger.info('V1 vault historical data fetched', {
                address,
                name: histResult.vault.name || 'Unknown',
                rawDataPoints: rawDataPoints.length,
              });
              
              let dataPoints = rawDataPoints.map(point => ({
                date: point.x ? new Date(point.x * 1000).toISOString() : '',
                value: point.y || 0,
              })).filter(p => p.date);
              
              // Normalize all data points to start of day and deduplicate
              const dayMap = new Map<string, { date: string; value: number; timestamp: number }>();
              dataPoints.forEach(point => {
                const pointDate = new Date(point.date);
                const normalizedDate = new Date(pointDate);
                normalizedDate.setHours(0, 0, 0, 0);
                const dateKey = normalizedDate.toISOString();
                
                const existing = dayMap.get(dateKey);
                if (!existing || pointDate.getTime() > existing.timestamp) {
                  dayMap.set(dateKey, {
                    date: dateKey,
                    value: point.value,
                    timestamp: pointDate.getTime(),
                  });
                }
              });
              
              dataPoints = Array.from(dayMap.values()).map(({ date, value }) => ({ date, value }));
              
              // Normalize current date to start of day
              const normalizedCurrentDate = new Date();
              normalizedCurrentDate.setHours(0, 0, 0, 0);
              const normalizedCurrentDateStr = normalizedCurrentDate.toISOString();
              
              // Add current TVL if latest point is a different day or value differs significantly
              if (dataPoints.length > 0) {
                const latestPoint = dataPoints[dataPoints.length - 1];
                
                // Only add if it's a different day or value differs significantly
                if (latestPoint.date !== normalizedCurrentDateStr || Math.abs(latestPoint.value - (currentTvl ?? latestPoint.value)) > 0.01) {
                  // Remove existing point for today if it exists
                  dataPoints = dataPoints.filter(p => p.date !== normalizedCurrentDateStr);
                  dataPoints.push({
                    date: normalizedCurrentDateStr,
                    value: currentTvl ?? latestPoint.value,
                  });
                }
              } else if (currentTvl != null) {
                // No historical data, but we have current TVL - use it
                dataPoints.push({
                  date: normalizedCurrentDateStr,
                  value: currentTvl,
                });
              }
              
              if (dataPoints.length > 0) {
                const vaultName = histResult.vault?.name || `Vault ${address.slice(0, 6)}...`;
                logger.info('V1 vault returning data', {
                  address,
                  name: vaultName,
                  dataPoints: dataPoints.length,
                });
                return {
                  name: vaultName,
                  address: address.toLowerCase(),
                  data: dataPoints,
                  performanceFee: null, // V1 vaults don't contribute performanceFee here
                };
              }
            }
            
            // Fallback to current TVL if historical query didn't return data
            if (currentTvl != null) {
              const vaultName = histResult.vault?.name || `Vault ${address.slice(0, 6)}...`;
              logger.info('V1 vault using current TVL fallback', {
                address,
                name: vaultName,
                currentTvl,
              });
              return {
                name: vaultName,
                address: address.toLowerCase(),
                data: [{
                  date: new Date().toISOString(),
                  value: currentTvl,
                }],
                performanceFee: null,
              };
            }
          } catch (histError) {
            logger.warn('Failed to fetch V1 vault historical data', {
              address,
              error: histError instanceof Error ? histError.message : String(histError),
            });
            // Fallback to current TVL if available
            if (currentTvl != null) {
              logger.info('V1 vault using error fallback current TVL', {
                address,
                currentTvl,
              });
              return {
                name: `Vault ${address.slice(0, 6)}...`,
                address: address.toLowerCase(),
                data: [{
                  date: new Date().toISOString(),
                  value: currentTvl,
                }],
                performanceFee: null,
              };
            }
          }
        }
        
        // If not a V1 vault from main query, check if it's a V2 vault
        const v2CheckQuery = gql`
          query CheckV2Vault($address: String!, $chainId: Int!, $options: TimeseriesOptions) {
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
        // Fetch historical data from June 2024 (when vaults started) to now
        const june2024Timestamp = Math.floor(new Date('2024-06-01').getTime() / 1000);
        const v2Result = await morphoGraphQLClient.request<{ vaultV2ByAddress?: { name?: string; address?: string; performanceFee?: number; totalAssetsUsd?: number; asset?: { symbol?: string; address?: string } | null; historicalState?: { totalAssetsUsd?: Array<{ x?: number; y?: number }> } } | null }>(v2CheckQuery, { 
          address, 
          chainId: BASE_CHAIN_ID,
          options: {
            startTimestamp: june2024Timestamp, // Historical data from June 2024
            endTimestamp: Math.floor(Date.now() / 1000),
            interval: 'DAY'
          }
        });
        
        // Check if V2 vault exists (not null/undefined), even if name is missing
        if (v2Result.vaultV2ByAddress !== null && v2Result.vaultV2ByAddress !== undefined) {
          // This is a V2 vault
          const currentDate = new Date().toISOString();
          const currentTvl = v2Result.vaultV2ByAddress.totalAssetsUsd ?? 0;
          
          // Try to use historical data if available
          let dataPoints: Array<{ date: string; value: number }> = [];
          
          if (v2Result.vaultV2ByAddress.historicalState?.totalAssetsUsd && v2Result.vaultV2ByAddress.historicalState.totalAssetsUsd.length > 0) {
            // V2 vault has historical data
            const rawDataPoints = v2Result.vaultV2ByAddress.historicalState.totalAssetsUsd;
            dataPoints = rawDataPoints.map(point => ({
              date: point.x ? new Date(point.x * 1000).toISOString() : '',
              value: point.y || 0,
            })).filter(p => p.date);
            
            // Normalize all existing data points to start of day
            const normalizedPoints = dataPoints.map(point => {
              const pointDate = new Date(point.date);
              pointDate.setHours(0, 0, 0, 0);
              return {
                date: pointDate.toISOString(),
                value: point.value,
              };
            });
            
            // Deduplicate by date, keeping the latest value for each day
            const dayMap = new Map<string, { date: string; value: number; timestamp: number }>();
            normalizedPoints.forEach(point => {
              const pointDate = new Date(point.date);
              const existing = dayMap.get(point.date);
              if (!existing || pointDate.getTime() > existing.timestamp) {
                dayMap.set(point.date, {
                  date: point.date,
                  value: point.value,
                  timestamp: pointDate.getTime(),
                });
              }
            });
            
            dataPoints = Array.from(dayMap.values()).map(({ date, value }) => ({ date, value }));
            
            // Normalize current date to start of day
            const normalizedCurrentDate = new Date();
            normalizedCurrentDate.setHours(0, 0, 0, 0);
            const normalizedCurrentDateStr = normalizedCurrentDate.toISOString();
            
            // Add current TVL if latest point is a different day or value differs significantly
            if (dataPoints.length > 0) {
              const latestPoint = dataPoints[dataPoints.length - 1];
              
              // Only add if it's a different day or value differs significantly
              if (latestPoint.date !== normalizedCurrentDateStr || Math.abs(latestPoint.value - currentTvl) > 0.01) {
                // Remove existing point for today if it exists
                dataPoints = dataPoints.filter(p => p.date !== normalizedCurrentDateStr);
                dataPoints.push({
                  date: normalizedCurrentDateStr,
                  value: currentTvl,
                });
              }
            } else if (currentTvl > 0) {
              // No historical data but we have current TVL
              dataPoints.push({
                date: normalizedCurrentDateStr,
                value: currentTvl,
              });
            }
          } else if (currentTvl > 0) {
            // No historical data available, use current TVL as single point
            dataPoints = [{
              date: currentDate,
              value: currentTvl,
            }];
          }
          
          return {
            name: v2Result.vaultV2ByAddress.name || `V2 Vault ${address.slice(0, 6)}...`,
            address: address.toLowerCase(),
            data: dataPoints,
            performanceFee: v2Result.vaultV2ByAddress.performanceFee ?? null,
          };
        }
        
        // If we get here, it's neither a V1 vault (from main query) nor a V2 vault
        // This shouldn't happen for configured vaults, but log it for debugging
        logger.debug('Address is neither V1 (from main query) nor V2 vault', {
          address,
          hasCurrentTvl: v1VaultCurrentTvl.has(address.toLowerCase()),
        });
      } catch (error) {
        // Log error for debugging but don't fail the entire request
        logger.warn('Failed to fetch TVL data for vault', {
          address,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return null;
    });

    const tvlByVaultResults = await Promise.all(tvlByVaultPromises);
    
    // Ensure all V1 vaults from main query are included
    // Add any missing V1 vaults that weren't returned from individual queries
    const includedAddresses = new Set(
      tvlByVaultResults
        .filter((v): v is NonNullable<typeof v> => v !== null)
        .map(v => v.address.toLowerCase())
    );
    
    const missingV1Vaults = Array.from(v1VaultsFromMainQuery).filter(
      addr => !includedAddresses.has(addr)
    );
    
    if (missingV1Vaults.length > 0) {
      logger.warn('Some V1 vaults from main query were not included in results', {
        missingAddresses: missingV1Vaults,
        totalMissing: missingV1Vaults.length,
      });
      
      // Add missing V1 vaults with current TVL
      for (const address of missingV1Vaults) {
        const currentTvl = v1VaultCurrentTvl.get(address);
        if (currentTvl != null) {
          tvlByVaultResults.push({
            name: `Vault ${address.slice(0, 6)}...`,
            address: address.toLowerCase(),
            data: [{
              date: new Date().toISOString(),
              value: currentTvl,
            }],
            performanceFee: null,
          });
          logger.info('Added missing V1 vault with current TVL', {
            address,
            currentTvl,
          });
        }
      }
    }
    
    // Extract TVL data (remove performanceFee field)
    // Include all vaults with at least 1 data point (V1 with historical, V2 with current)
    // For V2 vaults with only 1 data point, create a second point 30 days ago for better chart display
    // V1 vaults with historical data (2+ points) will show trends, V2 vaults will show current value
    
    // Include all vaults with at least 1 data point
    // For V2 vaults with only 1 point, create a second point 30 days ago for better chart display
    const tvlByVault = tvlByVaultResults
      .filter((v): v is NonNullable<typeof v> => {
        if (!v || v.data.length < 1) {
          if (v) {
            logger.debug('Vault filtered out (no data points)', {
              name: v.name,
              address: v.address,
              dataPoints: v.data.length,
            });
          }
          return false;
        }
        return true;
      })
      .map((v) => {
        // For V2 vaults with only 1 data point, add a second point 30 days ago for better chart visualization
        if (v.data.length === 1 && v.performanceFee !== null && v.performanceFee !== undefined) {
          const currentPoint = v.data[0];
          const thirtyDaysAgo = new Date(new Date(currentPoint.date).getTime() - DAYS_30_MS);
          return {
            name: v.name,
            address: v.address,
            data: [
              {
                date: thirtyDaysAgo.toISOString(),
                value: currentPoint.value, // Use same value for flat line
              },
              currentPoint,
            ],
          };
        }
        // Remove performanceFee field for response (only needed internally for V2 identification)
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { performanceFee: _performanceFee, ...rest } = v;
        return rest;
      });
    
    // Add V2 vault TVL to totalDeposited
    // V2 vaults are identified by having performanceFee !== null
    const v2VaultTvl = tvlByVaultResults
      .filter((v): v is NonNullable<typeof v> => 
        v !== null && 
        v.performanceFee !== null && 
        v.performanceFee !== undefined
      )
      .reduce((sum, v) => {
        // Get the latest data point (last in array)
        const latestPoint = v.data[v.data.length - 1];
        return sum + (latestPoint?.value ?? 0);
      }, 0);
    totalDeposited += v2VaultTvl;
    
    // Initialize totals (will be updated from DefiLlama if available)
    let totalFeesGenerated = 0;
    let totalInterestGenerated = 0;

    // Unique depositors across our vaults
    const uniqueUsers = new Set<string>();
    for (const p of positions) {
      const userAddress = p.user?.address?.toLowerCase();
      if (userAddress) {
        uniqueUsers.add(userAddress);
      }
    }

    // Aggregate TVL trend from all vaults' historical data (from Morpho QL)
    // Group all vault data points by date and sum TVL values
    const tvlByDate = new Map<string, number>();
    
    for (const vault of tvlByVault) {
      for (const point of vault.data) {
        // Normalize date to start of day for consistent grouping
        const date = new Date(point.date);
        date.setHours(0, 0, 0, 0);
        const dateKey = date.toISOString();
        
        const currentValue = tvlByDate.get(dateKey) || 0;
        tvlByDate.set(dateKey, currentValue + point.value);
      }
    }
    
    // Convert to sorted array format
    let tvlTrend: Array<{ date: string; value: number }> = Array.from(tvlByDate.entries())
      .map(([date, value]) => ({ date, value }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    logger.info('TVL trend aggregated from Morpho QL', {
      tvlPoints: tvlTrend.length,
      vaultsCount: tvlByVault.length,
      totalVaultDataPoints: tvlByVault.reduce((sum, v) => sum + v.data.length, 0),
    });
    
    // Fetch DefiLlama data for charts (fees, revenue, inflows - but NOT TVL)
    let feesTrendDaily: Array<{ date: string; value: number }> = [];
    let feesTrendCumulative: Array<{ date: string; value: number }> = [];
    let revenueTrendDaily: Array<{ date: string; value: number }> = [];
    let revenueTrendCumulative: Array<{ date: string; value: number }> = [];
    let inflowsTrendDaily: Array<{ date: string; value: number }> = [];
    let inflowsTrendCumulative: Array<{ date: string; value: number }> = [];
    
    try {
      // Fetch DefiLlama fees, revenue, and protocol data in parallel
      const [feesData, revenueData, protocolData] = await Promise.all([
        fetchDefiLlamaFees(),
        fetchDefiLlamaRevenue(),
        fetchDefiLlamaProtocol(),
      ]);
      
      if (feesData) {
        // Get daily and cumulative fees (interest generated)
        feesTrendDaily = getDailyFeesChart(feesData);
        feesTrendCumulative = getCumulativeFeesChart(feesData);
        
        // Update total interest generated from DefiLlama
        if (feesData.totalAllTime) {
          totalInterestGenerated = feesData.totalAllTime;
        }
        
        logger.info('DefiLlama fees data loaded', {
          totalAllTime: feesData.totalAllTime,
          chartPointsDaily: feesTrendDaily.length,
          chartPointsCumulative: feesTrendCumulative.length,
        });
      }
      
      if (revenueData) {
        // Get daily and cumulative revenue directly from DefiLlama revenue API
        revenueTrendDaily = getDailyRevenueChart(revenueData);
        revenueTrendCumulative = getCumulativeRevenueChart(revenueData);
        
        // Update total revenue generated from DefiLlama
        if (revenueData.totalAllTime) {
          totalFeesGenerated = revenueData.totalAllTime;
        }
        
        logger.info('DefiLlama revenue data loaded', {
          totalAllTime: revenueData.totalAllTime,
          chartPointsDaily: revenueTrendDaily.length,
          chartPointsCumulative: revenueTrendCumulative.length,
        });
      }
      
      if (protocolData) {
        // Get daily and cumulative inflows charts from TVL changes
        // Pass fees data to properly calculate net inflows (excluding performance gains)
        inflowsTrendDaily = getDailyInflowsChart(protocolData, feesData);
        inflowsTrendCumulative = getCumulativeInflowsChart(protocolData, feesData);
        
        logger.info('DefiLlama protocol data loaded (for inflows only)', {
          inflowPointsDaily: inflowsTrendDaily.length,
          inflowPointsCumulative: inflowsTrendCumulative.length,
        });
      }
    } catch (error) {
      logger.error('Failed to fetch DefiLlama data', error as Error);
    }
    
    // Fallback to placeholder if no Morpho QL TVL data
    if (tvlTrend.length === 0) {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - DAYS_30_MS);
      tvlTrend = Array.from({ length: 30 }, (_, i) => {
        const date = new Date(thirtyDaysAgo.getTime() + i * DAYS_30_MS / 30);
        return { date: date.toISOString(), value: totalDeposited };
      });
      logger.warn('No TVL trend data from Morpho QL, using fallback placeholder');
    }

    const stats = {
      totalDeposited,
      totalFeesGenerated,
      activeVaults,
      totalInterestGenerated,
      users: uniqueUsers.size,
      tvlTrend,
      tvlByVault: tvlByVault.map(v => ({
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

    const responseHeaders = new Headers(rateLimitResult.headers);
    responseHeaders.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');

    return NextResponse.json(stats, { headers: responseHeaders });
  } catch (err) {
    const { error, statusCode } = handleApiError(err, 'Failed to fetch protocol stats');
    return NextResponse.json(error, { status: statusCode });
  }
}


