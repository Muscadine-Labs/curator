import { NextRequest, NextResponse } from 'next/server';
import { getAddress, isAddress } from 'viem';
import { getVaultByAddress } from '@/lib/config/vaults';
import { handleApiError, AppError } from '@/lib/utils/error-handler';
import {
  createRateLimitMiddleware,
  RATE_LIMIT_REQUESTS_PER_MINUTE,
  MINUTE_MS,
} from '@/lib/utils/rate-limit';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { mergeApiCacheHeaders } from '@/lib/api/response-cache';
import { unauthorizedUnlessAdmin } from '@/lib/auth/require-admin';
import { fetchVaultActivity } from '@/lib/morpho/vault-activity.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Allocations (Morpho) + governance (role Safe history + pending submits) for one Vault V2. */
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
    const { id } = await params;
    if (!id || !isAddress(id)) {
      throw new AppError('Invalid vault address', 400, 'INVALID_ADDRESS');
    }
    const vaultAddress = getAddress(id);
    const config = getVaultByAddress(vaultAddress);
    if (!config || config.morphoVersion !== 'v2') {
      throw new AppError('Vault not found', 404, 'VAULT_NOT_FOUND');
    }

    const activity = await fetchVaultActivity(vaultAddress, config.chainId ?? BASE_CHAIN_ID);
    return NextResponse.json(activity, {
      headers: mergeApiCacheHeaders(rateLimitResult.headers),
    });
  } catch (error) {
    const { error: apiError, statusCode } = handleApiError(error, 'Failed to fetch vault activity');
    return NextResponse.json(apiError, { status: statusCode });
  }
}
