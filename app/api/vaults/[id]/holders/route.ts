import { NextRequest, NextResponse } from 'next/server';
import { gql } from 'graphql-request';
import { getAddress, isAddress } from 'viem';
import { morphoGraphQLClient } from '@/lib/morpho/graphql-client';
import { getVaultByAddress, shouldUseV2Query } from '@/lib/config/vaults';
import { handleApiError, AppError } from '@/lib/utils/error-handler';
import { createRateLimitMiddleware, RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS } from '@/lib/utils/rate-limit';
import { BASE_CHAIN_ID } from '@/lib/constants';

export type VaultHolder = {
  address: string;
  shares: string | null;
  assets: string | null;
  assetsUsd: number | null;
};

export type VaultHoldersResponse = {
  vaultAddress: string;
  version: 'v1' | 'v2';
  asset: {
    symbol: string | null;
    decimals: number | null;
  };
  totalHolders: number;
  holders: VaultHolder[];
};

const V1_HOLDERS_QUERY = gql`
  query V1VaultHolders(
    $first: Int!
    $skip: Int!
    $vaultAddress: [String!]!
    $vaultAddressSingle: String!
    $chainId: Int!
  ) {
    vaultByAddress(address: $vaultAddressSingle, chainId: $chainId) {
      address
      asset {
        symbol
        decimals
      }
    }
    vaultPositions(
      first: $first
      skip: $skip
      orderBy: Shares
      orderDirection: Desc
      where: { vaultAddress_in: $vaultAddress }
    ) {
      items {
        user {
          address
        }
        state {
          shares
          assets
          assetsUsd
        }
      }
      pageInfo {
        countTotal
      }
    }
  }
`;

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

type V1GraphResponse = {
  vaultByAddress?: {
    address?: string | null;
    asset?: { symbol?: string | null; decimals?: number | null } | null;
  } | null;
  vaultPositions?: {
    items?: Array<{
      user?: { address?: string | null } | null;
      state?: { shares?: string | null; assets?: string | null; assetsUsd?: number | null } | null;
    } | null> | null;
    pageInfo?: { countTotal?: number | null } | null;
  } | null;
};

type V2GraphResponse = {
  vaultV2ByAddress?: {
    address?: string | null;
    asset?: { symbol?: string | null; decimals?: number | null } | null;
    positions?: {
      items?: Array<{
        user?: { address?: string | null } | null;
        assets?: string | null;
        assetsUsd?: number | null;
        shares?: string | null;
      } | null> | null;
      pageInfo?: { countTotal?: number | null } | null;
    } | null;
  } | null;
};

function parseInt_(value: string | null, fallback: number, max: number): number {
  const n = value ? Number(value) : fallback;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const url = new URL(request.url);
    const first = parseInt_(url.searchParams.get('first'), 100, 1000);
    const skip = parseInt_(url.searchParams.get('skip'), 0, 10_000);

    const isV2 = shouldUseV2Query(null, vaultAddress);
    const chainId = vaultConfig.chainId ?? BASE_CHAIN_ID;

    let holders: VaultHolder[] = [];
    let totalHolders = 0;
    let assetSymbol: string | null = null;
    let assetDecimals: number | null = null;

    if (isV2) {
      const data = await morphoGraphQLClient.request<V2GraphResponse>(V2_HOLDERS_QUERY, {
        address: vaultAddress,
        chainId,
        first,
        skip,
      });
      const v2 = data.vaultV2ByAddress;
      assetSymbol = v2?.asset?.symbol ?? null;
      assetDecimals = v2?.asset?.decimals ?? null;
      totalHolders = v2?.positions?.pageInfo?.countTotal ?? 0;
      holders = (v2?.positions?.items ?? [])
        .filter((x): x is NonNullable<typeof x> => x !== null && Boolean(x.user?.address))
        .map((h) => ({
          address: String(h.user!.address),
          shares: h.shares ?? null,
          assets: h.assets ?? null,
          assetsUsd: h.assetsUsd ?? null,
        }));
    } else {
      const data = await morphoGraphQLClient.request<V1GraphResponse>(V1_HOLDERS_QUERY, {
        first,
        skip,
        vaultAddress: [vaultAddress.toLowerCase()],
        vaultAddressSingle: vaultAddress,
        chainId,
      });
      assetSymbol = data.vaultByAddress?.asset?.symbol ?? null;
      assetDecimals = data.vaultByAddress?.asset?.decimals ?? null;
      const items = data.vaultPositions?.items ?? [];
      totalHolders = data.vaultPositions?.pageInfo?.countTotal ?? 0;
      holders = items
        .filter((x): x is NonNullable<typeof x> => x !== null && Boolean(x.user?.address))
        .map((h) => ({
          address: String(h.user!.address),
          shares: h.state?.shares ?? null,
          assets: h.state?.assets ?? null,
          assetsUsd: h.state?.assetsUsd ?? null,
        }));
    }

    const response: VaultHoldersResponse = {
      vaultAddress,
      version: isV2 ? 'v2' : 'v1',
      asset: { symbol: assetSymbol, decimals: assetDecimals },
      totalHolders,
      holders,
    };

    const responseHeaders = new Headers(rateLimitResult.headers);
    responseHeaders.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    return NextResponse.json(response, { headers: responseHeaders });
  } catch (error) {
    const { error: apiError, statusCode } = handleApiError(error, 'Failed to fetch vault holders');
    return NextResponse.json(apiError, { status: statusCode });
  }
}
