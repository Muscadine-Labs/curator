import type { OracleTimestampData } from './oracle-utils';

/** Whether a vault position has any allocated assets (USD or raw token amount). */
export function hasActiveAllocation(
  allocationUsd?: number | null,
  allocationAssets?: string | number | null
): boolean {
  if ((allocationUsd ?? 0) > 0) return true;
  if (allocationAssets === null || allocationAssets === undefined) return false;
  try {
    return BigInt(allocationAssets) > 0n;
  } catch {
    return false;
  }
}

/** Whether a cap has a non-zero absolute or relative limit. */
export function hasNonZeroCap(
  absoluteCap?: string | null,
  relativeCap?: string | null
): boolean {
  try {
    if (absoluteCap != null && BigInt(absoluteCap) > 0n) return true;
    if (relativeCap != null && BigInt(relativeCap) > 0n) return true;
  } catch {
    // fall through
  }
  return false;
}

/** Show in risk when allocated or capped (non-zero cap limits). */
export function shouldShowMarketEntry(
  allocationUsd?: number | null,
  allocationAssets?: string | number | null,
  absoluteCap?: string | null,
  relativeCap?: string | null
): boolean {
  if (hasActiveAllocation(allocationUsd, allocationAssets)) return true;
  if (hasNonZeroCap(absoluteCap, relativeCap)) return true;
  return false;
}

/** Show adapter when allocated, capped, or has visible underlying markets. */
export function shouldShowAdapterEntry(
  allocationUsd?: number | null,
  allocationAssets?: string | number | null,
  absoluteCap?: string | null,
  relativeCap?: string | null,
  hasVisibleMarkets = false
): boolean {
  if (hasVisibleMarkets) return true;
  return shouldShowMarketEntry(allocationUsd, allocationAssets, absoluteCap, relativeCap);
}

export function formatOracleLastUpdated(
  updatedAt: number | null | undefined
): string | null {
  if (updatedAt == null || !Number.isFinite(updatedAt)) {
    return null;
  }

  const date = new Date(updatedAt * 1000);
  const year = date.getUTCFullYear();
  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const month = monthNames[date.getUTCMonth()];
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');

  return `${day} ${month} ${year}, ${hours}:${minutes}:${seconds} UTC`;
}

export function formatOracleAge(ageSeconds: number | null | undefined): string | null {
  if (ageSeconds == null || !Number.isFinite(ageSeconds)) {
    return null;
  }

  const ageHours = ageSeconds / 3600;
  const ageDays = ageHours / 24;

  if (ageHours < 1) {
    return `${ageHours.toFixed(1)}h ago`;
  }
  if (ageDays < 7) {
    return `${ageDays.toFixed(1)}d ago`;
  }
  return `${ageDays.toFixed(0)}d ago`;
}

type OracleTimestampLike = {
  updatedAt?: number | null;
  ageSeconds?: number | null;
} | null | undefined;

export function getOracleDisplayLines(
  oracleTimestampData?: OracleTimestampData | OracleTimestampLike
): { lastUpdated: string | null; age: string | null } {
  return {
    lastUpdated: formatOracleLastUpdated(oracleTimestampData?.updatedAt),
    age: formatOracleAge(oracleTimestampData?.ageSeconds),
  };
}
