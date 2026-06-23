import { NextResponse } from 'next/server';
import { createRateLimitMiddleware, RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS } from '@/lib/utils/rate-limit';
import { handleApiError } from '@/lib/utils/error-handler';
import { logger } from '@/lib/utils/logger';
import { mergeApiCacheHeaders } from '@/lib/api/response-cache';

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

    const csvText = await response.text();
    
    // Parse CSV to JSON
    const lines = csvText.split('\n').filter(line => line.trim());
    if (lines.length === 0) {
      return [];
    }

    // Parse header row
    const headers = parseCSVLine(lines[0]);
    
    // Parse data rows
    const rows: Array<Record<string, string>> = [];
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      const row: Record<string, string> = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      rows.push(row);
    }

    return rows;
  } catch (err) {
    logger.error('Error fetching Google Sheet', err instanceof Error ? err : new Error(String(err)), { sheetId });
    throw err;
  }
}

/**
 * Parse a CSV line handling quoted fields
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote
        current += '"';
        i++; // Skip next quote
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // Field separator
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  // Add last field
  result.push(current.trim());
  
  return result;
}

export async function GET(request: Request) {
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
