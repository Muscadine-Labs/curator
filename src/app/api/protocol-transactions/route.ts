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
import {
  assetsToUsdAtCurrentPrice,
  mapV2TxAssets,
  parseBigIntSafe,
} from '@/lib/morpho/vault-v2-tx-amounts';
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
  /** Transfer: assets estimated from shares at today's share price. */
  assetsEstimated: boolean;
  /** Assets valued at today's asset price (Morpho has no per-tx USD). */
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

        // A failure throws (502 via handleApiError) instead of serving and
        // caching an empty list that reads as "no transactions".
        const data = await morphoGraphQLClient.request<V2TxGraphResponse>(V2_TX_QUERY, {
          first: Math.min(perVault * vaults.length, 200),
          vaultAddress: addresses.map((a) => a.toLowerCase()),
          chainIds,
        });

        const transactions: ProtocolTransaction[] = [];

        for (const tx of data.vaultV2transactions?.items ?? []) {
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
          const mapped = mapV2TxAssets(tx.data, tx.shares, totalAssets, totalSupply);
          const assets =
            mapped.assets ?? (tx.assets != null ? (parseBigIntSafe(tx.assets)?.toString() ?? null) : null);

          transactions.push({
            hash: String(tx.txHash),
            blockNumber: tx.blockNumber != null ? Number(tx.blockNumber) : null,
            timestamp: tx.timestamp != null ? Number(tx.timestamp) : null,
            type: tx.type ?? 'Unknown',
            user: vaultV2TransactionUser(tx.data ?? null),
            assets,
            assetsEstimated: mapped.assetsEstimated,
            assetsUsd: assetsToUsdAtCurrentPrice(assets, totalAssets, totalAssetsUsd),
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
