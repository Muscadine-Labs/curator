import { NextResponse } from 'next/server';
import { getVaultAddressesForBusinessViews } from '@/lib/config/vaults';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { handleApiError } from '@/lib/utils/error-handler';
import { createRateLimitMiddleware, RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS } from '@/lib/utils/rate-limit';
import { morphoGraphQLClient } from '@/lib/morpho/graphql-client';
import { gql } from 'graphql-request';
import { getAddress } from 'viem';
import { logger } from '@/lib/utils/logger';

// Ensure Node.js runtime for API routes
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Treasury address that receives fees
const TREASURY_ADDRESS = '0x057fd8B961Eb664baA647a5C7A6e9728fabA266A';

// Vault address to asset mapping
const VAULT_ASSET_MAP: Record<string, 'USDC' | 'cbBTC' | 'WETH'> = {
  '0xf7e26fa48a568b8b0038e104dfd8abdf0f99074f': 'USDC', // V1 USDC
  '0x89712980cb434ef5ae4ab29349419eb976b0b496': 'USDC', // V2 USDC Prime
  '0xaecc8113a7bd0cfaf7000ea7a31affd4691ff3e9': 'cbBTC', // V1 cbBTC
  '0x99dcd0d75822ba398f13b2a8852b07c7e137ec70': 'cbBTC', // V2 cbBTC Prime
  '0x21e0d366272798da3a977feba699fcb91959d120': 'WETH', // V1 WETH
  '0xd6dcad2f7da91fbb27bda471540d9770c97a5a43': 'WETH', // V2 WETH Prime
};

// Vault address to version mapping (V1 or V2)
const VAULT_VERSION_MAP: Record<string, 'v1' | 'v2'> = {
  '0xf7e26fa48a568b8b0038e104dfd8abdf0f99074f': 'v1', // V1 USDC
  '0x89712980cb434ef5ae4ab29349419eb976b0b496': 'v2', // V2 USDC Prime
  '0xaecc8113a7bd0cfaf7000ea7a31affd4691ff3e9': 'v1', // V1 cbBTC
  '0x99dcd0d75822ba398f13b2a8852b07c7e137ec70': 'v2', // V2 cbBTC Prime
  '0x21e0d366272798da3a977feba699fcb91959d120': 'v1', // V1 WETH
  '0xd6dcad2f7da91fbb27bda471540d9770c97a5a43': 'v2', // V2 WETH Prime
};

// Start date for monthly statements
const STATEMENT_START_DATE = new Date('2025-11-01T00:00:00Z');

interface MonthlyStatementData {
  month: string; // YYYY-MM format
  assets: {
    USDC: {
      tokens: number;
      usd: number;
    };
    cbBTC: {
      tokens: number;
      usd: number;
    };
    WETH: {
      tokens: number;
      usd: number;
    };
  };
  total: {
    tokens: number;
    usd: number;
  };
  isComplete: boolean;
}

interface VaultMonthlyData {
  vaultAddress: string;
  asset: 'USDC' | 'cbBTC' | 'WETH';
  version: 'v1' | 'v2';
  month: string;
  tokens: number;
  usd: number;
}

interface VaultMonthlyStatementResponse {
  vaults: VaultMonthlyData[];
}

/**
 * Get the baseline (end of previous month) and end timestamps for a given month
 * We use end of previous month as baseline to capture revenue accrued during the month
 * For the current month, use current timestamp instead of end of month
 */
function getMonthTimestamps(year: number, month: number): { baseline: number; end: number } {
  // Baseline: end of previous month (or start date if this is the first month)
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const baselineDate = new Date(prevYear, prevMonth, 0, 23, 59, 59, 999);
  
  // End: end of current month, or current time if this is the current month
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // JavaScript months are 0-indexed
  
  let endDate: Date;
  if (year === currentYear && month === currentMonth) {
    // This is the current month - use current timestamp
    endDate = now;
  } else {
    // Past or future month - use end of month
    endDate = new Date(year, month, 0, 23, 59, 59, 999);
  }
  
  // Ensure baseline is not before statement start date
  const statementStartTimestamp = Math.floor(STATEMENT_START_DATE.getTime() / 1000);
  const baselineTimestamp = Math.floor(baselineDate.getTime() / 1000);
  
  return {
    baseline: Math.max(baselineTimestamp, statementStartTimestamp),
    end: Math.floor(endDate.getTime() / 1000),
  };
}

