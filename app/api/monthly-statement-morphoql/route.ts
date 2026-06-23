import { NextResponse } from 'next/server';
import { computeTreasuryStatement } from '@/lib/morpho/compute-treasury-statement';
import { handleApiError } from '@/lib/utils/error-handler';
import {
  createRateLimitMiddleware,
  RATE_LIMIT_REQUESTS_PER_MINUTE,
  MINUTE_MS,
} from '@/lib/utils/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
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
    const { statements, daily, vaults } = await computeTreasuryStatement();
    const responseHeaders = new Headers(rateLimitResult.headers);
    responseHeaders.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

    const url = new URL(request.url);
    const wantPerVault = url.searchParams.get('perVault') === 'true';

    if (wantPerVault) {
      return NextResponse.json({ vaults, daily }, { headers: responseHeaders });
    }

    return NextResponse.json({ statements, daily }, { headers: responseHeaders });
  } catch (err) {
    const { error, statusCode } = handleApiError(err, 'Failed to fetch monthly statement');
    return NextResponse.json(error, { status: statusCode });
  }
}
