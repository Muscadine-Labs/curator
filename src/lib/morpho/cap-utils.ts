import type { CapInfo } from '@/app/api/vaults/[id]/governance/route';

/** Morpho GraphQL cap `type` values (VaultV2CapType enum). */
export function isAdapterCap(cap: CapInfo): boolean {
  return cap.type === 'Adapter' || (!cap.marketKey && !cap.collateralAddress && !!cap.adapterAddress);
}

export function isMarketCap(cap: CapInfo): boolean {
  return cap.type === 'MarketV1' || !!cap.marketKey;
}

export function isCollateralCap(cap: CapInfo): boolean {
  return cap.type === 'Collateral' || (!!cap.collateralAddress && !cap.marketKey && !cap.adapterAddress);
}

export function computeCapUtilizationPercent(caps: CapInfo[]): number | null {
  if (caps.length === 0) return null;
  let totalCap = 0n;
  let totalAlloc = 0n;
  for (const cap of caps) {
    try {
      const abs = BigInt(cap.absoluteCap ?? '0');
      const alloc = BigInt(cap.allocation ?? '0');
      if (abs > 0n) {
        totalCap += abs;
        totalAlloc += alloc > abs ? abs : alloc;
      }
    } catch {
      /* skip malformed */
    }
  }
  if (totalCap === 0n) return null;
  return Number((totalAlloc * 10000n) / totalCap) / 100;
}
