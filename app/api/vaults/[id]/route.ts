import { NextRequest, NextResponse } from 'next/server';
import { getVaultByAddress } from '@/lib/config/vaults';
import { BPS_PER_ONE, GRAPHQL_FIRST_LIMIT, GRAPHQL_TRANSACTIONS_LIMIT } from '@/lib/constants';
import { handleApiError, AppError } from '@/lib/utils/error-handler';
import { createRateLimitMiddleware, RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS } from '@/lib/utils/rate-limit';
import { morphoGraphQLClient } from '@/lib/morpho/graphql-client';
import { computeTreasuryStatement } from '@/lib/morpho/compute-treasury-statement';
import {
  aggregateTreasuryRevenueByVault,
  treasuryRevenueAllTimeForVault,
  treasuryRevenueYtdForVault,
} from '@/lib/morpho/treasury-statement';
import { gql } from 'graphql-request';
import { getAddress, isAddress } from 'viem';
import { logger } from '@/lib/utils/logger';
import { buildVaultAnalytics } from '@/lib/morpho/vault-analytics';
import { mapCap } from '@/lib/morpho/vault-v2-governance-map';
import type { CapInfo } from '@/app/api/vaults/v2/[id]/governance/route';
import { mergeApiCacheHeaders } from '@/lib/api/response-cache';
import {
  vaultV2TransactionUser,
  type VaultV2TxData,
} from '@/lib/morpho/vault-v2-transaction-utils';

type VaultDetailQueryResponse = {
  vaultV2ByAddress?: V2VaultGraphQL | null;
  vaultV2transactions?: {
    items: Array<{
      blockNumber: number | string | null;
      txHash: string | null;
      type: string | null;
      data?: VaultV2TxData;
    } | null> | null;
  } | null;
};

type V2VaultGraphQL = {
  address?: string;
  name?: string | null;
  symbol?: string | null;
  listed?: boolean | null;
  warnings?: Array<{ type?: string; level?: string }>;
  metadata?: {
    description?: string | null;
    forumLink?: string | null;
    image?: string | null;
  } | null;
  asset?: {
    address?: string;
    symbol?: string;
    decimals?: number;
  } | null;
  curator?: { address?: string | null } | null;
  owner?: { address?: string | null } | null;
  totalAssetsUsd?: number | null;
  idleAssets?: string | number | null;
  idleAssetsUsd?: number | null;
  totalAssets?: string | number | null;
  liquidity?: string | number | null;
  liquidityUsd?: number | null;
  performanceFee?: number | null;
  managementFee?: number | null;
  caps?: { items?: Array<Parameters<typeof mapCap>[0] | null> | null } | null;
  maxApy?: number | null;
  apy?: number | null;
  netApy?: number | null;
  netApyExcludingRewards?: number | null;
  avgNetApy?: number | null;
  rewards?: Array<{
    asset?: { address?: string; chain?: { id?: number } | null } | null;
    supplyApr?: number | null;
  }>;
  positions?: {
    items?: Array<{ user?: { address?: string | null } | null } | null> | null;
  } | null;
};

const VAULT_V2_DETAIL_QUERY = gql`
  query VaultV2Detail($address: String!, $chainId: Int!) {
    vaultV2ByAddress(address: $address, chainId: $chainId) {
      address
      name
      symbol
      listed
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
      idleAssets
      idleAssetsUsd
      liquidity
      liquidityUsd
      performanceFee
      managementFee
      maxApy
      avgNetApy
      apy
      netApy
      netApyExcludingRewards
      warnings { type level }
      caps {
        items {
          type
          absoluteCap
          relativeCap
          allocation
          data {
            __typename
            ... on AdapterCapData { adapterAddress }
            ... on MarketV1CapData {
              adapterAddress
              market { marketId }
            }
            ... on CollateralCapData { collateralAddress }
          }
        }
      }
      rewards {
        asset { address chain { id } }
        supplyApr
      }
      positions(first: ${GRAPHQL_FIRST_LIMIT}) {
        items { user { address } }
      }
    }
    vaultV2transactions(
      first: ${GRAPHQL_TRANSACTIONS_LIMIT},
      orderBy: Time,
      orderDirection: Desc,
      where: { vaultAddress_in: [$address], chainId_in: [$chainId] }
    ) {
      items {
        blockNumber
        txHash
        type
        data {
          __typename
          ... on VaultV2DepositData {
            onBehalf
            sender
          }
          ... on VaultV2WithdrawData {
            onBehalf
            receiver
            sender
          }
          ... on VaultV2TransferData {
            from
            to
          }
        }
      }
    }
  }
`;

