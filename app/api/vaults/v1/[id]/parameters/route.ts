import { NextRequest, NextResponse } from 'next/server';
import { getAddress, isAddress, type Address } from 'viem';
import { multicallRead } from '@/lib/onchain/client';
import { getVaultByAddress } from '@/lib/config/vaults';
import { handleApiError, AppError } from '@/lib/utils/error-handler';
import { createRateLimitMiddleware, RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS } from '@/lib/utils/rate-limit';

const VAULT_PARAMS_ABI = [
  {
    name: 'publicAllocatorAdmin',
    type: 'function' as const,
    stateMutability: 'view' as const,
    inputs: [] as const,
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'publicAllocatorFeeBps',
    type: 'function' as const,
    stateMutability: 'view' as const,
    inputs: [] as const,
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'timelockDuration',
    type: 'function' as const,
    stateMutability: 'view' as const,
    inputs: [] as const,
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export type VaultV1ParametersResponse = {
  vaultAddress: string;
  publicAllocatorAdmin: string | null;
  publicAllocatorFeeBps: number | null;
  timelockDurationSeconds: number | null;
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
    if (cfg?.morphoVersion === 'v2') {
      throw new AppError('Vault is not a V1 vault', 400, 'INVALID_VAULT_VERSION');
    }

    const [publicAllocatorAdmin, publicAllocatorFeeBps, timelockDuration] =
      await multicallRead<Address | bigint>([
        { address: address as Address, abi: VAULT_PARAMS_ABI, functionName: 'publicAllocatorAdmin' },
        { address: address as Address, abi: VAULT_PARAMS_ABI, functionName: 'publicAllocatorFeeBps' },
        { address: address as Address, abi: VAULT_PARAMS_ABI, functionName: 'timelockDuration' },
      ]);

    const response: VaultV1ParametersResponse = {
      vaultAddress: address,
      publicAllocatorAdmin: publicAllocatorAdmin ? String(publicAllocatorAdmin) : null,
      publicAllocatorFeeBps:
        publicAllocatorFeeBps != null ? Number(publicAllocatorFeeBps) : null,
      timelockDurationSeconds:
        timelockDuration != null ? Number(timelockDuration) : null,
    };

    const headers = new Headers(rateLimitResult.headers);
    headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');

    return NextResponse.json(response, { headers });
  } catch (error) {
    const { error: apiError, statusCode } = handleApiError(error, 'Failed to fetch v1 parameters');
    return NextResponse.json(apiError, { status: statusCode });
  }
}
