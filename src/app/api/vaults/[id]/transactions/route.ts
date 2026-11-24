import { NextRequest, NextResponse } from 'next/server';
import { gql } from 'graphql-request';
import { parseBoundedIntParam } from '@/lib/api/query-params';
import {
  assetsToUsdAtCurrentPrice,
  mapV2TxAssets,
  parseBigIntSafe,
} from '@/lib/morpho/vault-v2-tx-amounts';
import { getAddress, isAddress } from 'viem';
import { morphoGraphQLClient } from '@/lib/morpho/graphql-client';
import { getVaultByAddress } from '@/lib/config/vaults';
import { handleApiError, AppError } from '@/lib/utils/error-handler';
import { createRateLimitMiddleware, RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS } from '@/lib/utils/rate-limit';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { mergeApiCacheHeaders } from '@/lib/api/response-cache';
import { unauthorizedUnlessAdmin } from '@/lib/auth/require-admin';

export type VaultTransaction = {
  hash: string;
  blockNumber: number | null;
  timestamp: number | null;
  type: string;
  user: string | null;
  shares: string | null;
  assets: string | null;
  /** Transfer: assets estimated from shares at today's share price. */
  assetsEstimated: boolean;
  /** Assets valued at today's asset price (Morpho has no per-tx USD). */
  assetsUsd: number | null;
};

export type VaultTransactionsResponse = {
  vaultAddress: string;
  version: 'v2';
  asset: {
    symbol: string | null;
    decimals: number | null;
  };
  transactions: VaultTransaction[];
};

const V2_TRANSACTIONS_QUERY = gql`
  query V2VaultTransactions(
    $address: String!
    $chainId: Int!
    $first: Int!
    $skip: Int!
    $vaultAddress: [String!]!
    $chainIds: [Int!]
  ) {
    vaultV2ByAddress(address: $address, chainId: $chainId) {
      asset {
        symbol
        decimals
      }
      totalAssets
      totalAssetsUsd
      totalSupply
    }
    vaultV2transactions(
      first: $first
      skip: $skip
      orderBy: Time
      orderDirection: Desc
      where: { vaultAddress_in: $vaultAddress, chainId_in: $chainIds }
    ) {
      items {
        txHash
        blockNumber
        timestamp
        type
        shares
        data {
          __typename
          ... on VaultV2DepositData {
            assets
            onBehalf
            sender
          }
          ... on VaultV2WithdrawData {
            assets
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

import {
  vaultV2TransactionUser,
  type VaultV2TxData,
} from '@/lib/morpho/vault-v2-transaction-utils';

type V2GraphResponse = {
  vaultV2ByAddress?: {
    asset?: { symbol?: string | null; decimals?: number | null } | null;
    totalAssets?: string | number | null;
    totalAssetsUsd?: number | null;
    totalSupply?: string | number | null;
  } | null;
  vaultV2transactions?: {
    items?: Array<{
      txHash?: string | null;
      blockNumber?: number | string | null;
      timestamp?: number | string | null;
      type?: string | null;
      shares?: string | null;
      data?: VaultV2TxData & {
        assets?: string | number | null;
      };
    } | null> | null;
  } | null;
};

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
    const first = parseBoundedIntParam(url.searchParams.get('first'), 100, { min: 1, max: 200 });
    const skip = parseBoundedIntParam(url.searchParams.get('skip'), 0, { min: 0, max: 10_000 });

    const chainIds = [vaultConfig.chainId ?? BASE_CHAIN_ID];

    const data = await morphoGraphQLClient.request<V2GraphResponse>(V2_TRANSACTIONS_QUERY, {
      address: vaultAddress,
      chainId: chainIds[0],
      first,
      skip,
      vaultAddress: [vaultAddress.toLowerCase()],
      chainIds,
    });
    const assetSymbol = data.vaultV2ByAddress?.asset?.symbol ?? null;
    const assetDecimals = data.vaultV2ByAddress?.asset?.decimals ?? null;
    const totalAssets = parseBigIntSafe(data.vaultV2ByAddress?.totalAssets);
    const totalSupply = parseBigIntSafe(data.vaultV2ByAddress?.totalSupply);
    const totalAssetsUsd = data.vaultV2ByAddress?.totalAssetsUsd ?? null;
    const items = data.vaultV2transactions?.items ?? [];
    const transactions = items
      .filter((x): x is NonNullable<typeof x> => x !== null && Boolean(x.txHash))
      .map((tx) => {
        const user = vaultV2TransactionUser(tx.data ?? null);
        const { assets, assetsEstimated } = mapV2TxAssets(
          tx.data ?? null,
          tx.shares,
          totalAssets,
          totalSupply
        );
        return {
          hash: String(tx.txHash),
          blockNumber: tx.blockNumber != null ? Number(tx.blockNumber) : null,
          timestamp: tx.timestamp != null ? Number(tx.timestamp) : null,
          type: tx.type ?? 'Unknown',
          user,
          shares: tx.shares ?? null,
          assets,
          assetsEstimated,
          assetsUsd: assetsToUsdAtCurrentPrice(assets, totalAssets, totalAssetsUsd),
        };
      });

    const response: VaultTransactionsResponse = {
      vaultAddress,
      version: 'v2',
      asset: {
        symbol: assetSymbol,
        decimals: assetDecimals,
      },
      transactions,
    };

    const responseHeaders = mergeApiCacheHeaders(rateLimitResult.headers, 60);
    return NextResponse.json(response, { headers: responseHeaders });
  } catch (error) {
    const { error: apiError, statusCode } = handleApiError(error, 'Failed to fetch vault transactions');
    return NextResponse.json(apiError, { status: statusCode });
  }
}
