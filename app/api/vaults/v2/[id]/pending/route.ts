import { NextRequest, NextResponse } from 'next/server';
import { getAddress, isAddress } from 'viem';
import { morphoGraphQLClient } from '@/lib/morpho/graphql-client';
import {
  VAULT_V2_PENDING_QUERY,
  describePendingDecoded,
  mapPendingDecoded,
} from '@/lib/morpho/vault-v2-api';
import { getVaultByAddress } from '@/lib/config/vaults';
import { handleApiError, AppError } from '@/lib/utils/error-handler';
import { createRateLimitMiddleware, RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS } from '@/lib/utils/rate-limit';
import { BASE_CHAIN_ID, VAULT_V2_GRAPHQL_PENDING_LIMIT } from '@/lib/constants';

const PENDING_LIMIT = VAULT_V2_GRAPHQL_PENDING_LIMIT;

type GraphPendingItem = {
  data?: string | null;
  functionName?: string | null;
  txHash?: string | null;
  validAt?: string | number | null;
  decodedData?: ({ __typename?: string | null } & Record<string, unknown>) | null;
};

type GraphResponse = {
  vault?: {
    address?: string | null;
    pendingConfigs?: { items?: Array<GraphPendingItem | null> | null } | null;
  } | null;
};

export type VaultV2PendingItem = {
  /** Stable list index for per-row UI state (multiple items may share `data` / `txHash`). */
  rowId: number;
  data: string;
  functionName: string;
  txHash: string;
  validAt: number;
  status: 'waiting' | 'ready';
  summary: string;
  decoded: ReturnType<typeof mapPendingDecoded>;
};

export type VaultV2PendingResponse = {
  vaultAddress: string;
  pending: VaultV2PendingItem[];
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitMiddleware = createRateLimitMiddleware(
    RATE_LIMIT_REQUESTS_PER_MINUTE,
    MINUTE_MS
  );
  const rateLimitResult = rateLimitMiddleware(request);

  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      { status: 429, headers: rateLimitResult.headers }
    );
  }

  try {
    const { id } = await params;

    let address: string;
    if (isAddress(id)) {
      address = getAddress(id);
    } else {
      const cfg = getVaultByAddress(id);
      if (!cfg) {
        throw new AppError('Vault not found', 404, 'VAULT_NOT_FOUND');
      }
      address = getAddress(cfg.address);
    }

    const cfg = getVaultByAddress(address);
    const chainId = cfg?.chainId ?? BASE_CHAIN_ID;

    const data = await morphoGraphQLClient.request<GraphResponse>(VAULT_V2_PENDING_QUERY, {
      address,
      chainId,
      first: PENDING_LIMIT,
    });

    if (!data.vault) {
      throw new AppError('Vault not found in Morpho API', 404, 'VAULT_NOT_FOUND');
    }

    const now = Math.floor(Date.now() / 1000);

    const pending: VaultV2PendingItem[] =
      data.vault.pendingConfigs?.items
        ?.filter((item): item is GraphPendingItem => Boolean(item?.data && item?.functionName))
        .map((item, index) => {
          const validAt =
            item.validAt == null
              ? 0
              : typeof item.validAt === 'string'
                ? Number(item.validAt)
                : item.validAt;
          const decoded = mapPendingDecoded(item.decodedData);

          return {
            rowId: index,
            data: item.data!,
            functionName: item.functionName!,
            txHash: item.txHash ?? '',
            validAt,
            status: validAt <= now ? 'ready' : 'waiting',
            summary: describePendingDecoded(decoded),
            decoded,
          };
        }) ?? [];

    const response: VaultV2PendingResponse = {
      vaultAddress: address,
      pending,
    };

    const headers = new Headers(rateLimitResult.headers);
    headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');

    return NextResponse.json(response, { headers });
  } catch (error) {
    const { error: apiError, statusCode } = handleApiError(error, 'Failed to fetch v2 pending changes');
    return NextResponse.json(apiError, { status: statusCode });
  }
}
