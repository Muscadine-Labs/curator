import { NextRequest, NextResponse } from 'next/server';
import { gql } from 'graphql-request';
import { getAddress, isAddress } from 'viem';
import { morphoGraphQLClient } from '@/lib/morpho/graphql-client';
import { getVaultByAddress, shouldUseV2Query } from '@/lib/config/vaults';
import { handleApiError, AppError } from '@/lib/utils/error-handler';
import { createRateLimitMiddleware, RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS } from '@/lib/utils/rate-limit';
import { BASE_CHAIN_ID } from '@/lib/constants';

export type ReallocationEvent = {
  hash: string;
  timestamp: number | null;
  blockNumber: number | null;
  type: string;
  assets: string | null;
  market: {
    uniqueKey: string | null;
    loanAssetSymbol: string | null;
    collateralAssetSymbol: string | null;
    lltv: string | null;
  } | null;
};

export type ReallocationGroup = {
  timestamp: number;
  hash: string;
  blockNumber: number | null;
  events: ReallocationEvent[];
};

export type ReallocationsResponse = {
  vaultAddress: string;
  version: 'v1' | 'v2';
  groups: ReallocationGroup[];
};

const V1_REALLOCATIONS_QUERY = gql`
  query V1VaultReallocations($first: Int!, $skip: Int!, $vaultAddress: [String!]!) {
    vaultReallocates(
      first: $first
      skip: $skip
      orderBy: Timestamp
      orderDirection: Desc
      where: { vaultAddress_in: $vaultAddress }
    ) {
      items {
        hash
        timestamp
        blockNumber
        assets
        type
        market {
          uniqueKey
          lltv
          loanAsset {
            symbol
          }
          collateralAsset {
            symbol
          }
        }
      }
    }
  }
`;

const V2_REALLOCATIONS_QUERY = gql`
  query V2VaultReallocations($first: Int!, $skip: Int!, $vaultAddress: [String!]!, $chainIds: [Int!]) {
    vaultV2transactions(
      first: $first
      skip: $skip
      where: {
        vaultAddress_in: $vaultAddress
        chainId_in: $chainIds
        type_in: ["VaultV2Allocate", "VaultV2Deallocate", "VaultV2Reallocate"]
      }
    ) {
      items {
        txHash
        blockNumber
        timestamp
        type
        shares
      }
    }
  }
`;

type V1GraphResponse = {
  vaultReallocates?: {
    items?: Array<{
      hash?: string | null;
      timestamp?: number | string | null;
      blockNumber?: number | string | null;
      assets?: string | null;
      type?: string | null;
      market?: {
        uniqueKey?: string | null;
        lltv?: string | null;
        loanAsset?: { symbol?: string | null } | null;
        collateralAsset?: { symbol?: string | null } | null;
      } | null;
    } | null> | null;
  } | null;
};

type V2GraphResponse = {
  vaultV2transactions?: {
    items?: Array<{
      txHash?: string | null;
      blockNumber?: number | string | null;
      timestamp?: number | string | null;
      type?: string | null;
      shares?: string | null;
    } | null> | null;
  } | null;
};

function groupByTransaction(events: ReallocationEvent[]): ReallocationGroup[] {
  const map = new Map<string, ReallocationGroup>();
  for (const ev of events) {
    const existing = map.get(ev.hash);
    if (existing) {
      existing.events.push(ev);
    } else {
      map.set(ev.hash, {
        timestamp: ev.timestamp ?? 0,
        hash: ev.hash,
        blockNumber: ev.blockNumber,
        events: [ev],
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.timestamp - a.timestamp);
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
    const first = Math.min(Number(url.searchParams.get('first') || '100'), 500);
    const skip = Math.min(Number(url.searchParams.get('skip') || '0'), 10_000);

    const isV2 = shouldUseV2Query(null, vaultAddress);
    let events: ReallocationEvent[] = [];

    if (isV2) {
      const chainIds = [vaultConfig.chainId ?? BASE_CHAIN_ID];
      const data = await morphoGraphQLClient.request<V2GraphResponse>(V2_REALLOCATIONS_QUERY, {
        first,
        skip,
        vaultAddress: [vaultAddress.toLowerCase()],
        chainIds,
      });
      const items = data.vaultV2transactions?.items ?? [];
      events = items
        .filter((x): x is NonNullable<typeof x> => x !== null && Boolean(x.txHash))
        .map((tx) => ({
          hash: String(tx.txHash),
          timestamp: tx.timestamp != null ? Number(tx.timestamp) : null,
          blockNumber: tx.blockNumber != null ? Number(tx.blockNumber) : null,
          type: tx.type ?? 'Unknown',
          assets: tx.shares ?? null,
          market: null,
        }));
    } else {
      const data = await morphoGraphQLClient.request<V1GraphResponse>(V1_REALLOCATIONS_QUERY, {
        first,
        skip,
        vaultAddress: [vaultAddress.toLowerCase()],
      });
      const items = data.vaultReallocates?.items ?? [];
      events = items
        .filter((x): x is NonNullable<typeof x> => x !== null && Boolean(x.hash))
        .map((tx) => ({
          hash: String(tx.hash),
          timestamp: tx.timestamp != null ? Number(tx.timestamp) : null,
          blockNumber: tx.blockNumber != null ? Number(tx.blockNumber) : null,
          type: tx.type ?? 'Unknown',
          assets: tx.assets ?? null,
          market: tx.market
            ? {
                uniqueKey: tx.market.uniqueKey ?? null,
                loanAssetSymbol: tx.market.loanAsset?.symbol ?? null,
                collateralAssetSymbol: tx.market.collateralAsset?.symbol ?? null,
                lltv: tx.market.lltv ?? null,
              }
            : null,
        }));
    }

    const groups = groupByTransaction(events);

    const response: ReallocationsResponse = {
      vaultAddress,
      version: isV2 ? 'v2' : 'v1',
      groups,
    };

    const responseHeaders = new Headers(rateLimitResult.headers);
    responseHeaders.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    return NextResponse.json(response, { headers: responseHeaders });
  } catch (error) {
    const { error: apiError, statusCode } = handleApiError(error, 'Failed to fetch reallocations');
    return NextResponse.json(apiError, { status: statusCode });
  }
}
