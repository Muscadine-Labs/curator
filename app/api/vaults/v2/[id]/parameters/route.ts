import { NextRequest, NextResponse } from 'next/server';
import { getAddress, isAddress } from 'viem';
import { morphoGraphQLClient } from '@/lib/morpho/graphql-client';
import {
  VAULT_V2_PARAMETERS_QUERY,
  morphoFeeToPercent,
} from '@/lib/morpho/vault-v2-api';
import { getVaultByAddress } from '@/lib/config/vaults';
import { handleApiError, AppError } from '@/lib/utils/error-handler';
import { createRateLimitMiddleware, RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS } from '@/lib/utils/rate-limit';
import { BASE_CHAIN_ID } from '@/lib/constants';

type GraphResponse = {
  vault?: {
    address?: string | null;
    name?: string | null;
    symbol?: string | null;
    performanceFee?: number | null;
    managementFee?: number | null;
    maxRate?: string | number | null;
    performanceFeeRecipient?: string | null;
    managementFeeRecipient?: string | null;
    timelocks?: Array<{
      selector?: string | null;
      functionName?: string | null;
      duration?: string | number | null;
    } | null> | null;
  } | null;
};

export type VaultV2ParametersResponse = {
  vaultAddress: string;
  name: string;
  symbol: string;
  performanceFeePercent: number | null;
  managementFeePercent: number | null;
  maxRate: string;
  performanceFeeRecipient: string | null;
  managementFeeRecipient: string | null;
  timelocks: Array<{
    selector: string;
    functionName: string;
    durationSeconds: number;
  }>;
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
    const chainId = cfg?.chainId ?? BASE_CHAIN_ID;

    const data = await morphoGraphQLClient.request<GraphResponse>(VAULT_V2_PARAMETERS_QUERY, {
      address,
      chainId,
    });

    if (!data.vault) {
      throw new AppError('Vault not found in Morpho API', 404, 'VAULT_NOT_FOUND');
    }

    const timelocks =
      data.vault.timelocks
        ?.filter((t): t is NonNullable<typeof t> => Boolean(t?.selector && t?.functionName))
        .map((t) => ({
          selector: t.selector!,
          functionName: t.functionName!,
          durationSeconds:
            t.duration == null
              ? 0
              : typeof t.duration === 'string'
                ? Number(t.duration)
                : t.duration,
        })) ?? [];

    const response: VaultV2ParametersResponse = {
      vaultAddress: address,
      name: data.vault.name ?? '',
      symbol: data.vault.symbol ?? '',
      performanceFeePercent: morphoFeeToPercent(data.vault.performanceFee),
      managementFeePercent: morphoFeeToPercent(data.vault.managementFee),
      maxRate:
        data.vault.maxRate == null
          ? '0'
          : typeof data.vault.maxRate === 'string'
            ? data.vault.maxRate
            : data.vault.maxRate.toString(),
      performanceFeeRecipient: data.vault.performanceFeeRecipient ?? null,
      managementFeeRecipient: data.vault.managementFeeRecipient ?? null,
      timelocks,
    };

    const headers = new Headers(rateLimitResult.headers);
    headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');

    return NextResponse.json(response, { headers });
  } catch (error) {
    const { error: apiError, statusCode } = handleApiError(error, 'Failed to fetch v2 parameters');
    return NextResponse.json(apiError, { status: statusCode });
  }
}
