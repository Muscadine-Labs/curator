import { NextRequest, NextResponse } from 'next/server';
import { getAddress, isAddress } from 'viem';
import { readSafeOnChainInfo } from '@/lib/safe/onchain-reads';
import { fetchSafeProposers } from '@/lib/safe/fetch-safe-proposers.server';
import { getSafeByAddress } from '@/lib/safe/config';
import { mergeApiCacheHeaders } from '@/lib/api/response-cache';
import { handleApiError } from '@/lib/utils/error-handler';

type RouteParams = { params: Promise<{ address: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const { address: raw } = await params;
    if (!isAddress(raw)) {
      return NextResponse.json({ error: 'Invalid Safe address' }, { status: 400 });
    }

    const address = getAddress(raw);
    const [info, proposersInfo] = await Promise.all([
      readSafeOnChainInfo(address),
      fetchSafeProposers(address),
    ]);
    const config = getSafeByAddress(address);

    return NextResponse.json(
      {
        ...info,
        ...proposersInfo,
        nonce: info.nonce.toString(),
        ethBalance: info.ethBalance.toString(),
        role: config?.role ?? null,
        label: config?.label ?? null,
      },
      { headers: mergeApiCacheHeaders(undefined, 15) }
    );
  } catch (error) {
    const { error: apiError, statusCode } = handleApiError(error, 'Failed to read Safe info');
    return NextResponse.json({ error: apiError.message }, { status: statusCode });
  }
}
