import { NextRequest, NextResponse } from 'next/server';
import {
  defaultCuratorMarketChainId,
  fetchCuratorMarketDetail,
} from '@/lib/morpho/curator-markets';
import { CURATOR_MARKET_NETWORKS } from '@/lib/constants';
import { handleApiError, AppError } from '@/lib/utils/error-handler';
import {
  createRateLimitMiddleware,
  RATE_LIMIT_REQUESTS_PER_MINUTE,
  MINUTE_MS,
} from '@/lib/utils/rate-limit';
import { API_CACHE_MAX_AGE_MS, mergeApiOnChainVaultHeaders } from '@/lib/api/response-cache';
import { withServerResponseCache } from '@/lib/api/server-response-cache';
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

    // Shared 30s dedupe: every open tab polls every 30s, and each uncached
    // read is a GraphQL query plus oracle multicalls and the IRM read on RPC.
    // A failed oracle decode is not cached, so it is retried on the next poll.
    const market = await withServerResponseCache(
      `curator-market-detail-v1-${chainId}-${marketId.toLowerCase()}`,
      API_CACHE_MAX_AGE_MS,
      () => fetchCuratorMarketDetail(marketId, chainId),
      (detail) => detail != null && detail.oraclePrice?.kind !== 'error'
    );
    if (!market) {
      throw new AppError('Market not found', 404, 'MARKET_NOT_FOUND');
    }

    return NextResponse.json(
      { market, timestamp: new Date().toISOString() },
      { headers: mergeApiOnChainVaultHeaders(rateLimitResult.headers) }
    );
  } catch (error) {
    const { error: apiError, statusCode } = handleApiError(error, 'Failed to fetch market');
    return NextResponse.json(apiError, { status: statusCode });
  }
}
