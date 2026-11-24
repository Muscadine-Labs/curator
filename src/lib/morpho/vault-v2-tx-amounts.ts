import { bigintShareOf } from '@/lib/format/bigint-ratio';
import type { VaultV2TxData } from '@/lib/morpho/vault-v2-transaction-utils';

/**
 * Asset / USD amounts for Vault V2 deposit, withdraw and transfer rows.
 * Shared by `/api/vaults/[id]/transactions` and `/api/protocol-transactions`.
 *
 * Deposits and withdrawals carry Morpho's indexed `assets` (exact at the tx).
 * Transfers only carry shares, so their assets are estimated at the vault's
 * *current* share price (`assetsEstimated`). USD is always the asset amount
 * valued at today's asset price — Morpho does not index per-tx USD.
 */

export function parseBigIntSafe(value: string | number | null | undefined): bigint | null {
  if (value == null || value === '') return null;
  try {
    return BigInt(typeof value === 'number' ? Math.floor(value) : value);
  } catch {
    return null;
  }
}

export function sharesToAssetsAtCurrentPrice(
  shares: string | null | undefined,
  totalAssets: bigint | null,
  totalSupply: bigint | null
): string | null {
  if (!shares || totalAssets == null || totalSupply == null || totalSupply === 0n) return null;
  try {
    const amount = BigInt(shares);
    if (amount <= 0n) return null;
    return ((amount * totalAssets) / totalSupply).toString();
  } catch {
    return null;
  }
}

/** USD of `assets` at today's asset price (`totalAssetsUsd / totalAssets`). */
export function assetsToUsdAtCurrentPrice(
  assets: string | null,
  totalAssets: bigint | null,
  totalAssetsUsd: number | null
): number | null {
  if (!assets || totalAssets == null || totalAssets === 0n || totalAssetsUsd == null) return null;
  try {
    const amount = BigInt(assets);
    if (amount <= 0n) return null;
    return bigintShareOf(amount, totalAssets, totalAssetsUsd);
  } catch {
    return null;
  }
}

export function mapV2TxAssets(
  data: (VaultV2TxData & { assets?: string | number | null }) | null | undefined,
  shares: string | null | undefined,
  totalAssets: bigint | null,
  totalSupply: bigint | null
): { assets: string | null; assetsEstimated: boolean } {
  if (!data?.__typename) return { assets: null, assetsEstimated: false };
  if (data.__typename === 'VaultV2DepositData' || data.__typename === 'VaultV2WithdrawData') {
    return {
      assets: data.assets != null ? (parseBigIntSafe(data.assets)?.toString() ?? null) : null,
      assetsEstimated: false,
    };
  }
  if (data.__typename === 'VaultV2TransferData') {
    const assets = sharesToAssetsAtCurrentPrice(shares, totalAssets, totalSupply);
    return { assets, assetsEstimated: assets != null };
  }
  return { assets: null, assetsEstimated: false };
}
