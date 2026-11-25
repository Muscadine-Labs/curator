import { NextRequest, NextResponse } from 'next/server';
import { getAddress, isAddress } from 'viem';
import { describePendingDecoded, type VaultV2PendingDecoded } from '@/lib/morpho/vault-v2-api';
import { fetchVaultPendingSubmits } from '@/lib/morpho/vault-v2-pending.server';
import { getVaultByAddress } from '@/lib/config/vaults';
import { handleApiError, AppError } from '@/lib/utils/error-handler';
import { createRateLimitMiddleware, RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS } from '@/lib/utils/rate-limit';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { mergeApiCacheHeaders } from '@/lib/api/response-cache';
import { unauthorizedUnlessAdmin } from '@/lib/auth/require-admin';

export type VaultV2PendingItem = {
  /** Stable list index for per-row UI state (multiple items may share `data` / `txHash`). */
  rowId: number;
  data: string;
  functionName: string;
  txHash: string;
  validAt: number;
  status: 'waiting' | 'ready';
  summary: string;
  decoded: VaultV2PendingDecoded;
};

export type VaultV2PendingResponse = {
  vaultAddress: string;
  pending: VaultV2PendingItem[];
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await unauthorizedUnlessAdmin(request);
  if (denied) return denied;
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

    // Only configured vaults, like every other vault route. An unknown address
    // used to be queried anyway, and Morpho's "No results" error became a 500.
    const cfg = isAddress(id) ? getVaultByAddress(id) : undefined;
    if (!cfg) {
      throw new AppError('Vault not found in configuration', 404, 'VAULT_NOT_FOUND');
    }
    const address = getAddress(cfg.address);
    const chainId = cfg.chainId ?? BASE_CHAIN_ID;

    const submits = await fetchVaultPendingSubmits(address, chainId);
    const now = Math.floor(Date.now() / 1000);

    const pending: VaultV2PendingItem[] = submits.map((item, index) => ({
      rowId: index,
      data: item.data,
      functionName: item.functionName,
      txHash: item.txHash,
      validAt: item.validAt,
      status: item.validAt <= now ? 'ready' : 'waiting',
      summary: describePendingDecoded(item.decoded),
      decoded: item.decoded,
    }));

    const response: VaultV2PendingResponse = {
      vaultAddress: address,
      pending,
    };

    const headers = mergeApiCacheHeaders(rateLimitResult.headers, 30);

    return NextResponse.json(response, { headers });
  } catch (error) {
    const { error: apiError, statusCode } = handleApiError(error, 'Failed to fetch v2 pending changes');
    return NextResponse.json(apiError, { status: statusCode });
  }
}
