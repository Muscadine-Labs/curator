import { NextResponse } from 'next/server';
import { createRateLimitMiddleware, RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS } from '@/lib/utils/rate-limit';
import { handleApiError } from '@/lib/utils/error-handler';
import { logger } from '@/lib/utils/logger';
import { mergeApiCacheHeaders } from '@/lib/api/response-cache';
import { unauthorizedUnlessAdmin } from '@/lib/auth/require-admin';
import { parseCsvRecords } from '@/lib/utils/csv';

// Ensure Node.js runtime for API routes
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Fetch data from a public Google Sheet using CSV export
 * For private sheets, this would need OAuth authentication
 */
async function fetchPublicGoogleSheet(sheetId: string, sheetName?: string): Promise<Array<Record<string, string>>> {
  // Construct the CSV export URL
  // Format: https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv&sheet={SHEET_NAME}
  const sheetParam = sheetName ? `&sheet=${encodeURIComponent(sheetName)}` : '';
  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv${sheetParam}`;

  try {
    const response = await fetch(csvUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Google Sheet: ${response.status} ${response.statusText}`);
    }

    return parseCsvRecords(await response.text());
  } catch (err) {
    logger.error('Error fetching Google Sheet', err instanceof Error ? err : new Error(String(err)), { sheetId });
    throw err;
  }
}

export async function GET(request: Request) {
  const denied = await unauthorizedUnlessAdmin(request);
  if (denied) return denied;
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
    const url = new URL(request.url);
    const sheetId = url.searchParams.get('sheetId');
    const sheetName = url.searchParams.get('sheetName') || undefined;

    if (!sheetId) {
      return NextResponse.json(
        { error: 'Sheet ID is required' },
        { status: 400 }
      );
    }

    // Validate sheet ID format (basic check)
    if (!/^[a-zA-Z0-9-_]+$/.test(sheetId)) {
      return NextResponse.json(
        { error: 'Invalid sheet ID format' },
        { status: 400 }
      );
    }

    const rows = await fetchPublicGoogleSheet(sheetId, sheetName);

    const responseHeaders = mergeApiCacheHeaders(rateLimitResult.headers, 60);

    return NextResponse.json(
      { rows },
      { headers: responseHeaders }
    );
  } catch (error) {
    const { error: apiError, statusCode } = handleApiError(error, 'Failed to fetch Google Sheets data');
    return NextResponse.json(apiError, { status: statusCode });
  }
}
