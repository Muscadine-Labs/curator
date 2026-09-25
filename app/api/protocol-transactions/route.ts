import { NextRequest, NextResponse } from 'next/server';
import { parseBoundedIntParam } from '@/lib/api/query-params';
import { gql } from 'graphql-request';
import { getAddress } from 'viem';
import {
  getActiveVaultAddressesForStats,
  getConfiguredVaultDisplayName,
  withFeeWrapperLabel,
} from '@/lib/config/vaults';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { morphoGraphQLClient } from '@/lib/morpho/graphql-client';
import {
  vaultV2TransactionUser,
  type VaultV2TxData,
} from '@/lib/morpho/vault-v2-transaction-utils';
import { handleApiError } from '@/lib/utils/error-handler';
import {
  createRateLimitMiddleware,
  RATE_LIMIT_REQUESTS_PER_MINUTE,
  MINUTE_MS,
} from '@/lib/utils/rate-limit';
import { mergeApiCacheHeaders, API_CACHE_MAX_AGE_MS } from '@/lib/api/response-cache';
import { withServerResponseCache } from '@/lib/api/server-response-cache';
import { bigintShareOf } from '@/lib/format/bigint-ratio';
import { unauthorizedUnlessAdmin } from '@/lib/auth/require-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export type ProtocolTransaction = {
  hash: string;
  blockNumber: number | null;
  timestamp: number | null;
  type: string;
  user: string | null;
  assets: string | null;
  assetsUsd: number | null;
  vaultAddress: string;
  vaultName: string;
  assetSymbol: string;
  assetDecimals: number | null;
  chainId: number;
};

export type ProtocolTransactionsResponse = {
  transactions: ProtocolTransaction[];
};

const V2_TX_QUERY = gql`
  query ProtocolVaultTransactions($first: Int!, $vaultAddress: [String!]!, $chainIds: [Int!]) {
    vaultV2transactions(
      first: $first
      skip: 0
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
        assets
        vault {
          address
          name
          asset {
            symbol
            decimals
          }
          totalAssets
          totalAssetsUsd
          totalSupply
        }
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

type V2TxGraphResponse = {
  vaultV2transactions?: {
    items?: Array<{
      txHash?: string | null;
      blockNumber?: number | string | null;
      timestamp?: number | string | null;
      type?: string | null;
      shares?: string | null;
      assets?: string | number | null;
      vault?: {
        address?: string | null;
        name?: string | null;
        asset?: { symbol?: string | null; decimals?: number | null } | null;
        totalAssets?: string | number | null;
        totalAssetsUsd?: number | null;
        totalSupply?: string | number | null;
      } | null;
      data?: VaultV2TxData & { assets?: string | number | null };
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
  if (!shares || totalAssets == null || totalSupply == null || totalSupply === 0n) {
    return null;
  }
  try {
    const shareAmount = BigInt(shares);
    if (shareAmount <= 0n) return null;
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
  if (!assets || totalAssets == null || totalAssets === 0n || totalAssetsUsd == null) {
    return null;
  }
  try {
    const assetAmount = BigInt(assets);
    if (assetAmount <= 0n) return null;
    return bigintShareOf(assetAmount, totalAssets, totalAssetsUsd);
  } catch {
    return null;
  }
}

function mapAssets(
  data: (VaultV2TxData & { assets?: string | number | null }) | null | undefined,
  shares: string | null | undefined,
  totalAssets: bigint | null,
  totalSupply: bigint | null
): string | null {
  if (!data?.__typename) return null;
  if (data.__typename === 'VaultV2DepositData' || data.__typename === 'VaultV2WithdrawData') {
    return data.assets != null ? String(data.assets) : null;
  }
  if (data.__typename === 'VaultV2TransferData') {
    return sharesToAssets(shares, totalAssets, totalSupply);
  }
  return null;
}

export async function GET(request: NextRequest) {
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
    const url = new URL(request.url);
    const perVault = parseBoundedIntParam(url.searchParams.get('perVault'), 40, { min: 1, max: 100 });

    const payload = await withServerResponseCache(
      `protocol-txs-v2-${perVault}`,
      API_CACHE_MAX_AGE_MS,
      async (): Promise<ProtocolTransactionsResponse> => {
        const vaults = getActiveVaultAddressesForStats();
        const addresses = vaults.map((v) => getAddress(v.address));
        const chainIds = Array.from(
          new Set(vaults.map((v) => v.chainId ?? BASE_CHAIN_ID))
        );
        const vaultByAddr = new Map(
          vaults.map((v) => [v.address.toLowerCase(), v] as const)
        );

        let data: V2TxGraphResponse | null = null;
        try {
          data = await morphoGraphQLClient.request<V2TxGraphResponse>(V2_TX_QUERY, {
            first: Math.min(perVault * vaults.length, 200),
            vaultAddress: addresses.map((a) => a.toLowerCase()),
            chainIds,
          });
        } catch {
          data = null;
        }

        const transactions: ProtocolTransaction[] = [];

        for (const tx of data?.vaultV2transactions?.items ?? []) {
          if (!tx?.txHash || !tx.vault?.address) continue;
          const vaultAddr = tx.vault.address.toLowerCase();
          const cfg = vaultByAddr.get(vaultAddr);
          const vaultName = withFeeWrapperLabel(
            tx.vault.name?.trim() ||
              (cfg ? getConfiguredVaultDisplayName(cfg) : tx.vault.address),
            tx.vault.address
          );
          const assetSymbol = tx.vault.asset?.symbol ?? cfg?.assetSymbol ?? 'TOKEN';
          const assetDecimals = tx.vault.asset?.decimals ?? null;
          const totalAssets = parseBigIntSafe(tx.vault.totalAssets);
          const totalSupply = parseBigIntSafe(tx.vault.totalSupply);
          const totalAssetsUsd = tx.vault.totalAssetsUsd ?? null;
          const assets =
            mapAssets(tx.data, tx.shares, totalAssets, totalSupply) ??
            (tx.assets != null ? String(tx.assets) : null);

          transactions.push({
            hash: String(tx.txHash),
            blockNumber: tx.blockNumber != null ? Number(tx.blockNumber) : null,
            timestamp: tx.timestamp != null ? Number(tx.timestamp) : null,
            type: tx.type ?? 'Unknown',
            user: vaultV2TransactionUser(tx.data ?? null),
            assets,
            assetsUsd: assetsToUsd(assets, totalAssets, totalAssetsUsd),
            vaultAddress: getAddress(tx.vault.address),
            vaultName,
            assetSymbol,
            assetDecimals,
            chainId: cfg?.chainId ?? BASE_CHAIN_ID,
          });
        }

        transactions.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

        return { transactions: transactions.slice(0, 200) };
      }
    );

    const headers = mergeApiCacheHeaders(rateLimitResult.headers, 60);
    return NextResponse.json(payload, { headers });
  } catch (error) {
    const { error: apiError, statusCode } = handleApiError(
      error,
      'Failed to fetch protocol transactions'
    );
    return NextResponse.json(apiError, { status: statusCode });
  }
}
