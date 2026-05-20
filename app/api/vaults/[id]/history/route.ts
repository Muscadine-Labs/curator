import { NextRequest, NextResponse } from 'next/server';
import { getAddress, isAddress } from 'viem';
import { morphoGraphQLClient } from '@/lib/morpho/graphql-client';
import {
  VAULT_V1_HISTORY_QUERY,
  VAULT_V2_HISTORY_QUERY,
  buildV1HistorySeries,
  buildV2HistorySeries,
} from '@/lib/morpho/vault-history';
import { resolveAssetDecimals } from '@/lib/format/asset-decimals';
import { getVaultByAddress } from '@/lib/config/vaults';
import { handleApiError, AppError } from '@/lib/utils/error-handler';
import {
  createRateLimitMiddleware,
  RATE_LIMIT_REQUESTS_PER_MINUTE,
  MINUTE_MS,
} from '@/lib/utils/rate-limit';

const HISTORY_START_TIMESTAMP = Math.floor(new Date('2024-06-01').getTime() / 1000);

export type VaultHistoryResponse = {
  vaultAddress: string;
  version: 'v1' | 'v2';
  assetSymbol: string;
  assetDecimals: number;
  /** Morpho indexes historical liquidity for V2 only (TVL − idle = withdrawable, not idle). */
  liquidityHistoricalAvailable: boolean;
  series: ReturnType<typeof buildV1HistorySeries>;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const isV2 = cfg.morphoVersion === 'v2';
    const options = {
      startTimestamp: HISTORY_START_TIMESTAMP,
      endTimestamp: Math.floor(Date.now() / 1000),
      interval: 'DAY' as const,
    };

    if (isV2) {
      const data = await morphoGraphQLClient.request<{
        vault?: {
          asset?: { symbol?: string | null; decimals?: number | null } | null;
          historicalState?: Parameters<typeof buildV2HistorySeries>[0];
        } | null;
      }>(VAULT_V2_HISTORY_QUERY, {
        address,
        chainId: cfg.chainId,
        options,
      });

      if (!data.vault) {
        throw new AppError('Vault not found in Morpho API', 404, 'VAULT_NOT_FOUND');
      }

      const response: VaultHistoryResponse = {
        vaultAddress: address,
        version: 'v2',
        assetSymbol: data.vault.asset?.symbol ?? 'UNKNOWN',
        assetDecimals: resolveAssetDecimals(
          data.vault.asset?.symbol,
          data.vault.asset?.decimals
        ),
        liquidityHistoricalAvailable: true,
        series: buildV2HistorySeries(data.vault.historicalState),
      };

      const headers = new Headers(rateLimitResult.headers);
      headers.set('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300');
      return NextResponse.json(response, { headers });
    }

    const data = await morphoGraphQLClient.request<{
      vault?: {
        asset?: { symbol?: string | null; decimals?: number | null } | null;
        historicalState?: Parameters<typeof buildV1HistorySeries>[0];
      } | null;
    }>(VAULT_V1_HISTORY_QUERY, {
      address,
      chainId: cfg.chainId,
      options,
    });

    if (!data.vault) {
      throw new AppError('Vault not found in Morpho API', 404, 'VAULT_NOT_FOUND');
    }

    const response: VaultHistoryResponse = {
      vaultAddress: address,
      version: 'v1',
      assetSymbol: data.vault.asset?.symbol ?? 'UNKNOWN',
      assetDecimals: resolveAssetDecimals(data.vault.asset?.symbol, data.vault.asset?.decimals),
      liquidityHistoricalAvailable: false,
      series: buildV1HistorySeries(data.vault.historicalState),
    };

    const headers = new Headers(rateLimitResult.headers);
    headers.set('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300');
    return NextResponse.json(response, { headers });
  } catch (error) {
    const { error: apiError, statusCode } = handleApiError(error, 'Failed to fetch vault history');
    return NextResponse.json(apiError, { status: statusCode });
  }
}
