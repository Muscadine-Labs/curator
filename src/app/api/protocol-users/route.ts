import { NextRequest, NextResponse } from 'next/server';
import { getAddress } from 'viem';
import {
  getActiveVaultAddressesForStats,
  getConfiguredVaultDisplayName,
  isFeeWrapperAdapterAddress,
  withFeeWrapperLabel,
} from '@/lib/config/vaults';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { handleApiError } from '@/lib/utils/error-handler';
import {
  createRateLimitMiddleware,
  RATE_LIMIT_REQUESTS_PER_MINUTE,
  MINUTE_MS,
} from '@/lib/utils/rate-limit';
import { mergeApiCacheHeaders } from '@/lib/api/response-cache';
import { withServerResponseCache } from '@/lib/api/server-response-cache';
import { API_CACHE_MAX_AGE_MS } from '@/lib/api/response-cache';
import { batchVaultV2ByAddress } from '@/lib/morpho/batch-vault-graphql';
import { fetchAllV2Positions } from '@/lib/morpho/paginate-v2-positions';
import { unauthorizedUnlessAdmin } from '@/lib/auth/require-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export type ProtocolUserVaultPosition = {
  vaultAddress: string;
  vaultName: string;
  assetSymbol: string;
  assetDecimals: number | null;
  assets: string | null;
  assetsUsd: number | null;
  shares: string | null;
};

export type ProtocolUser = {
  address: string;
  totalUsd: number;
  vaultCount: number;
  positions: ProtocolUserVaultPosition[];
};

export type ProtocolUsersResponse = {
  users: ProtocolUser[];
  totalUsers: number;
};

export async function GET(request: NextRequest) {
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
    const payload = await withServerResponseCache(
      'protocol-users-v3',
      API_CACHE_MAX_AGE_MS,
      async (): Promise<ProtocolUsersResponse> => {
        const vaults = getActiveVaultAddressesForStats();
        const byUser = new Map<string, ProtocolUser>();

        const meta = await batchVaultV2ByAddress<{
          name?: string | null;
          asset?: { symbol?: string | null; decimals?: number | null } | null;
        }>(
          vaults.map((v) => ({ address: v.address, chainId: v.chainId ?? BASE_CHAIN_ID })),
          `name asset { symbol decimals }`
        );

        const results = await Promise.all(
          vaults.map(async (vault) => {
            const address = getAddress(vault.address);
            try {
              const items = await fetchAllV2Positions(
                address,
                vault.chainId ?? BASE_CHAIN_ID
              );
              return { vault, address, items };
            } catch {
              return { vault, address, items: [] };
            }
          })
        );

        for (const { vault, address, items } of results) {
          const gqlMeta = meta.get(vault.address.toLowerCase());
          const vaultName = withFeeWrapperLabel(
            gqlMeta?.name?.trim() || getConfiguredVaultDisplayName(vault),
            address
          );
          const assetSymbol = gqlMeta?.asset?.symbol ?? vault.assetSymbol;
          const assetDecimals = gqlMeta?.asset?.decimals ?? null;

          for (const item of items) {
            const userAddress = item?.user?.address;
            if (!userAddress) continue;
            const key = userAddress.toLowerCase();
            // Skip null / burn addresses and fee-wrapper adapters — not depositors.
            if (
              key === '0x0000000000000000000000000000000000000000' ||
              key === '0x000000000000000000000000000000000000dead' ||
              isFeeWrapperAdapterAddress(key)
            ) {
              continue;
            }
            const assetsUsd = item.assetsUsd ?? 0;
            // Skip dust / empty positions for the directory view.
            if (
              (item.assets == null || item.assets === '0') &&
              (!assetsUsd || assetsUsd <= 0)
            ) {
              continue;
            }

            const position: ProtocolUserVaultPosition = {
              vaultAddress: address,
              vaultName,
              assetSymbol,
              assetDecimals,
              assets: item.assets ?? null,
              assetsUsd: item.assetsUsd ?? null,
              shares: item.shares ?? null,
            };

            const existing = byUser.get(key);
            if (existing) {
              existing.positions.push(position);
              existing.totalUsd += assetsUsd;
              existing.vaultCount = existing.positions.length;
            } else {
              byUser.set(key, {
                address: getAddress(userAddress),
                totalUsd: assetsUsd,
                vaultCount: 1,
                positions: [position],
              });
            }
          }
        }

        const users = Array.from(byUser.values()).sort(
          (a, b) => b.totalUsd - a.totalUsd
        );

        return { users, totalUsers: users.length };
      }
    );

    const headers = mergeApiCacheHeaders(rateLimitResult.headers, 60);
    return NextResponse.json(payload, { headers });
  } catch (error) {
    const { error: apiError, statusCode } = handleApiError(
      error,
      'Failed to fetch protocol users'
    );
    return NextResponse.json(apiError, { status: statusCode });
  }
}
