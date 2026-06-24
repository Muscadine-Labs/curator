import { NextRequest, NextResponse } from 'next/server';
import { gql } from 'graphql-request';
import { getAddress, isAddress } from 'viem';
import { morphoGraphQLClient } from '@/lib/morpho/graphql-client';
import { getVaultByAddress } from '@/lib/config/vaults';
import { handleApiError, AppError } from '@/lib/utils/error-handler';
import { createRateLimitMiddleware, RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS } from '@/lib/utils/rate-limit';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { mergeApiCacheHeaders } from '@/lib/api/response-cache';

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

type V2TxData =
  | {
      __typename: 'VaultV2DepositData';
      assets?: string | number | null;
      onBehalf?: string | null;
      sender?: string | null;
    }
  | {
      __typename: 'VaultV2WithdrawData';
      assets?: string | number | null;
      onBehalf?: string | null;
      receiver?: string | null;
      sender?: string | null;
    }
  | {
      __typename: 'VaultV2TransferData';
      from?: string | null;
      to?: string | null;
    }
  | null;

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
      data?: V2TxData;
    } | null> | null;
  } | null;
};

function parseBigIntSafe(value: string | number | null | undefined): bigint | null {
  if (value == null) return null;
  try {
    return BigInt(typeof value === 'number' ? Math.floor(value) : value);
  } catch {
    return null;
  }
}

function sharesToAssets(
  shares: string | null | undefined,
  totalAssets: bigint | null,
  totalSupply: bigint | null
): string | null {
  if (!shares || totalAssets == null || totalSupply == null || totalSupply === BigInt(0)) {
    return null;
  }
  try {
    const shareAmount = BigInt(shares);
    if (shareAmount <= BigInt(0)) return null;
    return String((shareAmount * totalAssets) / totalSupply);
  } catch {
    return null;
  }
}

function assetsToUsd(
  assets: string | null,
  totalAssets: bigint | null,
  totalAssetsUsd: number | null
): number | null {
  if (!assets || totalAssets == null || totalAssets === BigInt(0) || totalAssetsUsd == null) {
    return null;
  }
  try {
    const assetAmount = BigInt(assets);
    if (assetAmount <= BigInt(0)) return null;
    return (Number(assetAmount) / Number(totalAssets)) * totalAssetsUsd;
  } catch {
    return null;
  }
}

function mapV2TransactionData(
  data: V2TxData,
  shares: string | null | undefined,
  totalAssets: bigint | null,
  totalSupply: bigint | null
): { user: string | null; assets: string | null } {
  if (!data?.__typename) return { user: null, assets: null };
  switch (data.__typename) {
    case 'VaultV2DepositData':
      return {
        user: data.onBehalf ?? data.sender ?? null,
        assets: data.assets != null ? String(data.assets) : null,
      };
    case 'VaultV2WithdrawData':
      return {
        user: data.onBehalf ?? data.receiver ?? data.sender ?? null,
        assets: data.assets != null ? String(data.assets) : null,
      };
    case 'VaultV2TransferData': {
      const converted = sharesToAssets(shares, totalAssets, totalSupply);
      return {
        user: data.to ?? data.from ?? null,
        assets: converted,
      };
    }
    default:
      return { user: null, assets: null };
  }
}

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

    if (vaultConfig.morphoVersion !== 'v2') {
      throw new AppError('Vault not found', 404, 'VAULT_NOT_FOUND');
    }

    const url = new URL(request.url);
    const first = parseFirst(url.searchParams.get('first'), 100, 200);
    const skip = parseFirst(url.searchParams.get('skip'), 0, 10_000);

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
        const { user, assets } = mapV2TransactionData(
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
          assetsUsd: assetsToUsd(assets, totalAssets, totalAssetsUsd),
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
