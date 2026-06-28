import type { CapInfo, VaultV2GovernanceResponse } from '@/app/api/vaults/[id]/governance/route';
import type { V2AdapterRiskData, V2MarketRiskData } from '@/app/api/vaults/[id]/risk/route';
import { isMarketCap } from '@/lib/morpho/cap-utils';
import { marketKeyFromGraphQL } from '@/lib/morpho/morpho-app-links';
import type { MarketParamsInput } from '@/lib/morpho/v2-id-data';

export type BlueMarketEntry = {
  adapterAddress: string;
  marketKey: string;
  market: MarketParamsInput & {
    marketId?: string | null;
    marketKey?: string | null;
    loanAsset?: { address: string; symbol?: string | null; decimals?: number | null } | null;
    collateralAsset?: { address: string; symbol?: string | null; decimals?: number | null } | null;
    state?: {
      supplyApy?: number | null;
      borrowApy?: number | null;
      utilization?: number | null;
      liquidityAssets?: string | number | null;
      liquidityAssetsUsd?: number | null;
    } | null;
  };
  allocationAssets: string | null;
  bookedAllocationAssets?: string | null;
  allocationUsd: number;
};

export function marketAllocationDedupeKey(adapterAddress: string, marketKey: string): string {
  return `${adapterAddress.toLowerCase()}-${marketKey.toLowerCase()}`;
}

/** Market cap with at least one non-zero absolute or relative cap — still allocatable. */
export function isAllocatableMarketCap(cap: CapInfo): boolean {
  try {
    const abs = BigInt(cap.absoluteCap ?? '0');
    const rel = BigInt(cap.relativeCap ?? '0');
    return abs > 0n || rel > 0n;
  } catch {
    return false;
  }
}

function riskMarketToEntry(
  adapterAddress: string,
  m: V2MarketRiskData
): BlueMarketEntry | null {
  const key = marketKeyFromGraphQL(m.market);
  if (!key || !m.market) return null;
  return {
    adapterAddress,
    marketKey: key,
    market: m.market,
    allocationAssets: m.allocationAssets,
    bookedAllocationAssets: m.bookedAllocationAssets ?? m.allocationAssets,
    allocationUsd: m.allocationUsd ?? 0,
  };
}

function capMarketToEntry(cap: CapInfo): BlueMarketEntry | null {
  if (!cap.adapterAddress || !cap.marketKey || !cap.marketParams) return null;
  const loan = cap.marketParams.loanAsset;
  const col = cap.marketParams.collateralAsset;
  if (!loan?.address || !col?.address) return null;

  let allocationAssets: string | null = null;
  try {
    const raw = BigInt(cap.allocation ?? '0');
    allocationAssets = raw > 0n ? raw.toString() : null;
  } catch {
    allocationAssets = null;
  }

  return {
    adapterAddress: cap.adapterAddress,
    marketKey: cap.marketKey,
    market: {
      ...cap.marketParams,
      marketId: cap.marketKey,
      marketKey: cap.marketKey,
      loanAsset: loan,
      collateralAsset: col,
      state: cap.marketParams?.state ?? undefined,
    },
    allocationAssets,
    allocationUsd: 0,
  };
}

/**
 * All Blue markets the vault can target: current adapter positions plus governance
 * market caps (including zero-allocation capped markets).
 */
export function collectMorphoBlueMarketEntries(
  adapter: V2AdapterRiskData,
  governance: VaultV2GovernanceResponse | null | undefined
): BlueMarketEntry[] {
  const byKey = new Map<string, BlueMarketEntry>();

  for (const m of adapter.markets ?? []) {
    const entry = riskMarketToEntry(adapter.adapterAddress, m);
    if (!entry) continue;
    byKey.set(marketAllocationDedupeKey(entry.adapterAddress, entry.marketKey), entry);
  }

  for (const cap of governance?.caps ?? []) {
    if (!isMarketCap(cap) || !isAllocatableMarketCap(cap)) continue;
    if (cap.adapterAddress?.toLowerCase() !== adapter.adapterAddress.toLowerCase()) continue;

    const entry = capMarketToEntry(cap);
    if (!entry) continue;

    const dedupe = marketAllocationDedupeKey(entry.adapterAddress, entry.marketKey);
    if (!byKey.has(dedupe)) {
      byKey.set(dedupe, entry);
    }
  }

  return [...byKey.values()].sort((a, b) => {
    const usdDiff = b.allocationUsd - a.allocationUsd;
    if (usdDiff !== 0) return usdDiff;
    const colA = a.market.collateralAsset?.symbol ?? '';
    const colB = b.market.collateralAsset?.symbol ?? '';
    const loanA = a.market.loanAsset?.symbol ?? '';
    const loanB = b.market.loanAsset?.symbol ?? '';
    return `${colA}/${loanA}`.localeCompare(`${colB}/${loanB}`);
  });
}
