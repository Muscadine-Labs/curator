import { NextResponse } from 'next/server';
import {
  getAllVaultAddresses,
  getSidebarVaultAddresses,
  getVaultAddressesForBusinessViews,
  getVaultByAddress,
  withFeeWrapperLabel,
} from '@/lib/config/vaults';
import { BASE_CHAIN_ID, BPS_PER_ONE, getScanUrlForChain } from '@/lib/constants';
import { handleApiError } from '@/lib/utils/error-handler';
import { createRateLimitMiddleware, RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS } from '@/lib/utils/rate-limit';
import { batchVaultV2ByAddress } from '@/lib/morpho/batch-vault-graphql';
import { getAddress } from 'viem';
import { logger } from '@/lib/utils/logger';
import { mergeApiCacheHeaders, API_CACHE_MAX_AGE_MS } from '@/lib/api/response-cache';
import { withServerResponseCache } from '@/lib/api/server-response-cache';
import { unauthorizedUnlessAdmin } from '@/lib/auth/require-admin';
import { readSessionRole, tokenFromCookieHeader } from '@/lib/auth/session';
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

const VAULT_LIST_SELECTION = `
  address
  name
  symbol
  listed
  asset { address symbol decimals }
  performanceFee
  totalAssets
  totalAssetsUsd
  apy
  netApy
  avgNetApy
  idleAssets
  liquidity
  liquidityUsd
  liquidityAdapter {
    __typename
    address
    ... on MetaMorphoAdapter { type }
    ... on MorphoMarketV1Adapter { type }
    ... on MorphoVaultV2Adapter {
      type
      innerVault { name symbol }
    }
  }
  liquidityData {
    __typename
    ... on MarketV1LiquidityData {
      market {
        loanAsset { symbol }
        collateralAsset { symbol }
        state { utilization }
      }
    }
    ... on MetaMorphoLiquidityData {
      metaMorpho { name symbol }
    }
  }
`;

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
    const role = await readSessionRole(
      tokenFromCookieHeader(request.headers.get('cookie'))
    );
    const isAdmin = role === 'admin';
    // Public callers always get the business catalog, which omits testing vaults.
    const sidebarOnly = isAdmin && url.searchParams.get('sidebar') === 'true';
    const includeAll = isAdmin && url.searchParams.get('includeAll') === 'true';
    const cacheKey = `vaults-list-${sidebarOnly ? 'sidebar' : includeAll ? 'all' : 'business'}`;

    const merged = await withServerResponseCache(cacheKey, API_CACHE_MAX_AGE_MS, async () => {
      const vaultConfigs = sidebarOnly
        ? getSidebarVaultAddresses()
        : includeAll
          ? getAllVaultAddresses()
          : getVaultAddressesForBusinessViews();
      const addresses = vaultConfigs.map((v) => getAddress(v.address));
      const configuredAddressSet = new Set(addresses.map((a) => a.toLowerCase()));

      const vaultRefs = vaultConfigs.map((v) => ({
        address: v.address,
        chainId: v.chainId ?? BASE_CHAIN_ID,
      }));

      const gqlMap = await batchVaultV2ByAddress<VaultListGql>(
        vaultRefs,
        VAULT_LIST_SELECTION
      );

      const v2Vaults = addresses
        .map((address) => gqlMap.get(address.toLowerCase()) ?? null)
        .filter((v): v is VaultListGql => Boolean(v?.address));

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
          kind: cfg?.kind ?? 'strategy',
          underlyingAddress: cfg?.underlyingAddress ?? null,
        };
      };

      const allVaults = v2Vaults.map((v) => {
        const chainId = getChainId(v.address!);
        const cfg = getVaultByAddress(v.address!);
        return enrichFromConfig({
          address: v.address!,
          name: withFeeWrapperLabel(v.name ?? 'Unknown Vault', v.address!),
          symbol: v.symbol ?? v.asset?.symbol ?? 'UNKNOWN',
          asset: v.asset?.symbol ?? 'UNKNOWN',
          assetDecimals: v.asset?.decimals ?? null,
          chainId,
          scanUrl: `${getScanUrlForChain(chainId)}/address/${v.address}`,
          performanceFeeBps:
            v.performanceFee != null ? Math.round(v.performanceFee * BPS_PER_ONE) : null,
          status:
            cfg?.kind === 'feeWrapper' || v.listed ? ('active' as const) : ('paused' as const),
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
          depositors: 0,
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
