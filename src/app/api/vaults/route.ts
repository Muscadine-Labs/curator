import { NextResponse } from 'next/server';
import {
  getAllVaultAddresses,
  getSidebarVaultAddresses,
  getVaultAddressesForBusinessViews,
  getVaultByAddress,
  vaultDisplayName,
} from '@/lib/config/vaults';
import { BASE_CHAIN_ID, BPS_PER_ONE, getScanUrlForChain } from '@/lib/constants';
import { handleApiError } from '@/lib/utils/error-handler';
import { createRateLimitMiddleware, RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS } from '@/lib/utils/rate-limit';
import { loadRestVaultSnapshot, type RestVaultSnapshot } from '@/lib/morpho/rest-vault.server';
import { getAddress } from 'viem';
import { logger } from '@/lib/utils/logger';
import { mergeApiCacheHeaders, API_CACHE_MAX_AGE_MS } from '@/lib/api/response-cache';
import { withServerResponseCache } from '@/lib/api/server-response-cache';
import { unauthorizedUnlessAdmin } from '@/lib/auth/require-admin';
import { utilizationFractionToPercentagePoints } from '@/lib/morpho/utilization-percent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type VaultListGql = {
  address?: string;
  name?: string;
  symbol?: string;
  listed?: boolean;
  asset?: { address?: string; symbol?: string; decimals?: number };
  performanceFee?: number;
  totalAssets?: string | number | null;
  totalAssetsUsd?: number;
  apy?: number;
  netApy?: number;
  avgNetApy?: number;
  idleAssets?: string | number | null;
  liquidity?: string | number | null;
  liquidityUsd?: number | null;
  liquidityAdapter?: {
    __typename?: string | null;
    address?: string | null;
    type?: string | null;
    innerVault?: { name?: string | null; symbol?: string | null } | null;
    metaMorpho?: { name?: string | null; symbol?: string | null } | null;
  } | null;
  liquidityData?: {
    __typename?: string | null;
    market?: {
      loanAsset?: { symbol?: string | null } | null;
      collateralAsset?: { symbol?: string | null } | null;
      state?: { utilization?: number | null } | null;
    } | null;
    metaMorpho?: { name?: string | null; symbol?: string | null } | null;
  } | null;
};

/** The list fields from the shared REST vault snapshot (GraphQL-shaped for the mapper). */
function listRowFromSnapshot(snap: RestVaultSnapshot): VaultListGql {
  const route = snap.liquidityData?.market;
  const routeState = route ? snap.markets.get(route.marketId.toLowerCase()) : undefined;
  return {
    address: snap.address,
    name: snap.vault.name ?? undefined,
    symbol: snap.vault.symbol ?? undefined,
    // Not in Morpho REST. Every configured vault is unlisted on Morpho anyway (status paused).
    listed: undefined,
    asset: { address: snap.vault.asset.address, symbol: snap.vault.asset.symbol ?? undefined, decimals: snap.vault.asset.decimals },
    performanceFee: snap.performanceFee,
    totalAssets: snap.totalAssets,
    totalAssetsUsd: snap.totalAssetsUsd ?? undefined,
    apy: snap.grossApy ?? undefined,
    netApy: snap.netApy ?? undefined,
    idleAssets: snap.idleAssets,
    liquidity: snap.liquidity,
    liquidityUsd: snap.liquidityUsd,
    liquidityAdapter: snap.liquidityAdapter
      ? {
          __typename: snap.liquidityAdapter.__typename,
          address: snap.liquidityAdapter.address,
          type: snap.liquidityAdapter.type,
          innerVault: snap.liquidityAdapter.innerVault,
        }
      : null,
    liquidityData: route
      ? {
          __typename: 'MarketV1LiquidityData',
          market: {
            loanAsset: { symbol: route.loanAsset.symbol },
            collateralAsset: { symbol: route.collateralAsset.symbol },
            state: { utilization: routeState?.utilization ?? null },
          },
        }
      : null,
  };
}

