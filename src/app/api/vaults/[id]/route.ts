import { NextRequest, NextResponse } from 'next/server';
import { getVaultByAddress, vaultDisplayName } from '@/lib/config/vaults';
import { BPS_PER_ONE } from '@/lib/constants';
import { handleApiError, AppError } from '@/lib/utils/error-handler';
import { createRateLimitMiddleware, RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS } from '@/lib/utils/rate-limit';
import { loadRestVaultSnapshot, type RestVaultSnapshot } from '@/lib/morpho/rest-vault.server';
import { getAddress, isAddress } from 'viem';
import { logger } from '@/lib/utils/logger';
import { buildVaultAnalytics } from '@/lib/morpho/vault-analytics';
import { mapCap } from '@/lib/morpho/vault-v2-governance-map';
import type { CapInfo } from '@/app/api/vaults/[id]/governance/route';
import { mergeApiCacheHeaders } from '@/lib/api/response-cache';
import { unauthorizedUnlessAdmin } from '@/lib/auth/require-admin';

type V2VaultGraphQL = {
  address?: string;
  name?: string | null;
  symbol?: string | null;
  listed?: boolean | null;
  warnings?: Array<{ type?: string; level?: string }>;
  metadata?: {
    description?: string | null;
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

/** The detail fields, from the shared REST vault snapshot (GraphQL-shaped for the mapper). */
function detailFromSnapshot(snap: RestVaultSnapshot): V2VaultGraphQL {
  return {
    address: snap.address,
    name: snap.vault.name,
    symbol: snap.vault.symbol,
    // Not in Morpho REST: `listed`, `warnings`, `metadata`, rewards (none on our vaults).
    listed: null,
    warnings: [],
    metadata: null,
    asset: { address: snap.vault.asset.address, symbol: snap.vault.asset.symbol ?? undefined, decimals: snap.vault.asset.decimals },
    curator: { address: snap.vault.curator },
    owner: { address: snap.vault.owner },
    totalAssetsUsd: snap.totalAssetsUsd,
    idleAssets: snap.idleAssets,
    idleAssetsUsd: snap.idleAssetsUsd,
    totalAssets: snap.totalAssets,
    liquidity: snap.liquidity,
    liquidityUsd: snap.liquidityUsd,
    performanceFee: snap.performanceFee,
    managementFee: snap.managementFee,
    caps: { items: snap.caps },
    maxApy: null,
    apy: snap.grossApy,
    netApy: snap.netApy,
    netApyExcludingRewards: snap.netApy,
    avgNetApy: snap.netApy,
    rewards: [],
  };
}

function mapV2VaultDetail(
  mv: V2VaultGraphQL,
  cfg: ReturnType<typeof getVaultByAddress>,
  address: string
) {
  // Depositor count needs a vault-wide holder list, which Morpho REST does not have.
  const depositors = null;

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

  return {
    ...cfg,
    version: 'v2' as const,
    address,
    name: vaultDisplayName(mv.name),
    symbol: mv.symbol ?? mv.asset?.symbol ?? 'UNKNOWN',
    asset: mv.asset?.symbol ?? 'UNKNOWN',
    assetDecimals: mv.asset?.decimals ?? null,
    tvl: tvlUsd,
    totalAssetsUnderlying,
    apy: apyPct,
    apyBase: mv.apy != null ? mv.apy * 100 : null,
    apyBoosted: mv.avgNetApy != null ? mv.avgNetApy * 100 : null,
    treasuryRevenueYtd: null,
    utilization,
    analytics,
    depositors,
    revenueAllTime: null,
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
    transactions: [],
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

    let vaultData: V2VaultGraphQL;
    try {
      vaultData = detailFromSnapshot(await loadRestVaultSnapshot(cfg.chainId, address));
    } catch (restError) {
      logger.error(
        'Morpho REST read failed for v2 vault',
        restError instanceof Error ? restError : new Error(String(restError)),
        { address }
      );
      // Surface the failure: a 200 placeholder would be cached by React Query as real data.
      throw new AppError('Morpho API request failed for this vault. Retry shortly.', 502, 'UPSTREAM_ERROR');
    }

    const result = mapV2VaultDetail(vaultData, cfg, address);
    const responseHeaders = mergeApiCacheHeaders(rateLimitResult.headers, 60);
    return NextResponse.json(result, { headers: responseHeaders });
  } catch (err) {
    const { error, statusCode } = handleApiError(err, 'Failed to fetch vault details');
    return NextResponse.json(error, { status: statusCode });
  }
}
