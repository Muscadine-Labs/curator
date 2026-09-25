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
  depositGateDeployBlock,
  depositGateFullWhitelist,
  depositGateGateWhitelisters,
} from '@/lib/config/deposit-gates';
import { getSafeByAddress } from '@/lib/safe/config';
import { getConfiguredVaultDisplayName, getVaultByAddress } from '@/lib/config/vaults';
import {
  readGateRosterCandidates,
  type GateRosterScanStatus,
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
   * Event-history scan state. Until `complete`, `accounts` covers configured
   * addresses plus whatever the scan has reached so far.
   */
  rosterScan: { status: GateRosterScanStatus; progress: number };
};

/** Config label, else a known Safe / vault, else a neutral fallback. */
function labelForRosterAccount(address: Address, configured: Map<string, string>): string {
  const fromConfig = configured.get(address.toLowerCase());
  if (fromConfig) return fromConfig;
  const safe = getSafeByAddress(address);
  if (safe) return safe.label === 'Treasury' ? 'Treasury' : `${safe.label} Safe`;
  const vault = getVaultByAddress(address);
  if (vault) return getConfiguredVaultDisplayName(vault);
  return 'Account';
}

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

    const configuredRows = [
      ...depositGateGateWhitelisters(),
      ...depositGateFullWhitelist(),
    ];
    const configuredLabels = new Map<string, string>();
    for (const row of configuredRows) {
      const key = row.address.toLowerCase();
      if (!configuredLabels.has(key)) configuredLabels.set(key, row.label);
    }

    // Config seeds the list; the gate's own events add anyone whitelisted
    // outside this app's config (e.g. a partner added from the Update form).
    const roster = await readGateRosterCandidates(address, depositGateDeployBlock(address));
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
        label: labelForRosterAccount(checksummed, configuredLabels),
      });
    }

    const roleSetterRead = await publicClient.multicall({
      allowFailure: true,
      contracts: [
        {
          address,
          abi: whitelistSendAssetsGateAbi,
          functionName: 'roleSetter',
        },
      ],
    });
    const accountReads =
      unique.length === 0
        ? []
        : await publicClient.multicall({
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
          });

    const roleSetterResult = roleSetterRead[0];
    const roleSetter =
      roleSetterResult?.status === 'success'
        ? getAddress(roleSetterResult.result)
        : null;

    const accountStatus: GateAccountStatus[] = unique.map((row, i) => {
      const listed = accountReads[i * 2];
      const lister = accountReads[i * 2 + 1];
      return {
        address: row.address,
        label: row.label,
        isWhitelisted: listed?.status === 'success' ? Boolean(listed.result) : null,
        isWhitelister: lister?.status === 'success' ? Boolean(lister.result) : null,
      };
    });

    const response: SendAssetsGateState = {
      address,
      label: configured.label,
      roleSetter,
      accounts: accountStatus,
      rosterScan: { status: roster.status, progress: roster.progress },
    };
    return NextResponse.json(response, {
      headers: mergeApiOnChainVaultHeaders(rateLimitResult.headers),
    });
  } catch (error) {
    const { error: apiError, statusCode } = handleApiError(error, 'Failed to read send-assets gate');
    return NextResponse.json(apiError, { status: statusCode });
  }
}
