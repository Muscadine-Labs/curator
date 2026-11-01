import { NextRequest, NextResponse } from 'next/server';
import { gql } from 'graphql-request';
import { getAddress, isAddress } from 'viem';
import { morphoGraphQLClient } from '@/lib/morpho/graphql-client';
import { getVaultByAddress } from '@/lib/config/vaults';
import { handleApiError, AppError } from '@/lib/utils/error-handler';
import { createRateLimitMiddleware, RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS } from '@/lib/utils/rate-limit';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { API_CACHE_MAX_AGE_MS, mergeApiCacheHeaders } from '@/lib/api/response-cache';
import { withServerResponseCache } from '@/lib/api/server-response-cache';
import { parseBoundedIntParam } from '@/lib/api/query-params';
import { unauthorizedUnlessAdmin } from '@/lib/auth/require-admin';

export type VaultHolder = {
  address: string;
  shares: string | null;
  assets: string | null;
  assetsUsd: number | null;
};

export type VaultHoldersResponse = {
  vaultAddress: string;
  version: 'v2';
  asset: {
    symbol: string | null;
    decimals: number | null;
  };
  totalHolders: number;
  holders: VaultHolder[];
};

const V2_HOLDERS_QUERY = gql`
  query V2VaultHolders($address: String!, $chainId: Int!, $first: Int!, $skip: Int!) {
    vaultV2ByAddress(address: $address, chainId: $chainId) {
      address
      asset {
        symbol
        decimals
      }
      positions(first: $first, skip: $skip) {
        items {
          user {
            address
          }
          assets
          assetsUsd
          shares
        }
        pageInfo {
          countTotal
        }
      }
    }
  }
`;

type GraphPosition = {
  user?: { address?: string | null } | null;
  assets?: string | null;
  assetsUsd?: number | null;
  shares?: string | null;
};

type V2GraphResponse = {
  vaultV2ByAddress?: {
    address?: string | null;
    asset?: { symbol?: string | null; decimals?: number | null } | null;
    positions?: {
      items?: Array<GraphPosition | null> | null;
      pageInfo?: { countTotal?: number | null } | null;
    } | null;
  } | null;
};

const PAGE = 1000;
/** Safety bound: 10 pages. Holders past this are counted but not ranked. */
const MAX_HOLDER_ROWS = 10_000;

/**
 * Every position, paged past the 1,000-row limit, so "top holders" ranks the
 * whole vault — `positions` has no orderBy, so sorting one page is not a top list.
 */
async function fetchAllPositions(vaultAddress: string, chainId: number) {
  const items: Array<GraphPosition | null> = [];
  let head: V2GraphResponse['vaultV2ByAddress'] = null;
  for (let skip = 0; skip < MAX_HOLDER_ROWS; skip += PAGE) {
    const data = await morphoGraphQLClient.request<V2GraphResponse>(V2_HOLDERS_QUERY, {
      address: vaultAddress,
      chainId,
      first: PAGE,
      skip,
    });
    const v2 = data.vaultV2ByAddress;
    head ??= v2;
    const page = v2?.positions?.items ?? [];
    items.push(...page);
    if (page.length < PAGE) break;
  }
  return { head, items };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await unauthorizedUnlessAdmin(request);
  if (denied) return denied;
  const rateLimit = createRateLimitMiddleware(RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS);
  const rateLimitResult = rateLimit(request);
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      { status: 429, headers: rateLimitResult.headers }
    );
  }

  try {
    const resolvedParams = await params;
    const rawAddress = resolvedParams?.id;

    if (!rawAddress || !isAddress(rawAddress)) {
      throw new AppError('Invalid vault address', 400, 'INVALID_ADDRESS');
    }

    const vaultAddress = getAddress(rawAddress);
    const vaultConfig = getVaultByAddress(vaultAddress);
    if (!vaultConfig) {
      throw new AppError('Vault not found', 404, 'VAULT_NOT_FOUND');
    }

    if (vaultConfig.morphoVersion !== 'v2') {
      throw new AppError('Vault not found', 404, 'VAULT_NOT_FOUND');
    }

    const url = new URL(request.url);
    const first = parseBoundedIntParam(url.searchParams.get('first'), 100, { min: 1, max: 1000 });
    const skip = parseBoundedIntParam(url.searchParams.get('skip'), 0, { min: 0, max: 10_000 });
    const chainId = vaultConfig.chainId ?? BASE_CHAIN_ID;

    const { head, items } = await withServerResponseCache(
      `vault-holders:${chainId}:${vaultAddress.toLowerCase()}`,
      API_CACHE_MAX_AGE_MS,
      () => fetchAllPositions(vaultAddress, chainId)
    );
    const assetSymbol = head?.asset?.symbol ?? null;
    const assetDecimals = head?.asset?.decimals ?? null;
    const totalHolders = head?.positions?.pageInfo?.countTotal ?? items.length;
    const holders = items
      .filter((x): x is NonNullable<typeof x> => x !== null && Boolean(x.user?.address))
      .map((h) => ({
        address: String(h.user!.address),
        shares: h.shares != null ? String(h.shares) : null,
        assets: h.assets != null ? String(h.assets) : null,
        assetsUsd: h.assetsUsd ?? null,
      }))
      .sort((a, b) => (b.assetsUsd ?? 0) - (a.assetsUsd ?? 0))
      .slice(skip, skip + first);

    const response: VaultHoldersResponse = {
      vaultAddress,
      version: 'v2',
      asset: { symbol: assetSymbol, decimals: assetDecimals },
      totalHolders,
      holders,
    };

    const responseHeaders = mergeApiCacheHeaders(rateLimitResult.headers, 60);
    return NextResponse.json(response, { headers: responseHeaders });
  } catch (error) {
    const { error: apiError, statusCode } = handleApiError(error, 'Failed to fetch vault holders');
    return NextResponse.json(apiError, { status: statusCode });
  }
}
