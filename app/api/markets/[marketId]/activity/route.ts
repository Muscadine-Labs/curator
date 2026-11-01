import { NextRequest, NextResponse } from 'next/server';
import { defaultCuratorMarketChainId } from '@/lib/morpho/curator-markets';
import { fetchMarketActivity } from '@/lib/morpho/market-activity.server';
import { CURATOR_MARKET_NETWORKS } from '@/lib/constants';
import { handleApiError, AppError } from '@/lib/utils/error-handler';
import {
  createRateLimitMiddleware,
  RATE_LIMIT_REQUESTS_PER_MINUTE,
  MINUTE_MS,
} from '@/lib/utils/rate-limit';
import { mergeApiCacheHeaders } from '@/lib/api/response-cache';
import { unauthorizedUnlessAdmin } from '@/lib/auth/require-admin';

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ marketId: string }> }
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
    const { marketId: rawMarketId } = await params;
    const marketId = decodeURIComponent(rawMarketId);
    const { searchParams } = new URL(request.url);
    const chainId = parseChainId(searchParams.get('chainId'));

    if (!/^0x[0-9a-fA-F]{64}$/.test(marketId)) {
      throw new AppError('Invalid market id', 400, 'INVALID_MARKET_ID');
    }

    const activity = await fetchMarketActivity(marketId, chainId);
    if (!activity) {
      throw new AppError('Market not found', 404, 'MARKET_NOT_FOUND');
    }

    return NextResponse.json(
      { activity, timestamp: new Date().toISOString() },
      { headers: mergeApiCacheHeaders(rateLimitResult.headers) }
    );
  } catch (error) {
    const { error: apiError, statusCode } = handleApiError(error, 'Failed to fetch market activity');
    return NextResponse.json(apiError, { status: statusCode });
  }
}