function listLiquidityAdapter(v: VaultListGql): {
  label: string;
  utilizationPercent: number | null;
} | null {
  const data = v.liquidityData;
  if (data?.__typename === 'MarketV1LiquidityData' && data.market) {
    const col = data.market.collateralAsset?.symbol;
    const loan = data.market.loanAsset?.symbol;
    const label =
      col && loan ? `${col} / ${loan}` : col || loan || 'Variable rate market';
    return {
      label,
      utilizationPercent: utilizationFractionToPercentagePoints(data.market.state?.utilization),
    };
  }
  if (data?.__typename === 'MetaMorphoLiquidityData') {
    const name = data.metaMorpho?.name || data.metaMorpho?.symbol;
    if (name) return { label: name, utilizationPercent: null };
  }
  if (v.liquidityAdapter?.__typename === 'MorphoVaultV2Adapter') {
    const name =
      v.liquidityAdapter.innerVault?.name || v.liquidityAdapter.innerVault?.symbol;
    if (name) return { label: name, utilizationPercent: null };
    return { label: 'Underlying vault', utilizationPercent: null };
  }
  if (!v.liquidityAdapter?.address) {
    return { label: 'Idle liquidity', utilizationPercent: null };
  }
  return { label: 'Idle liquidity', utilizationPercent: null };
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
      {
        status: 429,
        headers: rateLimitResult.headers,
      }
    );
  }

  try {
    const url = new URL(request.url);
    const sidebarOnly = url.searchParams.get('sidebar') === 'true';
    const includeAll = url.searchParams.get('includeAll') === 'true';
    const cacheKey = `vaults-list-${sidebarOnly ? 'sidebar' : includeAll ? 'all' : 'business'}`;

    const merged = await withServerResponseCache(cacheKey, API_CACHE_MAX_AGE_MS, async () => {
      const vaultConfigs = sidebarOnly
        ? getSidebarVaultAddresses()
        : includeAll
          ? getAllVaultAddresses()
          : getVaultAddressesForBusinessViews();
      const addresses = vaultConfigs.map((v) => getAddress(v.address));
      const configuredAddressSet = new Set(addresses.map((a) => a.toLowerCase()));

      // One shared REST snapshot per vault (cached 30s; the vault pages reuse it). A vault whose
      // read fails is left out of the list, like a vault GraphQL did not return.
      const snapshots = await Promise.all(
        vaultConfigs.map((v) =>
          loadRestVaultSnapshot(v.chainId ?? BASE_CHAIN_ID, v.address).catch((error: unknown) => {
            logger.warn('Morpho REST read failed for a listed vault', {
              address: v.address,
              error: error instanceof Error ? error.message : String(error),
            });
            return null;
          })
        )
      );
      const v2Vaults = snapshots
        .filter((snap): snap is RestVaultSnapshot => snap !== null)
        .map(listRowFromSnapshot)
        .filter((v) => configuredAddressSet.has(v.address!.toLowerCase()));

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
        const chainId = getChainId(v.address!);
        return enrichFromConfig({
          address: v.address!,
          name: vaultDisplayName(v.name),
          symbol: v.symbol ?? v.asset?.symbol ?? 'UNKNOWN',
          asset: v.asset?.symbol ?? 'UNKNOWN',
          assetDecimals: v.asset?.decimals ?? null,
          chainId,
          scanUrl: `${getScanUrlForChain(chainId)}/address/${v.address}`,
          performanceFeeBps:
            v.performanceFee != null ? Math.round(v.performanceFee * BPS_PER_ONE) : null,
          status: v.listed ? ('active' as const) : ('paused' as const),
          riskTier: 'medium' as const,
          createdAt: null as string | null,
          tvl: v.totalAssetsUsd ?? null,
          totalAssetsUnderlying:
            v.totalAssets != null && v.totalAssets !== ''
              ? String(v.totalAssets)
              : null,
          apy:
            v.netApy != null
              ? v.netApy * 100
              : v.avgNetApy != null
                ? v.avgNetApy * 100
                : v.apy != null
                  ? v.apy * 100
                  : null,
          // Needs a vault-wide holder list, which Morpho REST does not have.
          depositors: null,
          revenueAllTime: null,
          feesAllTime: null,
          lastHarvest: null,
          idleAssetsUnderlying:
            v.idleAssets != null && v.idleAssets !== ''
              ? String(v.idleAssets)
              : null,
          liquidityUnderlying:
            v.liquidity != null && v.liquidity !== ''
              ? String(v.liquidity)
              : null,
          liquidityUsd: v.liquidityUsd ?? null,
          liquidityAdapter: listLiquidityAdapter(v),
        });
      });

      logger.debug('V2 vaults fetched', {
        found: v2Vaults.length,
        queried: addresses.length,
      });

      return allVaults.filter((v) => configuredAddressSet.has(v.address.toLowerCase()));
    });

    return NextResponse.json(merged, {
      headers: mergeApiCacheHeaders(rateLimitResult.headers),
    });
  } catch (err) {
    const { error, statusCode } = handleApiError(err, 'Failed to fetch vaults');
    return NextResponse.json(error, { status: statusCode });
  }
}
