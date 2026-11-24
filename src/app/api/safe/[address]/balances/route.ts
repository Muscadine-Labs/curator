import { NextRequest, NextResponse } from 'next/server';
import { getAddress, isAddress } from 'viem';
import { readSafeTokenBalances } from '@/lib/safe/read-balances';
import { parseExtraTokenParam } from '@/lib/safe/tokens';
import { mergeApiCacheHeaders } from '@/lib/api/response-cache';
import { handleApiError } from '@/lib/utils/error-handler';
import { unauthorizedUnlessAdmin } from '@/lib/auth/require-admin';

type RouteParams = { params: Promise<{ address: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const denied = await unauthorizedUnlessAdmin(request);
  if (denied) return denied;
  try {
    const { address: raw } = await params;
    if (!isAddress(raw)) {
      return NextResponse.json({ error: 'Invalid Safe address' }, { status: 400 });
    }

    const extra = parseExtraTokenParam(request.nextUrl.searchParams.get('tokens'));
    const balances = await readSafeTokenBalances(getAddress(raw), extra);

    return NextResponse.json(
      { balances: balances.map((b) => ({ ...b, balance: b.balance.toString() })) },
      { headers: mergeApiCacheHeaders(undefined, 15) }
    );
  } catch (error) {
    const { error: apiError, statusCode } = handleApiError(error, 'Failed to read Safe balances');
    return NextResponse.json({ error: apiError.message }, { status: statusCode });
  }
}
