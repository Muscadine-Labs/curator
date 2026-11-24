import { NextRequest, NextResponse } from 'next/server';
import { getAddress, isAddress } from 'viem';
import { getVaultByAddress } from '@/lib/config/vaults';
import { handleApiError, AppError } from '@/lib/utils/error-handler';
import {
  createRateLimitMiddleware,
  RATE_LIMIT_REQUESTS_PER_MINUTE,
  MINUTE_MS,
} from '@/lib/utils/rate-limit';
import { mergeApiOnChainVaultHeaders } from '@/lib/api/response-cache';
import { unauthorizedUnlessAdmin } from '@/lib/auth/require-admin';
import {
  fetchVaultV2GateAddresses,
  type VaultGateAddresses,
} from '@/lib/morpho/vault-v2-gate-state';

export type VaultV2GatesResponse = VaultGateAddresses & {
  vaultAddress: string;
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
    if (!isAddress(id)) {
      throw new AppError('Invalid vault address', 400, 'INVALID_ADDRESS');
    }
    const address = getAddress(id);
    const cfg = getVaultByAddress(address);
    if (!cfg) {
      throw new AppError('Vault not found in configuration', 404, 'VAULT_NOT_FOUND');
    }

    const gates = await fetchVaultV2GateAddresses(address);
    const response: VaultV2GatesResponse = { vaultAddress: address, ...gates };
    return NextResponse.json(response, {
      headers: mergeApiOnChainVaultHeaders(rateLimitResult.headers),
    });
  } catch (error) {
    const { error: apiError, statusCode } = handleApiError(
      error,
      'Failed to fetch vault gates'
    );
    return NextResponse.json(apiError, { status: statusCode });
  }
}
