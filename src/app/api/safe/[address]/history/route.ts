import { NextRequest, NextResponse } from 'next/server';
import { getAddress, isAddress } from 'viem';
import {
  fetchExecutedMultisigTransactions,
  isTransactionServiceConfigured,
} from '@/lib/safe/transaction-service';
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
    if (!isTransactionServiceConfigured()) {
      return NextResponse.json(
        { error: 'Set NEXT_PUBLIC_SAFE_API_KEY to load executed history.' },
        { status: 400 }
      );
    }
    const address = getAddress(raw);
    if (!getSafeByAddress(address)) {
      return NextResponse.json({ error: 'Unknown Safe' }, { status: 404 });
    }
    const transactions = await fetchExecutedMultisigTransactions(address);
    return NextResponse.json(
      { transactions },
      { headers: mergeApiCacheHeaders(undefined, 15) }
    );
  } catch (error) {
    const { error: apiError, statusCode } = handleApiError(
      error,
      'Failed to load Safe history'
    );
    return NextResponse.json({ error: apiError.message }, { status: statusCode });
  }
}
