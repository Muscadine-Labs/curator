import { NextRequest, NextResponse } from 'next/server';
import { getMorphoMarketRatings } from '@/lib/morpho/service';
import type { CuratorConfigOverrides } from '@/lib/morpho/config';
import { GRAPHQL_FIRST_LIMIT } from '@/lib/constants';
import { handleApiError, AppError } from '@/lib/utils/error-handler';
import { createRateLimitMiddleware, RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS } from '@/lib/utils/rate-limit';
import { mergeApiCacheHeaders } from '@/lib/api/response-cache';

// Ensure Node.js runtime for API routes (required for external API calls)
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 300;

export async function GET(request: NextRequest) {
  // Rate limiting
  const rateLimitMiddleware = createRateLimitMiddleware(
    RATE_LIMIT_REQUESTS_PER_MINUTE,
    MINUTE_MS
  );
  const rateLimitResult = rateLimitMiddleware(request);
  
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      { 
        status: 429,
        headers: rateLimitResult.headers,
      }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get('limit');
    const marketId = searchParams.get('marketId') ?? searchParams.get('id') ?? undefined;

    let limit: number | undefined;
    if (limitParam !== null) {
      const parsed = Number(limitParam);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new AppError('Invalid limit parameter', 400, 'INVALID_LIMIT');
      }
      limit = Math.min(parsed, GRAPHQL_FIRST_LIMIT);
    }

    const overrides = parseConfigOverrides(searchParams);

    const markets = await getMorphoMarketRatings({
      limit,
      marketId,
      configOverride: overrides,
    });

    if (marketId && markets.length === 0) {
      throw new AppError('Market not found', 404, 'MARKET_NOT_FOUND');
    }

    const responseHeaders = mergeApiCacheHeaders(rateLimitResult.headers, 300);

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      markets,
    }, { headers: responseHeaders });
  } catch (error) {
    const { error: apiError, statusCode } = handleApiError(error, 'Failed to fetch market ratings');
    return NextResponse.json(apiError, { status: statusCode });
  }
}

function parseConfigOverrides(
  params: URLSearchParams
): CuratorConfigOverrides | undefined {
  const overrides: CuratorConfigOverrides = {};
  const weights: NonNullable<CuratorConfigOverrides['weights']> = {};

  const numericKeys: Array<keyof CuratorConfigOverrides> = [
    'utilizationCeiling',
    'utilizationBufferHours',
    'rateAlignmentEps',
    'fallbackBenchmarkRate',
    'priceStressPct',
    'liquidityStressPct',
    'withdrawalLiquidityMinPct',
    'insolvencyTolerancePctTvl',
  ];

  numericKeys.forEach((key) => {
    const value = params.get(String(key));
    if (value !== null) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        overrides[key] = parsed as never;
      }
    }
  });

  ['utilization', 'rateAlignment', 'stressExposure', 'withdrawalLiquidity', 'liquidationCapacity'].forEach(
    (key) => {
      const value = params.get(`weight.${key}`);
      if (value !== null) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          weights[key as keyof typeof weights] = parsed;
        }
      }
    }
  );

  if (Object.keys(weights).length) {
    overrides.weights = weights;
  }

  return Object.keys(overrides).length ? overrides : undefined;
}

