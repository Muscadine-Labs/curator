import { NextResponse } from 'next/server';
import {
  getAllVaultAddresses,
  getSidebarVaultAddresses,
  getVaultAddressesForBusinessViews,
  getVaultByAddress,
} from '@/lib/config/vaults';
import { BASE_CHAIN_ID, BPS_PER_ONE, getScanUrlForChain, GRAPHQL_FIRST_LIMIT } from '@/lib/constants';
import { handleApiError } from '@/lib/utils/error-handler';
import { createRateLimitMiddleware, RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS } from '@/lib/utils/rate-limit';
import { morphoGraphQLClient } from '@/lib/morpho/graphql-client';
import { computeTreasuryStatement } from '@/lib/morpho/compute-treasury-statement';
import {
  aggregateTreasuryRevenueByVault,
  treasuryRevenueAllTimeForVault,
} from '@/lib/morpho/treasury-statement';
import { gql } from 'graphql-request';
import { getAddress } from 'viem';
import { logger } from '@/lib/utils/logger';
import { mergeApiCacheHeaders } from '@/lib/api/response-cache';

// Ensure Node.js runtime for API routes (required for external API calls)
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
    // Check if the caller wants all vaults (including test) for sidebar display
    const url = new URL(request.url);
    const sidebarOnly = url.searchParams.get('sidebar') === 'true';
    const includeAll = url.searchParams.get('includeAll') === 'true';
    const vaultConfigs = sidebarOnly
      ? getSidebarVaultAddresses()
      : includeAll
        ? getAllVaultAddresses()
        : getVaultAddressesForBusinessViews();
    const addresses = vaultConfigs.map((v) => getAddress(v.address));
    const configuredAddressSet = new Set(addresses.map((a) => a.toLowerCase()));

    const revenueByVaultPromise = computeTreasuryStatement()
      .then((data) => aggregateTreasuryRevenueByVault(data.vaults))
      .catch(() => ({} as Record<string, number>));

    // V2 vaults are queried individually (no vaultsV2 list query)
    const v2VaultPromises = addresses.map(async (address) => {
      try {
        const v2Query = gql`
          query FetchV2Vault($address: String!, $chainId: Int!) {
            vaultV2ByAddress(address: $address, chainId: $chainId) {
              address
              name
              symbol
              listed
              asset { address symbol decimals }
              performanceFee
              totalAssetsUsd
              avgNetApy
              positions(first: ${GRAPHQL_FIRST_LIMIT}) {
                items { user { address } }
              }
            }
          }
        `;
        const result = await morphoGraphQLClient.request<{ vaultV2ByAddress?: { address: string; name: string; symbol?: string; listed?: boolean; asset?: { address?: string; symbol?: string; decimals?: number }; performanceFee?: number; totalAssetsUsd?: number; apy?: number; avgNetApy?: number; positions?: { items?: Array<{ user?: { address?: string } | null } | null> | null } | null } | null }>(v2Query, { address, chainId: BASE_CHAIN_ID });
        
        // graphql-request returns data directly: { vaultV2ByAddress: { ... } }
        // Access the property directly - it will be null if vault doesn't exist, or an object if it does
        const vaultData = result?.vaultV2ByAddress;
        
        if (vaultData && vaultData.address) {
          logger.debug('V2 vault found', {
            address: vaultData.address,
            name: vaultData.name,
            totalAssetsUsd: vaultData.totalAssetsUsd,
            apy: vaultData.apy,
          });
          return vaultData;
        }
        return null;
      } catch (error) {
        logger.debug('V2 vault query failed', {
          address,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    });

    const [v2Results, revenueByVault] = await Promise.all([
      Promise.all(v2VaultPromises),
      revenueByVaultPromise,
    ]);

    const v2Vaults = v2Results.filter((v): v is NonNullable<typeof v> => v !== null);
    logger.debug('V2 vaults fetched', {
      found: v2Vaults.length,
      queried: v2Results.length,
    });

    // Count unique users for V2 vaults from nested positions
    const depositorsByVault: Record<string, Set<string>> = {};
    for (const v2Vault of v2Vaults) {
      if (!v2Vault.address) continue;
      const addr = v2Vault.address.toLowerCase();
      if (!depositorsByVault[addr]) {
        depositorsByVault[addr] = new Set<string>();
      }
      const positions = v2Vault.positions?.items || [];
      for (const pos of positions) {
        if (pos?.user?.address) {
          depositorsByVault[addr].add(pos.user.address.toLowerCase());
        }
      }
    }
    
    // Convert Sets to counts
    const depositorCounts: Record<string, number> = {};
    for (const [addr, users] of Object.entries(depositorsByVault)) {
      depositorCounts[addr] = users.size;
    }

    const addressToChainId = Object.fromEntries(
      vaultConfigs.map((v) => [v.address.toLowerCase(), v.chainId])
    );

    const getChainId = (addr: string) =>
      addressToChainId[addr.toLowerCase()] ?? BASE_CHAIN_ID;

    const enrichFromConfig = <T extends { address: string }>(row: T) => {
      const cfg = getVaultByAddress(row.address);
      return {
        ...row,
        id: row.address,
        version: cfg?.morphoVersion ?? ('v2' as const),
        listCategory: cfg?.listCategory ?? null,
      };
    };

    const allVaults = v2Vaults.map((v) => {
        const chainId = getChainId(v.address);
        return enrichFromConfig({
          address: v.address,
          name: v.name ?? 'Unknown Vault',
          symbol: v.symbol ?? v.asset?.symbol ?? 'UNKNOWN',
          asset: v.asset?.symbol ?? 'UNKNOWN',
          chainId,
          scanUrl: `${getScanUrlForChain(chainId)}/address/${v.address}`,
          performanceFeeBps: v.performanceFee ? Math.round(v.performanceFee * BPS_PER_ONE) : null,
          status: v.listed ? 'active' as const : 'paused' as const,
          riskTier: 'medium' as const,
          createdAt: new Date().toISOString(),
          tvl: v.totalAssetsUsd ?? null,
          apy: v.avgNetApy != null ? v.avgNetApy * 100 :
               v.apy != null ? v.apy * 100 : null,
          depositors: depositorCounts[v.address.toLowerCase()] ?? 0,
          revenueAllTime: treasuryRevenueAllTimeForVault(revenueByVault, v.address),
          feesAllTime: null,
          lastHarvest: null,
        });
    });

    // Filter to only include vaults from our configured addresses
    const merged = allVaults.filter(v => configuredAddressSet.has(v.address.toLowerCase()));

    const responseHeaders = mergeApiCacheHeaders(rateLimitResult.headers, 60);

    return NextResponse.json(merged, { headers: responseHeaders });
  } catch (err) {
    const { error, statusCode } = handleApiError(err, 'Failed to fetch vaults');
    return NextResponse.json(error, { status: statusCode });
  }
}