/**
 * Get all months from start date to now
 */
function getAllMonths(): Array<{ year: number; month: number; key: string }> {
  const months: Array<{ year: number; month: number; key: string }> = [];
  const now = new Date();
  const start = new Date(STATEMENT_START_DATE);
  
  let current = new Date(start.getFullYear(), start.getMonth(), 1);
  
  while (current <= now) {
    months.push({
      year: current.getFullYear(),
      month: current.getMonth() + 1,
      key: `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`,
    });
    current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
  }
  
  return months;
}

/**
 * Get value at specific timestamp from historical data
 * Returns the value at or just before the target timestamp
 * If target is before first data point, returns 0 (no position yet)
 * If target is after all data points, returns the most recent value
 */
function getValueAtTimestamp(
  data: Array<{ x?: number; y?: number }>,
  targetTimestamp: number
): number | null {
  if (!data || data.length === 0) return null;
  
  // Find valid data points
  const validPoints = data.filter(p => p.x !== undefined && p.y !== undefined) as Array<{ x: number; y: number }>;
  if (validPoints.length === 0) return null;
  
  // Find the closest data point before or at the target timestamp
  let closest: { x: number; y: number } | null = null;
  let closestDiff = Infinity;
  
  for (const point of validPoints) {
    const diff = targetTimestamp - point.x;
    // Accept points at or before the target timestamp
    if (diff >= 0 && diff < closestDiff) {
      closestDiff = diff;
      closest = point;
    }
  }
  
  // If we found a point at or before the target, use it
  if (closest) {
    return closest.y;
  }
  
  // If no point at or before target, check if target is before the first data point
  const firstPoint = validPoints[0];
  if (targetTimestamp < firstPoint.x) {
    // Target is before first data point - position didn't exist, return 0
    return 0;
  }
  
  // Target is after all data points - use the most recent value
  // This handles cases where we're querying the current month and data hasn't been updated yet
  const lastPoint = validPoints[validPoints.length - 1];
  return lastPoint.y;
}

type PositionWithHistory = {
  vaultAddress: string;
  asset: string;
  assetDecimals: number;
  isV1: boolean;
  historicalAssets: Array<{ x?: number; y?: number }>;
  historicalAssetsUsd: Array<{ x?: number; y?: number }>;
};

/**
 * Build a daily treasury revenue series from position history.
 * For each day: total USD at end of day minus total USD at end of previous day; only positive changes count as revenue.
 */
