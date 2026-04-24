import { NextRequest, NextResponse } from 'next/server';
import { gql } from 'graphql-request';
import { getAddress, isAddress } from 'viem';
import { morphoGraphQLClient } from '@/lib/morpho/graphql-client';
import { getVaultByAddress, shouldUseV2Query } from '@/lib/config/vaults';
import { handleApiError, AppError } from '@/lib/utils/error-handler';
import { createRateLimitMiddleware, RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS } from '@/lib/utils/rate-limit';
import { BASE_CHAIN_ID } from '@/lib/constants';

export type VaultTransaction = {
  hash: string;
  blockNumber: number | null;
  timestamp: number | null;
  type: string;
  user: string | null;
  shares: string | null;
  assets: string | null;
  assetsUsd: number | null;
};

export type VaultTransactionsResponse = {
  vaultAddress: string;
  version: 'v1' | 'v2';
  asset: {
    symbol: string | null;
    decimals: number | null;
  };
  transactions: VaultTransaction[];
};

const V1_TRANSACTIONS_QUERY = gql`
  query V1VaultTransactions($first: Int!, $skip: Int!, $vaultAddress: [String!]!, $chainIds: [Int!]) {
    transactions(
      first: $first
      skip: $skip
      orderBy: Timestamp
      orderDirection: Desc
      where: { vaultAddress_in: $vaultAddress, chainId_in: $chainIds }
    ) {
      items {
        hash
        blockNumber
        timestamp
        type
        user {
          address
        }
        data {
          ... on VaultTransactionData {
            shares
            assets
            assetsUsd
          }
        }
      }
    }
  }
`;

const V2_TRANSACTIONS_QUERY = gql`
  query V2VaultTransactions($first: Int!, $skip: Int!, $vaultAddress: [String!]!, $chainIds: [Int!]) {
    vaultV2transactions(
      first: $first
      skip: $skip
      where: { vaultAddress_in: $vaultAddress, chainId_in: $chainIds }
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
  transactions?: {
    items?: Array<{
      hash?: string | null;
      blockNumber?: number | string | null;
      timestamp?: number | string | null;
      type?: string | null;
      user?: { address?: string | null } | null;
      data?: { shares?: string | null; assets?: string | null; assetsUsd?: number | null } | null;
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

function parseFirst(value: string | null, fallback: number, max: number): number {
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
    const first = parseFirst(url.searchParams.get('first'), 100, 200);
    const skip = parseFirst(url.searchParams.get('skip'), 0, 10_000);

    const isV2 = shouldUseV2Query(null, vaultAddress);
    const chainIds = [vaultConfig.chainId ?? BASE_CHAIN_ID];

    let transactions: VaultTransaction[] = [];

    if (isV2) {
      const data = await morphoGraphQLClient.request<V2GraphResponse>(V2_TRANSACTIONS_QUERY, {
        first,
        skip,
        vaultAddress: [vaultAddress.toLowerCase()],
        chainIds,
      });
      const items = data.vaultV2transactions?.items ?? [];
      transactions = items
        .filter((x): x is NonNullable<typeof x> => x !== null && Boolean(x.txHash))
        .map((tx) => ({
          hash: String(tx.txHash),
          blockNumber: tx.blockNumber != null ? Number(tx.blockNumber) : null,
          timestamp: tx.timestamp != null ? Number(tx.timestamp) : null,
          type: tx.type ?? 'Unknown',
          user: null,
          shares: tx.shares ?? null,
          assets: null,
          assetsUsd: null,
        }));
    } else {
      const data = await morphoGraphQLClient.request<V1GraphResponse>(V1_TRANSACTIONS_QUERY, {
        first,
        skip,
        vaultAddress: [vaultAddress.toLowerCase()],
        chainIds,
      });
      const items = data.transactions?.items ?? [];
      transactions = items
        .filter((x): x is NonNullable<typeof x> => x !== null && Boolean(x.hash))
        .map((tx) => ({
          hash: String(tx.hash),
          blockNumber: tx.blockNumber != null ? Number(tx.blockNumber) : null,
          timestamp: tx.timestamp != null ? Number(tx.timestamp) : null,
          type: tx.type ?? 'Unknown',
          user: tx.user?.address ?? null,
          shares: tx.data?.shares ?? null,
          assets: tx.data?.assets ?? null,
          assetsUsd: tx.data?.assetsUsd ?? null,
        }));
    }

    const response: VaultTransactionsResponse = {
      vaultAddress,
      version: isV2 ? 'v2' : 'v1',
      asset: { symbol: null, decimals: null },
      transactions,
    };

    const responseHeaders = new Headers(rateLimitResult.headers);
    responseHeaders.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    return NextResponse.json(response, { headers: responseHeaders });
  } catch (error) {
    const { error: apiError, statusCode } = handleApiError(error, 'Failed to fetch vault transactions');
    return NextResponse.json(apiError, { status: statusCode });
  }
}
