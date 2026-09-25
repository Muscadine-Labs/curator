import { NextResponse } from 'next/server';
import { computeTreasuryStatement } from '@/lib/morpho/compute-treasury-statement';
import { handleApiError } from '@/lib/utils/error-handler';
import {
  createRateLimitMiddleware,
  RATE_LIMIT_REQUESTS_PER_MINUTE,
  MINUTE_MS,
} from '@/lib/utils/rate-limit';
import { mergeApiCacheHeaders } from '@/lib/api/response-cache';
import { unauthorizedUnlessAdmin } from '@/lib/auth/require-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
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
      {
        status: 429,
        headers: rateLimitResult.headers,
      }
    );
  }

  try {
    const { statements, daily, vaults, warning } = await computeTreasuryStatement();
    const responseHeaders = mergeApiCacheHeaders(rateLimitResult.headers);
    return NextResponse.json({ statements, daily, vaults, warning }, { headers: responseHeaders });
  } catch (err) {
    const { error, statusCode } = handleApiError(err, 'Failed to fetch monthly statement');
    return NextResponse.json(error, { status: statusCode });
  }
}
