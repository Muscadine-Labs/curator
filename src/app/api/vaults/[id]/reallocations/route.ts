import { NextRequest, NextResponse } from 'next/server';
import { parseBoundedIntParam } from '@/lib/api/query-params';
import { getAddress, isAddress } from 'viem';
import { fetchAllocationChanges } from '@/lib/morpho/vault-v2-allocation-history.server';
import { getVaultByAddress } from '@/lib/config/vaults';
import { handleApiError, AppError } from '@/lib/utils/error-handler';
import { createRateLimitMiddleware, RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS } from '@/lib/utils/rate-limit';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { mergeApiCacheHeaders } from '@/lib/api/response-cache';
import { unauthorizedUnlessAdmin } from '@/lib/auth/require-admin';

export type ReallocationEvent = {
  /** Null: rows are net amounts per interval from market supply shares, not transactions. */
  hash: string | null;
  timestamp: number | null;
  blockNumber: number | null;
  type: string;
  assets: string | null;
  /** Signed asset delta for this allocation id (V2). */
  change: string | null;
  adapterAddress: string | null;
  allocationIds: string[];
  market: {
    marketKey: string | null;
    loanAssetSymbol: string | null;
    collateralAssetSymbol: string | null;
    lltv: string | null;
  } | null;
};

export type ReallocationGroup = {
  /** Stable key: interval end (and tx hash when there is one). */
  key: string;
  /** End of the interval. */
  timestamp: number;
  /** Start of the interval (previous position history point). */
  since: number | null;
  hash: string | null;
  blockNumber: number | null;
  events: ReallocationEvent[];
};

export type ReallocationsResponse = {
  vaultAddress: string;
  version: 'v2';
  groups: ReallocationGroup[];
};

/** One group per interval: every cap whose allocation moved in it. */
function groupByInterval(
  events: Array<ReallocationEvent & { since: number }>
): ReallocationGroup[] {
  const map = new Map<string, ReallocationGroup>();
  for (const { since, ...ev } of events) {
    const key = `${ev.timestamp ?? 0}`;
    const existing = map.get(key);
    if (existing) {
      existing.events.push(ev);
    } else {
      map.set(key, {
        key,
        timestamp: ev.timestamp ?? 0,
        since,
        hash: null,
        blockNumber: null,
        events: [ev],
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.timestamp - a.timestamp);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await unauthorizedUnlessAdmin(request);
  if (denied) return denied;
  const rateLimit = createRateLimitMiddleware(RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS);
  const rateLimitResult = rateLimit(request);
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      { status: 429, headers: rateLimitResult.headers }
    );
  }

  try {
    const resolvedParams = await params;
    const rawAddress = resolvedParams?.id;

    if (!rawAddress || !isAddress(rawAddress)) {
      throw new AppError('Invalid vault address', 400, 'INVALID_ADDRESS');
    }

    const vaultAddress = getAddress(rawAddress);
    const vaultConfig = getVaultByAddress(vaultAddress);
    if (!vaultConfig) {
      throw new AppError('Vault not found', 404, 'VAULT_NOT_FOUND');
    }

    if (vaultConfig.morphoVersion !== 'v2') {
      throw new AppError('Vault not found', 404, 'VAULT_NOT_FOUND');
    }

    const url = new URL(request.url);
    const first = parseBoundedIntParam(url.searchParams.get('first'), 100, { min: 1, max: 500 });

    const chainId = vaultConfig.chainId ?? BASE_CHAIN_ID;
    // Morpho drops allocation transactions on 2026-12-02; rebuild net amounts
    // moved per interval from the adapters' market supply shares (no tx hash or sender).
    const changes = await fetchAllocationChanges(vaultAddress, chainId);
    const events = changes.slice(0, first).map((change) => ({
      hash: null,
      timestamp: change.timestamp,
      since: change.since,
      blockNumber: null,
      type: change.change.startsWith('-') ? 'Deallocate' : 'Allocate',
      assets: change.change.replace(/^-/, ''),
      change: change.change,
      adapterAddress: change.adapterAddress,
      allocationIds: [change.capId],
      market: change.marketId
        ? {
            marketKey: change.marketId,
            loanAssetSymbol: null,
            collateralAssetSymbol: null,
            lltv: null,
          }
        : null,
    }));

    const groups = groupByInterval(events);

    const response: ReallocationsResponse = {
      vaultAddress,
      version: 'v2',
      groups,
    };

    const responseHeaders = mergeApiCacheHeaders(rateLimitResult.headers, 60);
    return NextResponse.json(response, { headers: responseHeaders });
  } catch (error) {
    const { error: apiError, statusCode } = handleApiError(error, 'Failed to fetch reallocations');
    return NextResponse.json(apiError, { status: statusCode });
  }
}