function getDailyTreasuryRevenue(
  validPositions: PositionWithHistory[]
): Array<{ date: string; value: number }> {
  const daily: Array<{ date: string; value: number }> = [];
  const start = new Date(STATEMENT_START_DATE);
  start.setUTCHours(0, 0, 0, 0);
  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));

  let d = new Date(start);
  d.setUTCHours(0, 0, 0, 0);

  const nowSec = Math.floor(Date.now() / 1000);

  while (d <= todayUTC) {
    const endOfDay = new Date(d);
    endOfDay.setUTCHours(23, 59, 59, 999);
    let endOfDaySec = Math.floor(endOfDay.getTime() / 1000);
    // For the current day, cap at "now" so we use the most recent available data (avoids future timestamps)
    if (endOfDaySec > nowSec) {
      endOfDaySec = nowSec;
    }

    const prevDay = new Date(d);
    prevDay.setUTCDate(prevDay.getUTCDate() - 1);
    const endOfPrevDay = new Date(prevDay);
    endOfPrevDay.setUTCHours(23, 59, 59, 999);
    const endOfPrevDaySec = Math.floor(endOfPrevDay.getTime() / 1000);

    let totalToday = 0;
    let totalPrev = 0;
    for (const pos of validPositions) {
      totalToday += getValueAtTimestamp(pos.historicalAssetsUsd, endOfDaySec) ?? 0;
      totalPrev += getValueAtTimestamp(pos.historicalAssetsUsd, endOfPrevDaySec) ?? 0;
    }
    const value = Math.max(0, totalToday - totalPrev);
    daily.push({ date: d.toISOString().slice(0, 10), value });

    d.setUTCDate(d.getUTCDate() + 1);
  }

  return daily;
}

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
    const addresses = getVaultAddressesForBusinessViews().map((v) => getAddress(v.address));
    const allMonths = getAllMonths();
    const treasuryAddr = getAddress(TREASURY_ADDRESS);

        const startTimestampSec = Math.floor(STATEMENT_START_DATE.getTime() / 1000);
        const endTimestampSec = Math.floor(Date.now() / 1000);
    const timeseriesOptions = {
      startTimestamp: startTimestampSec,
      endTimestamp: endTimestampSec,
      interval: 'DAY' as const,
    };

    // V1 vault position query
        const v1PositionQuery = gql`
          query VaultV1Position($vaultAddress: String!, $userAddress: String!, $chainId: Int!, $options: TimeseriesOptions) {
            vault: vaultByAddress(address: $vaultAddress, chainId: $chainId) {
              address
              asset {
                symbol
                decimals
              }
            }
            position: vaultPositions(
              first: 1
              where: { 
                vaultAddress_in: [$vaultAddress]
                userAddress_in: [$userAddress]
              }
            ) {
              items {
                vault {
                  address
                }
                user {
                  address
                }
                state {
                  shares
                  assets
                  assetsUsd
                }
                historicalState {
                  shares(options: $options) {
                    x
                    y
                  }
                  assets(options: $options) {
                    x
                    y
                  }
                  assetsUsd(options: $options) {
                    x
                    y
                  }
                }
              }
            }
          }
        `;

        type V1PositionResponse = {
          vault?: {
            address?: string | null;
            asset?: { symbol?: string | null; decimals?: number | null } | null;
          } | null;
          position?: {
            items?: Array<{
              vault?: { address?: string | null } | null;
              user?: { address?: string | null } | null;
              state?: {
                shares?: string | null;
                assets?: string | null;
                assetsUsd?: number | null;
              } | null;
              historicalState?: {
                shares?: Array<{ x?: number; y?: number }> | null;
                assets?: Array<{ x?: number; y?: number }> | null;
                assetsUsd?: Array<{ x?: number; y?: number }> | null;
              } | null;
            } | null>;
          } | null;
        };

    // V2 vault position query - V2 positions have a 'history' field (not 'historicalState')
    // V2 history supports timeseriesOptions for daily granularity
    const v2PositionQuery = gql`
      query VaultV2Position($vaultAddress: String!, $userAddress: String!, $chainId: Int!, $options: TimeseriesOptions) {
        vaultV2: vaultV2ByAddress(address: $vaultAddress, chainId: $chainId) {
          address
          asset {
            symbol
            decimals
          }
        }
        user: userByAddress(address: $userAddress, chainId: $chainId) {
          address
          vaultV2Positions {
            shares
            assets
            assetsUsd
            vault {
              address
            }
            history {
              shares(options: $options) {
                x
                y
              }
              assets(options: $options) {
                x
                y
              }
              assetsUsd(options: $options) {
                x
                y
              }
            }
          }
        }
      }
    `;

        type V2PositionResponse = {
          vaultV2?: {
            address?: string | null;
            asset?: { symbol?: string | null; decimals?: number | null } | null;
          } | null;
          user?: {
            address?: string | null;
            vaultV2Positions?: Array<{
              shares?: string | null;
              assets?: string | null;
              assetsUsd?: number | null;
              vault?: { address?: string | null } | null;
              history?: {
                shares?: Array<{ x?: number; y?: number }> | null;
                assets?: Array<{ x?: number; y?: number }> | null;
                assetsUsd?: Array<{ x?: number; y?: number }> | null;
              } | null;
            } | null>;
          } | null;
        };

    // Query treasury wallet positions in each vault (optimized: only query appropriate API)
    const vaultPositionPromises = addresses.map(async (vaultAddress) => {
      try {
        const vaultAddr = vaultAddress.toLowerCase();
        const asset = VAULT_ASSET_MAP[vaultAddr];
        const version = VAULT_VERSION_MAP[vaultAddr];
        
        if (!asset || !version) {
          logger.warn('Vault address not in asset/version map', { address: vaultAddress });
          return null;
        }

        const queryVariables = {
          vaultAddress,
          userAddress: treasuryAddr,
          chainId: BASE_CHAIN_ID,
          options: timeseriesOptions,
        };

        if (version === 'v1') {
          // Query V1 vault position
          const v1Result = await morphoGraphQLClient.request<V1PositionResponse>(
            v1PositionQuery,
            queryVariables
          );

          if (v1Result.position?.items && v1Result.position.items.length > 0) {
            const position = v1Result.position.items[0];
            if (position?.historicalState?.assets && position.historicalState.assetsUsd) {
              const assetDecimals = v1Result.vault?.asset?.decimals ?? 18;
              return {
                vaultAddress: vaultAddr,
                asset,
                assetDecimals,
                isV1: true,
                historicalAssets: position.historicalState.assets,
                historicalAssetsUsd: position.historicalState.assetsUsd,
              };
            }
          }
        } else {
          // Query V2 vault position - V2 positions use 'history' field (not 'historicalState')
          // V2 history supports timeseriesOptions for daily granularity
          try {
            const v2Result = await morphoGraphQLClient.request<V2PositionResponse>(
              v2PositionQuery,
              {
                vaultAddress,
                userAddress: treasuryAddr,
                chainId: BASE_CHAIN_ID,
                options: timeseriesOptions,
              }
            );

            logger.debug('V2 vault query result', {
              vaultAddress,
              hasVault: !!v2Result.vaultV2,
              hasUser: !!v2Result.user,
              positionsCount: v2Result.user?.vaultV2Positions?.length ?? 0,
            });

            if (v2Result.user?.vaultV2Positions && v2Result.user.vaultV2Positions.length > 0) {
              const position = v2Result.user.vaultV2Positions.find(
                p => p?.vault?.address?.toLowerCase() === vaultAddr
              );
              
              if (position?.history?.assets && position.history.assetsUsd) {
                const assetDecimals = v2Result.vaultV2?.asset?.decimals ?? 18;
                const assetsLength = position.history.assets.length;
                const assetsUsdLength = position.history.assetsUsd.length;
                const lastAssetPoint = assetsLength > 0 ? position.history.assets[assetsLength - 1] : null;
                const lastUsdPoint = assetsUsdLength > 0 ? position.history.assetsUsd[assetsUsdLength - 1] : null;
                
                logger.debug('V2 position found with history', {
                  vaultAddress,
                  historyLength: assetsLength,
                  assetsUsdLength,
                  firstPoint: position.history.assets[0],
                  lastAssetPoint,
                  lastUsdPoint,
                  currentTimestamp: Math.floor(Date.now() / 1000),
                });
                
                return {
                  vaultAddress: vaultAddr,
                  asset,
                  assetDecimals,
                  isV1: false,
                  historicalAssets: position.history.assets,
                  historicalAssetsUsd: position.history.assetsUsd,
                };
              } else {
                logger.warn('V2 position found but missing history data', {
                  vaultAddress,
                  hasHistory: !!position?.history,
                  hasAssets: !!position?.history?.assets,
                  hasAssetsUsd: !!position?.history?.assetsUsd,
                });
              }
            } else {
              logger.warn('No V2 positions found for user', {
                vaultAddress,
                userAddress: treasuryAddr,
                hasUser: !!v2Result.user,
              });
            }
          } catch (error) {
            logger.warn('V2 query failed', {
              vaultAddress,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        return null;
      } catch (error) {
        logger.warn('Failed to fetch vault position for treasury', {
          vaultAddress,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        return null;
      }
    });

    const vaultPositionResults = await Promise.all(vaultPositionPromises);
    const validPositions = vaultPositionResults.filter((v): v is NonNullable<typeof v> => v !== null);

    if (validPositions.length === 0) {
      return NextResponse.json({ statements: [], daily: [] });
    }

    const daily = getDailyTreasuryRevenue(validPositions);

    // Initialize monthly statements (for backward compatibility)
    const monthlyStatements = new Map<string, {
      USDC: { tokens: number; usd: number };
      cbBTC: { tokens: number; usd: number };
      WETH: { tokens: number; usd: number };
    }>();

    for (const month of allMonths) {
      monthlyStatements.set(month.key, {
        USDC: { tokens: 0, usd: 0 },
        cbBTC: { tokens: 0, usd: 0 },
        WETH: { tokens: 0, usd: 0 },
      });
    }

    // Track per-vault monthly differences
    const vaultMonthlyData: VaultMonthlyData[] = [];

    // Calculate monthly changes for each vault position
    for (const position of validPositions) {
      const vaultVersion = VAULT_VERSION_MAP[position.vaultAddress] || 'v1';
      
      for (const month of allMonths) {
        const { baseline, end } = getMonthTimestamps(month.year, month.month);
        
        // Get position values at baseline (end of previous month) and end of current month
        // For the current month, use the most recent available data point
        const baselineAssets = getValueAtTimestamp(position.historicalAssets, baseline);
        let endAssets = getValueAtTimestamp(position.historicalAssets, end);
        let endAssetsUsd = getValueAtTimestamp(position.historicalAssetsUsd, end);
        
        // If we're in the current month and don't have data at the end timestamp,
        // use the most recent available data point
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;
        if (month.year === currentYear && month.month === currentMonth) {
          // Find the most recent data point
          const validAssets = position.historicalAssets.filter(p => p.x !== undefined && p.y !== undefined) as Array<{ x: number; y: number }>;
          const validAssetsUsd = position.historicalAssetsUsd.filter(p => p.x !== undefined && p.y !== undefined) as Array<{ x: number; y: number }>;
          
          if (validAssets.length > 0 && validAssetsUsd.length > 0) {
            const lastAssetPoint = validAssets[validAssets.length - 1];
            const lastUsdPoint = validAssetsUsd[validAssetsUsd.length - 1];
            
            // Use the most recent point if it's more recent than what we found
            if (endAssets === null || (lastAssetPoint.x > end && lastAssetPoint.x <= Math.floor(now.getTime() / 1000))) {
              endAssets = lastAssetPoint.y;
            }
            if (endAssetsUsd === null || (lastUsdPoint.x > end && lastUsdPoint.x <= Math.floor(now.getTime() / 1000))) {
              endAssetsUsd = lastUsdPoint.y;
            }
          }
        }

        // Debug logging for V2 vaults in January 2026
        if (vaultVersion === 'v2' && month.key === '2026-01') {
          const lastAssetPoint = position.historicalAssets[position.historicalAssets.length - 1];
          const lastUsdPoint = position.historicalAssetsUsd[position.historicalAssetsUsd.length - 1];
          logger.info('V2 vault January 2026 calculation', {
            vaultAddress: position.vaultAddress,
            asset: position.asset,
            month: month.key,
            baselineTimestamp: baseline,
            endTimestamp: end,
            currentTimestamp: Math.floor(Date.now() / 1000),
            baselineAssets,
            endAssets,
            endAssetsUsd,
            historicalAssetsLength: position.historicalAssets.length,
            historicalAssetsUsdLength: position.historicalAssetsUsd.length,
            lastDataPoint: lastAssetPoint,
            lastUsdPoint: lastUsdPoint,
            allNull: baselineAssets === null || endAssets === null || endAssetsUsd === null,
          });
        }

        if (baselineAssets !== null && endAssets !== null && endAssetsUsd !== null) {
          // Calculate token amount change (income = end - baseline)
          // This captures revenue accrued during the month
          const baselineTokens = baselineAssets / Math.pow(10, position.assetDecimals);
          const endTokens = endAssets / Math.pow(10, position.assetDecimals);
          const tokenChange = endTokens - baselineTokens;

          // Debug logging for V2 vaults in January 2026
          if (vaultVersion === 'v2' && month.key === '2026-01') {
            logger.info('V2 vault January 2026 token calculation', {
              vaultAddress: position.vaultAddress,
              asset: position.asset,
              baselineTokens,
              endTokens,
              tokenChange,
              willInclude: tokenChange > 0,
            });
          }

          // Only count positive changes (income/revenue), ignore withdrawals
          // Revenue is the increase in position from end of previous month to end of current month
          if (tokenChange > 0) {
            // Calculate USD value using the price per token on the last day of the month
            // This only counts the USD value of newly earned tokens (not price changes on existing tokens)
            // Formula: earnedTokens × (USD value of position at end / token amount at end)
            // Minimum threshold: smallest unit for the asset (1 wei/satoshi)
            // USDC: 6 decimals = 0.000001, cbBTC: 8 decimals = 0.00000001, WETH: 18 decimals = 10^-18
            const minTokenThreshold = 1 / Math.pow(10, position.assetDecimals);
            let usdValue = 0;
            if (endTokens > minTokenThreshold) { // Avoid division by zero
              const pricePerToken = endAssetsUsd / endTokens;
              usdValue = tokenChange * pricePerToken;
            }

            // Add to aggregated statement (for backward compatibility)
            const statement = monthlyStatements.get(month.key);
            if (statement) {
              statement[position.asset].tokens += tokenChange;
              statement[position.asset].usd += usdValue;
            }

            // Add per-vault data
            vaultMonthlyData.push({
              vaultAddress: position.vaultAddress,
              asset: position.asset,
              version: vaultVersion,
              month: month.key,
              tokens: tokenChange,
              usd: usdValue,
            });
          }
        } else if (vaultVersion === 'v2' && month.key === '2026-01') {
          logger.warn('V2 vault January 2026 - missing data', {
            vaultAddress: position.vaultAddress,
            asset: position.asset,
            baselineAssets,
            endAssets,
            endAssetsUsd,
          });
        }
      }
    }

    logger.info('Monthly statement calculated from treasury positions', {
      positionsProcessed: validPositions.length,
      monthsWithData: Array.from(monthlyStatements.values()).filter(m => 
        m.USDC.tokens !== 0 || m.cbBTC.tokens !== 0 || m.WETH.tokens !== 0
      ).length,
    });

    // Convert to array format
    const now = new Date();
    now.setHours(23, 59, 59, 999);

    const isCurrentMonth = (monthKey: string) => {
      const [y, mo] = monthKey.split('-').map(Number);
      return now.getUTCFullYear() === y && now.getUTCMonth() + 1 === mo;
    };

    const statements: MonthlyStatementData[] = Array.from(monthlyStatements.entries())
      .map(([month, assets]) => {
        const [year, monthNum] = month.split('-').map(Number);
        const lastDayOfMonth = new Date(year, monthNum, 0);
        lastDayOfMonth.setHours(23, 59, 59, 999);
        const isComplete = now > lastDayOfMonth;

        const totalTokens = assets.USDC.tokens + assets.cbBTC.tokens + assets.WETH.tokens;
        const totalUsd = assets.USDC.usd + assets.cbBTC.usd + assets.WETH.usd;

        return {
          month,
          assets,
          total: {
            tokens: totalTokens,
            usd: totalUsd,
          },
          isComplete,
        };
      })
      .filter(s => s.total.tokens !== 0 || s.total.usd !== 0 || isCurrentMonth(s.month)) // Include months with changes, or current month (so we have a point for Jan 2026 etc.)
      .sort((a, b) => a.month.localeCompare(b.month));

    const responseHeaders = new Headers(rateLimitResult.headers);
    responseHeaders.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

    // Check if client wants per-vault data via query parameter
    const url = new URL(request.url);
    const perVault = url.searchParams.get('perVault') === 'true';

    if (perVault) {
      return NextResponse.json({ vaults: vaultMonthlyData, daily }, { headers: responseHeaders });
    }

    return NextResponse.json({ statements, daily }, { headers: responseHeaders });
  } catch (err) {
    const { error, statusCode } = handleApiError(err, 'Failed to fetch monthly statement');
    return NextResponse.json(error, { status: statusCode });
  }
}