function mapV2VaultDetail(
  mv: V2VaultGraphQL,
  cfg: ReturnType<typeof getVaultByAddress>,
  address: string,
  txs: VaultDetailQueryResponse['vaultV2transactions'],
  revenue: { revenueAllTime: number | null; feesYtd: number | null }
) {
  const positions = (mv.positions?.items ?? []).filter(
    (p): p is { user: { address: string } } =>
      p !== null && p?.user?.address !== undefined && p.user.address !== null
  );

  const depositors = new Set(
    positions.map((p) => p.user.address.toLowerCase())
  ).size;

  const tvlUsd = mv.totalAssetsUsd ?? null;
  const apyPct =
    mv.netApy != null
      ? mv.netApy * 100
      : mv.avgNetApy != null
        ? mv.avgNetApy * 100
        : mv.apy != null
          ? mv.apy * 100
          : mv.maxApy != null
            ? mv.maxApy * 100
            : null;

  const v2Caps: CapInfo[] =
    mv.caps?.items?.map(mapCap).filter((c): c is CapInfo => c !== null) ?? [];

  const utilization =
    v2Caps.length > 0
      ? buildVaultAnalytics({ tvlUsd, caps: v2Caps }).capUtilizationPercent
      : null;

  const liquidityUsd = mv.liquidityUsd ?? null;
  const liquidityUnderlying =
    mv.liquidity != null ? String(mv.liquidity) : null;
  const idleAssetsUsd = mv.idleAssetsUsd ?? null;
  const totalAssetsUnderlying =
    mv.totalAssets != null ? String(mv.totalAssets) : null;
  const idleAssetsUnderlying =
    mv.idleAssets != null ? String(mv.idleAssets) : null;

  const warnings = (mv.warnings ?? [])
    .filter((w): w is { type: string; level: string } => Boolean(w?.type && w?.level))
    .map((w) => ({
      type: w.type,
      level: w.level.toUpperCase() as 'YELLOW' | 'RED',
    }));

  const analytics = buildVaultAnalytics({
    tvlUsd,
    totalAssetsUnderlying,
    liquidityUsd,
    liquidityUnderlying,
    idleAssetsUsd,
    idleAssetsUnderlying,
    managementFee: mv.managementFee ?? null,
    caps: v2Caps,
  });

  const performanceFeeBps =
    mv.performanceFee != null ? Math.round(mv.performanceFee * BPS_PER_ONE) : null;

  const txItems = (txs?.items ?? []).filter(
    (t): t is {
      blockNumber: number | string;
      txHash: string;
      type: string;
      data?: VaultV2TxData;
    } =>
      t !== null &&
      t.txHash != null &&
      t.blockNumber != null &&
      t.type != null
  );

  return {
    ...cfg,
    version: 'v2' as const,
    address,
    name: mv.name ?? 'Unknown Vault',
    symbol: mv.symbol ?? mv.asset?.symbol ?? 'UNKNOWN',
    asset: mv.asset?.symbol ?? 'UNKNOWN',
    assetDecimals: mv.asset?.decimals ?? null,
    tvl: tvlUsd,
    apy: apyPct,
    apyBase: mv.apy != null ? mv.apy * 100 : null,
    apyBoosted: mv.avgNetApy != null ? mv.avgNetApy * 100 : null,
    feesYtd: revenue.feesYtd,
    utilization,
    analytics,
    depositors,
    revenueAllTime: revenue.revenueAllTime,
    feesAllTime: null,
    lastHarvest: null,
    apyBreakdown: {
      apy: (mv.apy ?? mv.maxApy) != null ? (mv.apy ?? mv.maxApy ?? 0) * 100 : null,
      netApy:
        mv.netApy != null
          ? mv.netApy * 100
          : mv.avgNetApy != null
            ? mv.avgNetApy * 100
            : null,
      netApyWithoutRewards:
        mv.netApyExcludingRewards != null ? mv.netApyExcludingRewards * 100 : null,
      avgApy: mv.avgNetApy != null ? mv.avgNetApy * 100 : null,
      avgNetApy: mv.avgNetApy != null ? mv.avgNetApy * 100 : null,
      dailyApy: null,
      dailyNetApy: null,
      weeklyApy: null,
      weeklyNetApy: null,
      monthlyApy: null,
      monthlyNetApy: null,
      underlyingYieldApr: null,
    },
    rewards: (mv.rewards ?? []).map((r) => ({
      assetAddress: r.asset?.address ?? '',
      chainId: r.asset?.chain?.id ?? null,
      supplyApr: r.supplyApr != null ? r.supplyApr * 100 : null,
      yearlySupplyTokens: null,
    })),
    allocation: [],
    queues: { supplyQueueIndex: null, withdrawQueueIndex: null },
    warnings,
    metadata: mv.metadata ?? {},
    historicalData: {
      apy: [],
      netApy: [],
      totalAssets: [],
      totalAssetsUsd: [],
    },
    roles: {
      owner: mv.owner?.address ?? null,
      curator: mv.curator?.address ?? null,
      guardian: null,
      timelock: null,
    },
    transactions: txItems.map((t) => ({
      blockNumber: Number(t.blockNumber),
      hash: t.txHash,
      type: t.type,
      userAddress: vaultV2TransactionUser(t.data),
    })),
    parameters: {
      performanceFeeBps: performanceFeeBps,
      performanceFeePercent: performanceFeeBps != null ? performanceFeeBps / 100 : null,
      maxDeposit: null,
      maxWithdrawal: null,
      strategyNotes: '',
    },
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const { id } = await params;

    let address: string;
    if (isAddress(id)) {
      address = getAddress(id);
    } else {
      const cfgById = getVaultByAddress(id);
      if (!cfgById) {
        throw new AppError('Vault not found', 404, 'VAULT_NOT_FOUND');
      }
      address = getAddress(cfgById.address);
    }

    const cfg = getVaultByAddress(address);
    if (!cfg) {
      throw new AppError('Vault not found in configuration', 404, 'VAULT_NOT_FOUND');
    }

    if (cfg.morphoVersion !== 'v2') {
      throw new AppError('Vault not found', 404, 'VAULT_NOT_FOUND');
    }

    const variables = { address, chainId: cfg.chainId };

    const revenuePromise = computeTreasuryStatement()
      .then((data) => {
        const revenueByVault = aggregateTreasuryRevenueByVault(data.vaults);
        return {
          revenueAllTime: treasuryRevenueAllTimeForVault(revenueByVault, address),
          feesYtd: treasuryRevenueYtdForVault(data.vaults, address),
        };
      })
      .catch(() => ({ revenueAllTime: null, feesYtd: null }));

    let data: VaultDetailQueryResponse;
    let revenue: { revenueAllTime: number | null; feesYtd: number | null } = {
      revenueAllTime: null,
      feesYtd: null,
    };

    try {
      const [graphqlData, revenueData] = await Promise.all([
        morphoGraphQLClient.request<VaultDetailQueryResponse>(VAULT_V2_DETAIL_QUERY, variables),
        revenuePromise,
      ]);
      data = graphqlData;
      revenue = revenueData;
      if (data.vaultV2ByAddress) {
        logger.debug('V2 vault data found', {
          address: cfg.address,
          name: data.vaultV2ByAddress.name,
          totalAssetsUsd: data.vaultV2ByAddress.totalAssetsUsd,
          avgNetApy: data.vaultV2ByAddress.avgNetApy,
        });
      }
    } catch (graphqlError) {
      revenue = await revenuePromise;
      logger.error(
        'GraphQL query failed for v2 vault',
        graphqlError instanceof Error ? graphqlError : new Error(String(graphqlError)),
        { address }
      );
      data = { vaultV2ByAddress: null, vaultV2transactions: null };
    }

    const vaultData = data.vaultV2ByAddress;
    if (!vaultData) {
      logger.debug('V2 vault not found in GraphQL response', {
        address: cfg.address,
        chainId: cfg.chainId,
      });

      const responseHeaders = mergeApiCacheHeaders(rateLimitResult.headers, 60);
      return NextResponse.json(
        {
          ...cfg,
          address,
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
        },
        { headers: responseHeaders }
      );
    }

    const result = mapV2VaultDetail(vaultData, cfg, address, data.vaultV2transactions, revenue);
    const responseHeaders = mergeApiCacheHeaders(rateLimitResult.headers, 60);
    return NextResponse.json(result, { headers: responseHeaders });
  } catch (err) {
    const { error, statusCode } = handleApiError(err, 'Failed to fetch vault details');
    return NextResponse.json(error, { status: statusCode });
  }
}
