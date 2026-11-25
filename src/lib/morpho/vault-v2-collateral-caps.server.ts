import { getAddress } from 'viem';
import type { CapInfo } from '@/app/api/vaults/[id]/governance/route';
import { morphoRestGet, morphoSelector } from '@/lib/morpho/rest-client';
import { isCollateralCap } from '@/lib/morpho/cap-utils';
import { logger } from '@/lib/utils/logger';
import { withServerResponseCache } from '@/lib/api/server-response-cache';
import { API_CACHE_MAX_AGE_MS } from '@/lib/api/response-cache';

type RestCap = {
  cap_id?: string | null;
  cap_type?: string | null;
  absolute_cap?: string | null;
  relative_cap_wad?: string | null;
  allocated_assets?: string | null;
  collateral_address?: string | null;
};

type RestAllocations = {
  allocations?: Array<{ caps?: RestCap[] | null } | null> | null;
  unscoped_caps?: RestCap[] | null;
};

/**
 * Collateral caps from Morpho REST `/allocations`. Morpho GraphQL removes
 * `CollateralCapData.collateralAddress` on 2026-12-02; without the address a
 * collateral cap has no idData, so Sentinel cannot decrease it and the Caps
 * tab cannot label it. Values are re-read on chain by the cap overlay.
 */
export async function fetchCollateralCapsRest(
  vaultAddress: string,
  chainId: number
): Promise<CapInfo[]> {
  const data = await morphoRestGet<RestAllocations>(
    `/v0/vaults-v2/${morphoSelector(chainId, getAddress(vaultAddress))}/allocations`
  );
  const all = [
    ...(data.unscoped_caps ?? []),
    ...(data.allocations ?? []).flatMap((a) => a?.caps ?? []),
  ];
  const seen = new Set<string>();
  const caps: CapInfo[] = [];
  for (const cap of all) {
    if (cap?.cap_type !== 'collateral' || !cap.collateral_address) continue;
    const key = (cap.cap_id ?? cap.collateral_address).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    caps.push({
      type: 'Collateral',
      absoluteCap: cap.absolute_cap ?? '0',
      relativeCap: cap.relative_cap_wad ?? '0',
      allocation: cap.allocated_assets ?? '0',
      collateralAddress: getAddress(cap.collateral_address),
    });
  }
  return caps;
}

/**
 * Swap GraphQL collateral caps (no address once Morpho drops the field) for the
 * REST ones. `rest === null` means the REST read failed: GraphQL caps are kept
 * so the other cap types still show.
 */
export function withRestCollateralCaps(
  graphCaps: readonly CapInfo[],
  rest: readonly CapInfo[] | null
): CapInfo[] {
  if (rest === null) return [...graphCaps];
  return [...graphCaps.filter((cap) => !isCollateralCap(cap)), ...rest];
}

/** `fetchCollateralCapsRest`, with a failure logged and reported as `null`. */
export async function tryFetchCollateralCapsRest(
  vaultAddress: string,
  chainId: number
): Promise<CapInfo[] | null> {
  try {
    // Governance refetches on every tab switch; one REST read per vault per 30s.
    return await withServerResponseCache(
      `vault-collateral-caps:${chainId}:${vaultAddress.toLowerCase()}`,
      API_CACHE_MAX_AGE_MS,
      () => fetchCollateralCapsRest(vaultAddress, chainId)
    );
  } catch (error) {
    logger.warn('Morpho REST collateral caps failed; keeping GraphQL caps', {
      vaultAddress,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
