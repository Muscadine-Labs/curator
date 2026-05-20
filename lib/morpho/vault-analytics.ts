import type { CapInfo } from '@/app/api/vaults/v2/[id]/governance/route';
import { computeCapUtilizationPercent } from '@/lib/morpho/cap-utils';

export type VaultAnalytics = {
  totalAssetsUnderlying: string | null;
  liquidityUsd: number | null;
  liquidityUnderlying: string | null;
  idleAssetsUsd: number | null;
  idleAssetsUnderlying: string | null;
  idlePercent: number | null;
  deployedPercent: number | null;
  managementFeePercent: number | null;
  capUtilizationPercent: number | null;
};

function toUnderlyingString(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  return typeof value === 'string' ? value : String(value);
}

export function buildVaultAnalytics(params: {
  tvlUsd: number | null;
  totalAssetsUnderlying?: string | number | null;
  liquidityUsd?: number | null;
  liquidityUnderlying?: string | number | null;
  idleAssetsUsd?: number | null;
  idleAssetsUnderlying?: string | number | null;
  managementFee?: number | null;
  caps?: CapInfo[];
}): VaultAnalytics {
  const tvl = params.tvlUsd ?? 0;
  const liquidityUsd = params.liquidityUsd ?? null;
  const idleAssetsUsd = params.idleAssetsUsd ?? null;

  const idlePercent =
    tvl > 0 && idleAssetsUsd != null ? (idleAssetsUsd / tvl) * 100 : null;

  const deployedPercent =
    tvl > 0 && idleAssetsUsd != null ? ((tvl - idleAssetsUsd) / tvl) * 100 : null;

  return {
    totalAssetsUnderlying: toUnderlyingString(params.totalAssetsUnderlying),
    liquidityUsd,
    liquidityUnderlying: toUnderlyingString(params.liquidityUnderlying),
    idleAssetsUsd: idleAssetsUsd ?? null,
    idleAssetsUnderlying: toUnderlyingString(params.idleAssetsUnderlying),
    idlePercent,
    deployedPercent,
    managementFeePercent:
      params.managementFee != null ? params.managementFee * 100 : null,
    capUtilizationPercent: params.caps ? computeCapUtilizationPercent(params.caps) : null,
  };
}
