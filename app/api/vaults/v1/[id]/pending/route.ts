import { NextRequest, NextResponse } from 'next/server';
import { getAddress, isAddress } from 'viem';
import { morphoGraphQLClient } from '@/lib/morpho/graphql-client';
import {
  VAULT_V1_PENDING_QUERY,
  describeV1PendingDecoded,
  mapV1PendingDecoded,
} from '@/lib/morpho/vault-v1-api';
import { getVaultByAddress } from '@/lib/config/vaults';
import { handleApiError, AppError } from '@/lib/utils/error-handler';
import { createRateLimitMiddleware, RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS } from '@/lib/utils/rate-limit';
import { BASE_CHAIN_ID } from '@/lib/constants';

const PENDING_LIMIT = 100;

type GraphPendingItem = {
  functionName?: string | null;
  txHash?: string | null;
  validAt?: string | number | null;
  decodedData?: ({ __typename?: string | null } & Record<string, unknown>) | null;
};

type GraphResponse = {
  vault?: {
    address?: string | null;
    state?: {
      pendingConfigs?: { items?: Array<GraphPendingItem | null> | null } | null;
    } | null;
  } | null;
};

export type VaultV1PendingItem = {
  id: string;
  functionName: string;
  txHash: string;
  validAt: number;
  status: 'waiting' | 'ready';
  summary: string;
  decoded: ReturnType<typeof mapV1PendingDecoded>;
};

export type VaultV1PendingResponse = {
  vaultAddress: string;
  pending: VaultV1PendingItem[];
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
    if (cfg?.morphoVersion === 'v2') {
      throw new AppError('Vault is not a V1 vault', 400, 'INVALID_VAULT_VERSION');
    }

    const chainId = cfg?.chainId ?? BASE_CHAIN_ID;

    const data = await morphoGraphQLClient.request<GraphResponse>(VAULT_V1_PENDING_QUERY, {
      address,
      chainId,
      first: PENDING_LIMIT,
    });

    if (!data.vault?.state) {
      throw new AppError('Vault not found in Morpho API', 404, 'VAULT_NOT_FOUND');
    }

    const now = Math.floor(Date.now() / 1000);

    const pending: VaultV1PendingItem[] =
      data.vault.state.pendingConfigs?.items
        ?.filter((item): item is GraphPendingItem => Boolean(item?.functionName))
        .map((item) => {
          const validAt =
            item.validAt == null
              ? 0
              : typeof item.validAt === 'string'
                ? Number(item.validAt)
                : item.validAt;
          const decoded = mapV1PendingDecoded(item.decodedData);
          const txHash = item.txHash ?? '';
          const functionName = item.functionName!;

          return {
            id: `${functionName}-${validAt}-${txHash}`,
            functionName,
            txHash,
            validAt,
            status: validAt <= now ? 'ready' : 'waiting',
            summary: describeV1PendingDecoded(decoded),
            decoded,
          };
        }) ?? [];

    const response: VaultV1PendingResponse = {
      vaultAddress: address,
      pending,
    };

    const headers = new Headers(rateLimitResult.headers);
    headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');

    return NextResponse.json(response, { headers });
  } catch (error) {
    const { error: apiError, statusCode } = handleApiError(error, 'Failed to fetch v1 pending changes');
    return NextResponse.json(apiError, { status: statusCode });
  }
}
