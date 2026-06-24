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
import { loadV2SentinelHistory } from '@/lib/morpho/v2-sentinel-history';

export type { SentinelActivityEvent, SentinelActivityGroup, SentinelHistoryResponse } from '@/lib/morpho/v2-sentinel-history';

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
    const { id } = await params;
    const firstParam = request.nextUrl.searchParams.get('first');
    const parsedFirst = firstParam ? Number(firstParam) : NaN;
    const first = Number.isFinite(parsedFirst)
      ? Math.min(Math.max(Math.floor(parsedFirst), 1), 200)
      : 100;

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
    if (!cfg || cfg.morphoVersion !== 'v2') {
      throw new AppError('V2 vault not found in configuration', 404, 'VAULT_NOT_FOUND');
    }

    const chainId = cfg.chainId ?? BASE_CHAIN_ID;
    const result = await loadV2SentinelHistory(address, chainId, first);

    return NextResponse.json(result, {
      headers: mergeApiCacheHeaders(rateLimitResult.headers, 60),
    });
  } catch (error) {
    const { error: apiError, statusCode } = handleApiError(error, 'Failed to fetch sentinel history');
    return NextResponse.json(apiError, { status: statusCode });
  }
}
