import { NextRequest, NextResponse } from 'next/server';
import { getAddress, isAddress } from 'viem';
import { MorphoRestError } from '@/lib/morpho/rest-client';
import { buildV2HistorySeries, loadVaultV2HistoricalState } from '@/lib/morpho/vault-history';
import { resolveAssetDecimals } from '@/lib/format/asset-decimals';
import { getVaultByAddress } from '@/lib/config/vaults';
import { handleApiError, AppError } from '@/lib/utils/error-handler';
import { mergeApiCacheHeaders } from '@/lib/api/response-cache';
import {
  createRateLimitMiddleware,
  RATE_LIMIT_REQUESTS_PER_MINUTE,
  MINUTE_MS,
} from '@/lib/utils/rate-limit';
import { unauthorizedUnlessAdmin } from '@/lib/auth/require-admin';

export type VaultHistoryResponse = {
  vaultAddress: string;
  version: 'v2';
  assetSymbol: string;
  assetDecimals: number;
  /** False — Morpho does not expose historical liquidity (withdrawable) timeseries. */
  liquidityHistoricalAvailable: boolean;
  series: ReturnType<typeof buildV2HistorySeries>;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
      { status: 429, headers: rateLimitResult.headers }
    );
  }

  try {
    const { id } = await params;

    let address: string;
    if (isAddress(id)) {
      address = getAddress(id);
    } else {
      const cfg = getVaultByAddress(id);
      if (!cfg) {
        throw new AppError('Vault not found', 404, 'VAULT_NOT_FOUND');
      }
      address = getAddress(cfg.address);
    }

    const cfg = getVaultByAddress(address);
    if (!cfg) {
      throw new AppError('Vault not found in configuration', 404, 'VAULT_NOT_FOUND');
    }

    if (cfg.morphoVersion !== 'v2') {
      throw new AppError('Vault not found', 404, 'VAULT_NOT_FOUND');
    }

    let data: Awaited<ReturnType<typeof loadVaultV2HistoricalState>>;
    try {
      data = await loadVaultV2HistoricalState(cfg.chainId, address);
    } catch (error) {
      if (error instanceof MorphoRestError && error.status === 404) {
        throw new AppError('Vault not found in Morpho API', 404, 'VAULT_NOT_FOUND');
      }
      throw error;
    }

    const response: VaultHistoryResponse = {
      vaultAddress: address,
      version: 'v2',
      assetSymbol: data.asset.symbol ?? 'UNKNOWN',
      assetDecimals: resolveAssetDecimals(data.asset.symbol, data.asset.decimals),
      liquidityHistoricalAvailable: false,
      series: buildV2HistorySeries(data.historicalState),
    };

    const headers = mergeApiCacheHeaders(rateLimitResult.headers, 120);
    return NextResponse.json(response, { headers });
  } catch (err) {
    const { error, statusCode } = handleApiError(err, 'Failed to fetch vault history');
    return NextResponse.json(error, { status: statusCode });
  }
}
