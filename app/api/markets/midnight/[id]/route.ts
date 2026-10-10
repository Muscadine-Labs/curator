import { NextRequest, NextResponse } from 'next/server';
import { fetchMidnightMarketDetail } from '@/lib/morpho/midnight-markets';
import { CURATOR_MARKET_NETWORKS } from '@/lib/constants';
import { handleApiError, AppError } from '@/lib/utils/error-handler';
import {
  createRateLimitMiddleware,
  RATE_LIMIT_REQUESTS_PER_MINUTE,
  MINUTE_MS,
} from '@/lib/utils/rate-limit';
import { mergeApiCacheHeaders, API_CACHE_MAX_AGE_MS } from '@/lib/api/response-cache';
import { withServerResponseCache } from '@/lib/api/server-response-cache';
import { unauthorizedUnlessAdmin } from '@/lib/auth/require-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseChainId(raw: string | null): number {
  const chainId = raw != null ? Number(raw) : 8453;
  const allowed = CURATOR_MARKET_NETWORKS.some((n) => n.chainId === chainId);
  if (!Number.isFinite(chainId) || !allowed) {
    throw new AppError('Invalid chainId', 400, 'INVALID_CHAIN_ID');
  }
  return chainId;
}

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
    const { id: rawId } = await params;
    const marketId = decodeURIComponent(rawId);
    const { searchParams } = new URL(request.url);
    const chainId = parseChainId(searchParams.get('chainId'));

    const market = await withServerResponseCache(
      `midnight-market-v3-${chainId}-${marketId.toLowerCase()}`,
      API_CACHE_MAX_AGE_MS,
      () => fetchMidnightMarketDetail(marketId, chainId)
    );

    return NextResponse.json(
      { market, timestamp: new Date().toISOString() },
      { headers: mergeApiCacheHeaders(rateLimitResult.headers, 30) }
    );
  } catch (error) {
    const { error: apiError, statusCode } = handleApiError(
      error,
      'Failed to fetch Midnight market'
    );
    return NextResponse.json(apiError, { status: statusCode });
  }
}
