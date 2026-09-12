import { NextRequest, NextResponse } from 'next/server';
import { getAddress, isAddress } from 'viem';
import { readSafeOnChainSettings } from '@/lib/safe/onchain-reads';
import { mergeApiCacheHeaders } from '@/lib/api/response-cache';
import { handleApiError } from '@/lib/utils/error-handler';
import { unauthorizedUnlessAdmin } from '@/lib/auth/require-admin';
import { getSafeByAddress } from '@/lib/safe/config';

type RouteParams = { params: Promise<{ address: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const denied = await unauthorizedUnlessAdmin(request);
  if (denied) return denied;
  try {
    const { address: raw } = await params;
    if (!isAddress(raw)) {
      return NextResponse.json({ error: 'Invalid Safe address' }, { status: 400 });
    }
    const address = getAddress(raw);
    if (!getSafeByAddress(address)) {
      return NextResponse.json({ error: 'Unknown Safe' }, { status: 404 });
    }
    const settings = await readSafeOnChainSettings(address);
    return NextResponse.json(settings, {
      headers: mergeApiCacheHeaders(undefined, 30),
    });
  } catch (error) {
    const { error: apiError, statusCode } = handleApiError(error, 'Failed to read Safe settings');
    return NextResponse.json({ error: apiError.message }, { status: statusCode });
  }
}
