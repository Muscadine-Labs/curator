import { NextRequest, NextResponse } from 'next/server';
import { getAddress, isAddress, type Address } from 'viem';
import { handleApiError, AppError } from '@/lib/utils/error-handler';
import {
  createRateLimitMiddleware,
  RATE_LIMIT_REQUESTS_PER_MINUTE,
  MINUTE_MS,
} from '@/lib/utils/rate-limit';
import { mergeApiOnChainVaultHeaders } from '@/lib/api/response-cache';
import { unauthorizedUnlessAdmin } from '@/lib/auth/require-admin';
import { publicClient } from '@/lib/onchain/client';
import { whitelistSendAssetsGateAbi } from '@/lib/onchain/whitelist-send-assets-gate-abi';
import {
  configuredSendAssetsGates,
  depositGateAdapterAllowlist,
  depositGateGateWhitelisters,
  resolveAllowlistLabel,
} from '@/lib/config/deposit-gates';
import {
  readGateRosterCandidates,
  type GateRosterStatus,
} from '@/lib/morpho/send-assets-gate-roster.server';

export type GateAccountStatus = {
  address: Address;
  label: string;
  isWhitelisted: boolean | null;
  isWhitelister: boolean | null;
};

export type SendAssetsGateState = {
  address: Address;
  label: string;
  roleSetter: Address | null;
  accounts: GateAccountStatus[];
  /**
   * `complete` means every log the gate emitted was read.
   * `failed` means that lookup did not answer, so only configured accounts are listed.
   */
  rosterScan: { status: GateRosterStatus };
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
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
    const { address: raw } = await params;
    if (!isAddress(raw)) {
      throw new AppError('Invalid gate address', 400, 'INVALID_ADDRESS');
    }
    const address = getAddress(raw);
    const configured = configuredSendAssetsGates().find(
      (g) => g.address.toLowerCase() === address.toLowerCase()
    );
    if (!configured) {
      throw new AppError('Gate is not in curator config', 404, 'GATE_NOT_FOUND');
    }

    // Role Safes and wrapper adapters are checked immediately. Every other
    // allowlisted account comes from the gate's logs, then isWhitelisted().
    const configuredRows = [
      ...depositGateGateWhitelisters(),
      ...depositGateAdapterAllowlist(),
    ];
    const roster = await readGateRosterCandidates(address);
    const seen = new Set<string>();
    const unique: Array<{ address: Address; label: string }> = [];
    for (const candidate of [
      ...configuredRows.map((row) => row.address),
      ...roster.accounts,
    ]) {
      const checksummed = getAddress(candidate);
      const key = checksummed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push({
        address: checksummed,
        label: resolveAllowlistLabel(checksummed),
      });
    }

    const [roleSetterRead, accountReads] = await Promise.all([
      publicClient.multicall({
        allowFailure: true,
        contracts: [
          {
            address,
            abi: whitelistSendAssetsGateAbi,
            functionName: 'roleSetter',
          },
        ],
      }),
      unique.length === 0
        ? Promise.resolve([])
        : publicClient.multicall({
            allowFailure: true,
            contracts: unique.flatMap((row) => [
              {
                address,
                abi: whitelistSendAssetsGateAbi,
                functionName: 'isWhitelisted' as const,
                args: [row.address] as const,
              },
              {
                address,
                abi: whitelistSendAssetsGateAbi,
                functionName: 'isWhitelister' as const,
                args: [row.address] as const,
              },
            ]),
          }),
    ]);

    const roleSetterResult = roleSetterRead[0];
    const roleSetter =
      roleSetterResult?.status === 'success' ? getAddress(roleSetterResult.result) : null;

    const accountStatus: GateAccountStatus[] = unique.map((row, i) => {
      const listed = accountReads[i * 2];
      const lister = accountReads[i * 2 + 1];
      const isWhitelisted = listed?.status === 'success' ? Boolean(listed.result) : null;
      const isWhitelister = lister?.status === 'success' ? Boolean(lister.result) : null;
      const label =
        row.label === 'Whitelisted address' && isWhitelisted !== true && isWhitelister === true
          ? 'Whitelister'
          : row.label;
      return {
        address: row.address,
        label,
        isWhitelisted,
        isWhitelister,
      };
    });

    const response: SendAssetsGateState = {
      address,
      label: configured.label,
      roleSetter,
      accounts: accountStatus,
      rosterScan: { status: roster.status },
    };
    return NextResponse.json(response, {
      headers: mergeApiOnChainVaultHeaders(rateLimitResult.headers),
    });
  } catch (error) {
    const { error: apiError, statusCode } = handleApiError(error, 'Failed to read send-assets gate');
    return NextResponse.json(apiError, { status: statusCode });
  }
}
