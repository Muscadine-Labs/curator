import { NextRequest, NextResponse } from 'next/server';
import {
  defaultCuratorMarketChainId,
  fetchCuratorMarkets,
} from '@/lib/morpho/curator-markets';
import { CURATOR_MARKET_NETWORKS } from '@/lib/constants';
import { handleApiError, AppError } from '@/lib/utils/error-handler';
import {
  createRateLimitMiddleware,
  RATE_LIMIT_REQUESTS_PER_MINUTE,
  MINUTE_MS,
} from '@/lib/utils/rate-limit';
import { mergeApiCacheHeaders } from '@/lib/api/response-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseChainId(raw: string | null): number {
  const chainId = raw != null ? Number(raw) : defaultCuratorMarketChainId();
  const allowed = CURATOR_MARKET_NETWORKS.some((n) => n.chainId === chainId);
  if (!Number.isFinite(chainId) || !allowed) {
    throw new AppError('Invalid chainId', 400, 'INVALID_CHAIN_ID');
  }
  return chainId;
}

export async function GET(request: NextRequest) {
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
    const { searchParams } = new URL(request.url);
    const chainId = parseChainId(searchParams.get('chainId'));
    const markets = await fetchCuratorMarkets(chainId);

    return NextResponse.json(
      { chainId, markets, timestamp: new Date().toISOString() },
      { headers: mergeApiCacheHeaders(rateLimitResult.headers, 30) }
    );
  } catch (error) {
    const { error: apiError, statusCode } = handleApiError(error, 'Failed to fetch markets');
    return NextResponse.json(apiError, { status: statusCode });
  }
}
