import { NextRequest, NextResponse } from 'next/server';
import { getVaultByAddress, shouldUseV2Query } from '@/lib/config/vaults';
import { BPS_PER_ONE, GRAPHQL_FIRST_LIMIT, GRAPHQL_TRANSACTIONS_LIMIT, getDaysAgoTimestamp } from '@/lib/constants';
import { handleApiError, AppError } from '@/lib/utils/error-handler';
import { createRateLimitMiddleware, RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS } from '@/lib/utils/rate-limit';
import { morphoGraphQLClient } from '@/lib/morpho/graphql-client';
import { gql } from 'graphql-request';
import { getAddress, isAddress } from 'viem';
import { logger } from '@/lib/utils/logger';
// Types imported from SDK but not directly used in this file
// import type { Vault, VaultPosition, Maybe } from '@morpho-org/blue-api-sdk';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const { id } = await params;
    
    // Check if id is a valid address
    let address: string;
    if (isAddress(id)) {
      address = getAddress(id);
    } else {
      // Try to find by address in config
      const cfg = getVaultByAddress(id);
      if (!cfg) {
        throw new AppError('Vault not found', 404, 'VAULT_NOT_FOUND');
      }
      address = getAddress(cfg.address);
    }

    // Check if address is in our configured list
    const cfg = getVaultByAddress(address);
    if (!cfg) {
      throw new AppError('Vault not found in configuration', 404, 'VAULT_NOT_FOUND');
    }

    // Try to fetch vault name first to determine query type
    // We'll try V2 first, then V1 if V2 fails
    let vaultName: string | null = null;
    let isV2 = false;
    
    try {
      const v2CheckQuery = gql`
        query CheckV2Vault($address: String!, $chainId: Int!) {
          vaultV2ByAddress(address: $address, chainId: $chainId) {
            name
          }
        }
      `;
      const v2Check = await morphoGraphQLClient.request<{ vaultV2ByAddress?: { name?: string } | null }>(v2CheckQuery, { address, chainId: cfg.chainId });
      if (v2Check.vaultV2ByAddress !== null && v2Check.vaultV2ByAddress !== undefined) {
        // V2 vault exists (even if name is null)
        vaultName = v2Check.vaultV2ByAddress.name ?? null;
        isV2 = true;
        logger.debug('V2 vault detected', { address, name: vaultName });
      }
    } catch (error) {
      // V2 query failed, try V1 (expected for V1 vaults)
      logger.debug('V2 vault check failed, trying V1', {
        address,
        error: error instanceof Error ? error.message : String(error),
      });
      try {
        const v1CheckQuery = gql`
          query CheckV1Vault($address: String!, $chainId: Int!) {
            vault: vaultByAddress(address: $address, chainId: $chainId) {
              name
            }
          }
        `;
        const v1Check = await morphoGraphQLClient.request<{ vault?: { name?: string } | null }>(v1CheckQuery, { address, chainId: cfg.chainId });
        if (v1Check.vault !== null && v1Check.vault !== undefined) {
          // V1 vault exists
          vaultName = v1Check.vault.name ?? null;
          isV2 = false;
        }
      } catch {
        throw new AppError('Vault not found in GraphQL', 404, 'VAULT_NOT_FOUND');
      }
    }

    // If we found a vault but name is null, use name-based check as fallback
    // Otherwise, if we have a name, use it to confirm query type
    if (vaultName) {
      // Use the vault name to confirm query type (should match what we detected)
      const nameBasedIsV2 = shouldUseV2Query(vaultName, address);
      if (isV2 !== nameBasedIsV2) {
        // Log warning if there's a mismatch, but trust the GraphQL result
        logger.warn('Vault type detection mismatch', {
          address,
          graphqlDetection: isV2,
          nameBasedDetection: nameBasedIsV2,
        });
      }
    }

    // V2 vaults don't need options for historical data
    const variables = isV2
      ? {
          address,
          chainId: cfg.chainId,
        }
      : {
          address,
          chainId: cfg.chainId,
          options: {
            startTimestamp: getDaysAgoTimestamp(30),
            endTimestamp: Math.floor(Date.now() / 1000),
            interval: 'DAY'
          }
        };

    // Response type - complex nested structure from GraphQL
    // Using unknown for vault since it has deeply nested structure that matches our query
    // V2 uses vaultV2ByAddress, V1 uses vaultByAddress
    type VaultDetailQueryResponse = {
      vault?: unknown;
      vaultV2ByAddress?: unknown;
      positions?: {
        items: Array<{ user: { address: string } } | null> | null;
      } | null;
      txs?: {
        items: Array<{
          blockNumber: number;
          hash: string;
          type: string;
          user?: { address?: string | null } | null;
        } | null> | null;
      } | null;
    };
    
    const v1Query = gql`
      query VaultDetail($address: String!, $chainId: Int!, $options: TimeseriesOptions) {
        vault: vaultByAddress(address: $address, chainId: $chainId) {
          address
          name
          symbol
          whitelisted
          metadata {
            description
            forumLink
            image
          }
          allocators { address }
          asset { address symbol decimals yield { apr } }
          state {
            owner
            curator
            guardian
            timelock
            totalAssets
            totalAssetsUsd
            totalSupply
            apy
            netApy
            netApyWithoutRewards
            avgApy
            avgNetApy
            dailyApy
            dailyNetApy
            weeklyApy
            weeklyNetApy
            monthlyApy
            monthlyNetApy
            fee
            rewards {
              asset { address chain { id } }
              supplyApr
              yearlySupplyTokens
            }
            allocation {
              supplyAssets
              supplyAssetsUsd
              supplyCap
              market {
                uniqueKey
                loanAsset { address name symbol }
                collateralAsset { address name symbol }
                oracleAddress
                irmAddress
                lltv
                state {
                  rewards {
                    asset { address chain { id } }
                    supplyApr
                    borrowApr
                  }
                  supplyApy
                  borrowApy
                  utilization
                  liquidityAssetsUsd
                }
              }
            }
            lastTotalAssets
            allocationQueues: allocation {
              supplyQueueIndex
              withdrawQueueIndex
              market { uniqueKey }
            }
          }
          historicalState {
            apy(options: $options) {
              x
              y
            }
            netApy(options: $options) {
              x
              y
            }
            totalAssets(options: $options) {
              x
              y
            }
            totalAssetsUsd(options: $options) {
              x
              y
            }
          }
        }
        positions: vaultPositions(
          first: ${GRAPHQL_FIRST_LIMIT},
          where: { vaultAddress_in: [$address] }
        ) { items { user { address } } }
        txs: transactions(
          first: ${GRAPHQL_TRANSACTIONS_LIMIT},
          orderBy: Timestamp,
          orderDirection: Desc,
          where: { vaultAddress_in: [$address] }
        ) {
          items { blockNumber hash type user { address } }
        }
      }
    `;

    const v2Query = gql`
      query VaultV2Detail($address: String!, $chainId: Int!) {
        vaultV2ByAddress(address: $address, chainId: $chainId) {
          address
          name
          symbol
          whitelisted
          metadata {
            description
            forumLink
            image
          }
          asset { address symbol decimals }
          curator { address }
          owner { address }
          totalAssets
          totalAssetsUsd
          totalSupply
          performanceFee
          managementFee
          maxApy
          avgApy
          avgNetApy
          rewards {
            asset { address chain { id } }
            supplyApr
            yearlySupplyTokens
          }
          positions(first: ${GRAPHQL_FIRST_LIMIT}) {
            items { user { address } }
          }
        }
        txs: transactions(
          first: ${GRAPHQL_TRANSACTIONS_LIMIT},
          orderBy: Timestamp,
          orderDirection: Desc,
          where: { vaultAddress_in: [$address] }
        ) {
          items { blockNumber hash type user { address } }
        }
      }
    `;

    const query = isV2 ? v2Query : v1Query;

    // Fetch vault detail and monthly statement revenue in parallel
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
    const revenuePromise = fetch(`${baseUrl}/api/monthly-statement-morphoql?perVault=true`, {
      headers: { 'Content-Type': 'application/json' },
    })
      .then((res) => (res.ok ? res.json() : { vaults: [] }))
      .then((d: { vaults?: Array<{ vaultAddress: string; month: string; usd: number }> }) => {
        const addr = address.toLowerCase();
        let total = 0;
        let ytd = 0;
        let found = false;
        const currentYear = new Date().getFullYear().toString();
        for (const v of d.vaults ?? []) {
          if (v.vaultAddress?.toLowerCase() === addr) {
            found = true;
            total += v.usd ?? 0;
            if (v.month?.startsWith(currentYear)) ytd += v.usd ?? 0;
          }
        }
        return { revenueAllTime: found ? total : null, feesYtd: found ? ytd : null };
      })
      .catch(() => ({ revenueAllTime: null, feesYtd: null }));

    let data: VaultDetailQueryResponse;
    let revenue: { revenueAllTime: number | null; feesYtd: number | null } = { revenueAllTime: null, feesYtd: null };
    try {
      const [graphqlData, revenueData] = await Promise.all([
        morphoGraphQLClient.request<VaultDetailQueryResponse>(query, variables),
        revenuePromise,
      ]);
      data = graphqlData;
      revenue = revenueData;
      if (isV2 && data.vaultV2ByAddress) {
        logger.debug('V2 vault data found', {
          address: cfg.address,
          name: (data.vaultV2ByAddress as Record<string, unknown>)?.name,
          totalAssetsUsd: (data.vaultV2ByAddress as Record<string, unknown>)?.totalAssetsUsd,
          avgApy: (data.vaultV2ByAddress as Record<string, unknown>)?.avgApy,
        });
      }
    } catch (graphqlError) {
      // For v2 vaults, GraphQL API may not have indexed them yet
      if (isV2) {
        revenue = await revenuePromise; // Still get revenue for fallback response
        logger.error('GraphQL query failed for v2 vault', graphqlError instanceof Error ? graphqlError : new Error(String(graphqlError)), {
          address,
        });
        // Return null vault to trigger fallback handling below
        data = { vaultV2ByAddress: null, positions: null, txs: null };
      } else {
        // For v1 vaults, re-throw the error
        throw graphqlError;
      }
    }

    // If vault not found in Morpho (v2 vaults may not be indexed yet)
    // V2 uses vaultV2ByAddress, V1 uses vault
    const vaultData = isV2 ? data.vaultV2ByAddress : data.vault;
    if (!vaultData && isV2) {
      logger.debug('V2 vault not found in GraphQL response', {
        address: cfg.address,
        chainId: cfg.chainId,
        hasVaultV2ByAddress: !!data.vaultV2ByAddress,
      });
    }
    if (!vaultData) {
      if (isV2) {
        // For v2 vaults that aren't indexed, return minimal data structure
        // The frontend will handle null values appropriately
        const responseHeaders = new Headers(rateLimitResult.headers);
        responseHeaders.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
        
        return NextResponse.json({
          ...cfg,
          address: address,
          name: 'Unknown V2 Vault',
          symbol: 'UNKNOWN',
          asset: 'UNKNOWN',
          tvl: null,
          apy: null,
          depositors: 0,
          revenueAllTime: revenue.revenueAllTime,
          feesAllTime: null,
          feesYtd: revenue.feesYtd,
          lastHarvest: null,
          apyBreakdown: null,
          rewards: [],
          allocation: [],
          queues: { supplyQueueIndex: null, withdrawQueueIndex: null },
          warnings: [],
          metadata: {},
          historicalData: { apy: [], netApy: [], totalAssets: [], totalAssetsUsd: [] },
          roles: { owner: null, curator: null, guardian: null, timelock: null },
          transactions: [],
          parameters: {
            performanceFeeBps: null,
            performanceFeePercent: null,
            maxDeposit: null,
            maxWithdrawal: null,
            strategyNotes: '',
          },
        }, { headers: responseHeaders });
      } else {
        // For v1 vaults, return 404 if not found
        throw new AppError('Vault not found in Morpho API', 404, 'VAULT_NOT_FOUND');
      }
    }

    // Type assertion for vault data - structure matches our query
    // V2 vaults have fields directly on the vault, V1 vaults have them in a state object
    const mv = vaultData as {
      address?: string;
      name?: string | null;
      symbol?: string | null;
      whitelisted?: boolean | null;
      metadata?: {
        description?: string | null;
        forumLink?: string | null;
        image?: string | null;
        curators?: Array<{ image?: string | null; name?: string | null; url?: string | null }>;
      } | null;
      allocators?: Array<{ address: string }>;
      asset?: {
        address?: string;
        symbol?: string;
        decimals?: number;
        yield?: { apr?: number | null } | null;
      } | null;
      // V2 vault fields (direct on vault)
      totalAssetsUsd?: number | null;
      performanceFee?: number | null;
      managementFee?: number | null;
      maxApy?: number | null;
      avgApy?: number | null;
      avgNetApy?: number | null;
      curator?: { address?: string | null } | null;
      owner?: { address?: string | null } | null;
      positions?: {
        items?: Array<{ user?: { address?: string | null } | null } | null> | null;
      } | null;
      // V2 vault rewards (direct on vault, not in state)
      rewards?: Array<{
        asset?: { address?: string; chain?: { id?: number } | null } | null;
        supplyApr?: number | null;
        yearlySupplyTokens?: number | null;
      }>;
      // V1 vault fields (in state object)
      state?: {
        owner?: string | null;
        curator?: string | null;
        guardian?: string | null;
        timelock?: string | null;
        totalAssets?: string | null;
        totalAssetsUsd?: number | null;
        totalSupply?: string | null;
        totalSupplyShares?: string | null;
        supplyQueue?: number[];
        withdrawQueue?: number[];
        lastUpdate?: number | null;
        apy?: number | null;
        netApy?: number | null;
        netApyWithoutRewards?: number | null;
        avgApy?: number | null;
        avgNetApy?: number | null;
        dailyApy?: number | null;
        dailyNetApy?: number | null;
        weeklyApy?: number | null;
        weeklyNetApy?: number | null;
        monthlyApy?: number | null;
        monthlyNetApy?: number | null;
        fee?: number | null;
        warnings?: Array<{ type?: string; level?: string }>;
        rewards?: Array<{
          asset?: { address?: string; chain?: { id?: number } | null } | null;
          supplyApr?: number | null;
          yearlySupplyTokens?: number | null;
        }>;
        allocation?: Array<{
          supplyAssets?: string | null;
          supplyAssetsUsd?: number | null;
          supplyCap?: string | null;
          market?: {
            uniqueKey?: string;
            loanAsset?: { address?: string | null; name?: string | null; symbol?: string | null } | null;
            collateralAsset?: { address?: string | null; name?: string | null; symbol?: string | null } | null;
            oracleAddress?: string | null;
            irmAddress?: string | null;
            lltv?: string | null;
              state?: {
                rewards?: Array<{
                  asset?: { address?: string; chain?: { id?: number } | null } | null;
                  supplyApr?: number | null;
                  borrowApr?: number | null;
                }>;
                supplyApy?: number | null;
                borrowApy?: number | null;
                utilization?: number | null;
                liquidityAssetsUsd?: number | null;
              } | null;
          } | null;
        }>;
        lastTotalAssets?: string | null;
        allocationQueues?: Array<{
          supplyQueueIndex?: number | null;
          withdrawQueueIndex?: number | null;
          market?: { uniqueKey?: string } | null;
        }> | null;
      } | null;
      historicalState?: {
        apy?: Array<{ x?: number; y?: number }>;
        netApy?: Array<{ x?: number; y?: number }>;
        totalAssets?: Array<{ x?: number; y?: number }>;
        totalAssetsUsd?: Array<{ x?: number; y?: number }>;
      } | null;
    } | null;
    // Handle positions - v2 has positions on vault, v1 has them in separate query
    const v2Positions = mv?.positions?.items || [];
    const v1Positions = (data.positions?.items || []);
    const allPositions = isV2 ? v2Positions : v1Positions;
    
    // Handle transactions - both v1 and v2 use the same transactions query
    const txs = (data.txs?.items || []).filter(
      (t): t is {
        blockNumber: number;
        hash: string;
        type: string;
        user?: { address?: string | null } | null;
      } => t !== null
    );
    
    const positions = allPositions.filter(
      (p): p is { user: { address: string } } => p !== null && p?.user !== null && p?.user !== undefined && p.user.address !== undefined
    );
    
    const depositors = new Set(
      positions
        .map((p) => p.user.address.toLowerCase())
        .filter((addr): addr is string => addr !== undefined && addr !== null)
    ).size;

    // V2 vaults have fields directly, V1 vaults have them in state object
    // Preserve null values instead of converting to 0
    const tvlUsd = isV2 
      ? (mv?.totalAssetsUsd ?? null)
      : (mv?.state?.totalAssetsUsd ?? null);
    
    // Calculate APY - preserve null if all values are null/undefined
    const apyPct = isV2
      ? (mv?.avgNetApy != null ? mv.avgNetApy * 100 : 
         mv?.avgApy != null ? mv.avgApy * 100 : 
         mv?.maxApy != null ? mv.maxApy * 100 : null)
      : (mv?.state?.netApy != null ? mv.state.netApy * 100 :
         mv?.state?.avgNetApy != null ? mv.state.avgNetApy * 100 :
         mv?.state?.apy != null ? mv.state.apy * 100 : null);
    
    const apyBasePct = isV2
      ? (mv?.avgApy != null ? mv.avgApy * 100 : 
         mv?.maxApy != null ? mv.maxApy * 100 : null)
      : (mv?.state?.apy != null ? mv.state.apy * 100 : null);
    
    const apyBoostedPct = isV2
      ? (mv?.avgNetApy != null ? mv.avgNetApy * 100 : null)
      : (mv?.state?.netApy != null ? mv.state.netApy * 100 : null);
    
    // V2 caps structure is different, skip utilization for now
    // V1 uses allocation
    const utilization = isV2
      ? 0 // V2 caps structure needs to be investigated separately
      : (mv?.state?.allocation?.reduce((sum, a) => {
          const cap = a.supplyCap ? (typeof a.supplyCap === 'bigint' ? Number(a.supplyCap) : Number(a.supplyCap)) : 0;
          const assets = a.supplyAssets ? (typeof a.supplyAssets === 'bigint' ? Number(a.supplyAssets) : Number(a.supplyAssets)) : 0;
          return cap > 0 ? sum + (assets / cap) : sum;
        }, 0) ?? 0);
    
    // Get performance fee from Morpho API (decimal like 0.05 = 5%)
    const performanceFeeBps = isV2
      ? (mv?.performanceFee ? Math.round(mv.performanceFee * BPS_PER_ONE) : null)
      : (mv?.state?.fee ? Math.round(mv.state.fee * BPS_PER_ONE) : null);

    const result = {
      ...cfg,
      address: address, // Ensure address is explicitly set
      name: mv?.name ?? 'Unknown Vault',
      symbol: mv?.symbol ?? mv?.asset?.symbol ?? 'UNKNOWN',
      asset: mv?.asset?.symbol ?? 'UNKNOWN',
      assetDecimals: mv?.asset?.decimals ?? null,
      tvl: tvlUsd,
      apy: apyPct,
      apyBase: apyBasePct,
      apyBoosted: apyBoostedPct,
      feesYtd: revenue.feesYtd,
      utilization: utilization,
      depositors,
      revenueAllTime: revenue.revenueAllTime,
      feesAllTime: null,
      lastHarvest: null,
      apyBreakdown: isV2 ? {
        apy: (mv?.avgApy ?? mv?.maxApy) != null ? (mv?.avgApy ?? mv?.maxApy ?? 0) * 100 : null,
        netApy: mv?.avgNetApy != null ? mv.avgNetApy * 100 : null,
        netApyWithoutRewards: mv?.avgNetApy != null ? mv.avgNetApy * 100 : null,
        avgApy: mv?.avgApy != null ? mv.avgApy * 100 : null,
        avgNetApy: mv?.avgNetApy != null ? mv.avgNetApy * 100 : null,
        dailyApy: null,
        dailyNetApy: null,
        weeklyApy: null,
        weeklyNetApy: null,
        monthlyApy: null,
        monthlyNetApy: null,
        underlyingYieldApr: null,
      } : {
        apy: mv?.state?.apy != null ? mv.state.apy * 100 : null,
        netApy: mv?.state?.netApy != null ? mv.state.netApy * 100 : null,
        netApyWithoutRewards: mv?.state?.netApyWithoutRewards != null ? mv.state.netApyWithoutRewards * 100 : null,
        avgApy: mv?.state?.avgApy != null ? mv.state.avgApy * 100 : null,
        avgNetApy: mv?.state?.avgNetApy != null ? mv.state.avgNetApy * 100 : null,
        dailyApy: mv?.state?.dailyApy != null ? mv.state.dailyApy * 100 : null,
        dailyNetApy: mv?.state?.dailyNetApy != null ? mv.state.dailyNetApy * 100 : null,
        weeklyApy: mv?.state?.weeklyApy != null ? mv.state.weeklyApy * 100 : null,
        weeklyNetApy: mv?.state?.weeklyNetApy != null ? mv.state.weeklyNetApy * 100 : null,
        monthlyApy: mv?.state?.monthlyApy != null ? mv.state.monthlyApy * 100 : null,
        monthlyNetApy: mv?.state?.monthlyNetApy != null ? mv.state.monthlyNetApy * 100 : null,
        underlyingYieldApr: mv?.asset?.yield?.apr != null ? mv.asset.yield.apr * 100 : null,
      },
      rewards: isV2
        ? (mv?.rewards || []).map((r: { asset?: { address?: string; chain?: { id?: number } | null } | null; supplyApr?: number | null; yearlySupplyTokens?: number | null }) => ({
            assetAddress: r.asset?.address ?? '',
            chainId: r.asset?.chain?.id ?? null,
            supplyApr: r.supplyApr != null ? r.supplyApr * 100 : null,
            yearlySupplyTokens: r.yearlySupplyTokens ? (typeof r.yearlySupplyTokens === 'bigint' ? Number(r.yearlySupplyTokens) : r.yearlySupplyTokens) : null,
          }))
        : (mv?.state?.rewards || []).map((r) => ({
            assetAddress: r.asset?.address ?? '',
            chainId: r.asset?.chain?.id ?? null,
            supplyApr: r.supplyApr != null ? r.supplyApr * 100 : null,
            yearlySupplyTokens: r.yearlySupplyTokens ? (typeof r.yearlySupplyTokens === 'bigint' ? Number(r.yearlySupplyTokens) : r.yearlySupplyTokens) : null,
          })),
      allocation: isV2
        ? [] // V2 vaults don't have allocation in the same format
        : (mv?.state?.allocation || []).map((a: {
            market?: {
              uniqueKey?: string | null;
              loanAsset?: { address?: string | null; name?: string | null; symbol?: string | null } | null;
              collateralAsset?: { address?: string | null; name?: string | null; symbol?: string | null } | null;
              oracleAddress?: string | null;
              irmAddress?: string | null;
              lltv?: string | number | null;
              state?: {
                rewards?: Array<{
                  asset?: { address?: string | null; chain?: { id?: number | null } | null } | null;
                  supplyApr?: number | null;
                  borrowApr?: number | null;
                }> | null;
                supplyApy?: number | null;
                borrowApy?: number | null;
                utilization?: number | null;
                liquidityAssetsUsd?: number | null;
              } | null;
            } | null;
            supplyCap?: string | number | null;
            supplyAssets?: string | number | null;
            supplyAssetsUsd?: number | null;
          }) => {
            try {
              return {
                marketKey: a.market?.uniqueKey ?? '',
                loanAssetAddress: a.market?.loanAsset?.address ?? null,
                loanAssetName: a.market?.loanAsset?.name ?? null,
                loanAssetSymbol: a.market?.loanAsset?.symbol ?? null,
                collateralAssetAddress: a.market?.collateralAsset?.address ?? null,
                collateralAssetName: a.market?.collateralAsset?.name ?? null,
                collateralAssetSymbol: a.market?.collateralAsset?.symbol ?? null,
                oracleAddress: a.market?.oracleAddress ?? null,
                irmAddress: a.market?.irmAddress ?? null,
                lltv: a.market?.lltv ? (typeof a.market.lltv === 'string' ? parseFloat(a.market.lltv) : Number(a.market.lltv)) : null,
                lltvRaw: a.market?.lltv ? String(a.market.lltv) : null,
                supplyCap: a.supplyCap ? (typeof a.supplyCap === 'string' ? parseFloat(a.supplyCap) : Number(a.supplyCap)) : null,
                supplyAssets: a.supplyAssets ? (typeof a.supplyAssets === 'string' ? a.supplyAssets : String(a.supplyAssets)) : null,
                supplyAssetsUsd: a.supplyAssetsUsd ?? null,
                marketRewards: (a.market?.state?.rewards || []).map((r: {
                  asset?: { address?: string | null; chain?: { id?: number | null } | null } | null;
                  supplyApr?: number | null;
                  borrowApr?: number | null;
                }) => ({
                  assetAddress: r.asset?.address ?? '',
                  chainId: r.asset?.chain?.id ?? null,
                  supplyApr: r.supplyApr != null ? r.supplyApr * 100 : null,
                  borrowApr: r.borrowApr != null ? r.borrowApr * 100 : null,
                })),
                supplyApy: a.market?.state?.supplyApy != null ? a.market.state.supplyApy * 100 : null,
                borrowApy: a.market?.state?.borrowApy != null ? a.market.state.borrowApy * 100 : null,
                utilization: a.market?.state?.utilization != null ? a.market.state.utilization * 100 : null,
                liquidityAssetsUsd: a.market?.state?.liquidityAssetsUsd ?? null,
              };
            } catch (error) {
              logger.warn('Failed to map allocation item', { error, allocation: a });
              return null;
            }
          }).filter((a): a is NonNullable<typeof a> => a !== null),
      queues: {
        supplyQueueIndex: isV2 ? null : (Array.isArray(mv?.state?.allocationQueues) && mv.state.allocationQueues.length > 0 ? mv.state.allocationQueues[0].supplyQueueIndex ?? null : null),
        withdrawQueueIndex: isV2 ? null : (Array.isArray(mv?.state?.allocationQueues) && mv.state.allocationQueues.length > 0 ? mv.state.allocationQueues[0].withdrawQueueIndex ?? null : null),
      },
      warnings: [],
      metadata: mv?.metadata || {},
      historicalData: {
        apy: mv?.historicalState?.apy || [],
        netApy: mv?.historicalState?.netApy || [],
        totalAssets: mv?.historicalState?.totalAssets || [],
        totalAssetsUsd: mv?.historicalState?.totalAssetsUsd || [],
      },
      roles: {
        owner: isV2 ? (mv?.owner?.address ?? null) : (mv?.state?.owner ?? null),
        curator: isV2 ? (mv?.curator?.address ?? null) : (mv?.state?.curator ?? null),
        guardian: isV2 ? null : (mv?.state?.guardian ?? null),
        timelock: isV2 ? null : (mv?.state?.timelock ?? null),
      },
      transactions: txs.map((t) => ({
        blockNumber: t.blockNumber,
        hash: t.hash,
        type: t.type,
        userAddress: t.user?.address ?? null,
      })),
      parameters: {
        performanceFeeBps: performanceFeeBps,
        performanceFeePercent: performanceFeeBps ? performanceFeeBps / 100 : null,
        maxDeposit: null,
        maxWithdrawal: null,
        strategyNotes: '',
      },
    };

    const responseHeaders = new Headers(rateLimitResult.headers);
    responseHeaders.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');

    return NextResponse.json(result, { headers: responseHeaders });
  } catch (err) {
    const { error, statusCode } = handleApiError(err, 'Failed to fetch vault details');
    return NextResponse.json(error, { status: statusCode });
  }
}


