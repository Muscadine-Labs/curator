/**
 * Treasury vault share transfers (GraphQL).
 * Used by Bots → Rebater for outflows, and by the monthly statement to remove
 * capital inflows (deposits and non-mint transfers) from fee revenue.
 */
import { formatUnits, getAddress, isAddress, zeroAddress } from 'viem';
import { bigintRatio } from '@/lib/format/bigint-ratio';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { morphoRestList, morphoSelector } from '@/lib/morpho/rest-client';
import { getRestVault } from '@/lib/morpho/rest-data';
import {
  TREASURY_ADDRESS,
  treasuryAssetKeyForVault,
  type TreasuryAssetKey,
} from '@/lib/morpho/treasury-statement';
import { logger } from '@/lib/utils/logger';

export type TreasuryTransferDirection = 'in' | 'out';

export type TreasuryVaultTransfer = {
  hash: string;
  timestamp: number;
  direction: TreasuryTransferDirection;
  type: 'Transfer' | 'Deposit' | 'Withdraw';
  vaultAddress: string;
  asset: TreasuryAssetKey | null;
  assetSymbol: string;
  assetDecimals: number;
  assetAddress: string | null;
  /** Underlying token raw amount when Morpho indexed it. */
  assetsRaw: string | null;
  sharesRaw: string;
  counterparty: string | null;
  /** Treasury deposited its own capital — not income. */
  isSelfDeposit: boolean;
};

function rawToString(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      return String(BigInt(trimmed));
    } catch {
      return null;
    }
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return String(BigInt(value));
  }
  return null;
}

/**
 * Capital that increased the treasury's share balance and is not fee income.
 * Deposits on behalf of the treasury are capital. Inbound transfers from a
 * real address are capital. A transfer from address(0) is a share mint (fees).
 */
export function isPrincipalCapitalInflow(
  transfer: Pick<TreasuryVaultTransfer, 'direction' | 'type' | 'counterparty'>
): boolean {
  if (transfer.direction !== 'in') return false;
  if (transfer.type === 'Deposit') return true;
  if (transfer.type !== 'Transfer') return false;
  const from = transfer.counterparty?.toLowerCase() ?? '';
  if (!from || from === zeroAddress) return false;
  return true;
}

/**
 * Underlying tokens for a capital inflow. Uses indexed assets when present,
 * otherwise the day's assets-per-share so a transfer with only `shares` still
 * matches booked income.
 */
export function capitalInflowTokens(input: {
  assetsRaw: string | null;
  assetDecimals: number;
  sharesRaw: string;
  dayShares: bigint | null;
  dayTokens: number;
}): number {
  if (input.assetsRaw) {
    try {
      const tokens = Number(formatUnits(BigInt(input.assetsRaw), input.assetDecimals));
      if (Number.isFinite(tokens) && tokens > 0) return tokens;
    } catch {
      // Fall through to the share-balance ratio.
    }
  }
  if (input.dayShares == null || input.dayShares <= 0n || !(input.dayTokens > 0)) return 0;
  let shares: bigint;
  try {
    shares = BigInt(input.sharesRaw);
  } catch {
    return 0;
  }
  if (shares <= 0n) return 0;
  const tokens = bigintRatio(shares, input.dayShares) * input.dayTokens;
  return tokens > 0 ? tokens : 0;
}

export type TreasuryTransfersFetch = {
  transfers: TreasuryVaultTransfer[];
  truncated: boolean;
  error: string | null;
};

type RestActivity = {
  type?: string | null;
  data?: { shares?: string | null; assets?: string | null; from_address?: string | null; to_address?: string | null } | null;
  tx_hash?: string | null;
  timestamp?: number | null;
};

const REST_TYPE: Record<string, { type: TreasuryVaultTransfer['type']; direction: TreasuryTransferDirection }> = {
  deposit: { type: 'Deposit', direction: 'in' },
  withdraw: { type: 'Withdraw', direction: 'out' },
  shares_transfer_in: { type: 'Transfer', direction: 'in' },
  shares_transfer_out: { type: 'Transfer', direction: 'out' },
};

/**
 * The treasury's deposits, withdrawals and share transfers in every Vault V2 it ever held,
 * from Morpho REST `/users/{u}/position/activity` (one list per vault). REST deposit and
 * withdraw rows carry no sender / receiver, so `counterparty` is null for them and
 * `isSelfDeposit` is unknown (false); deposits still count as capital.
 */
export async function fetchTreasuryVaultTransfers(): Promise<TreasuryTransfersFetch> {
  const treasury = getAddress(TREASURY_ADDRESS);
  const out: TreasuryVaultTransfer[] = [];
  try {
    const positions = await morphoRestList<{ vault_address?: string | null }>(
      `/v0/vaults-v2/users/${treasury}/positions`,
      { chain_ids: BASE_CHAIN_ID, active_only: false },
      { revalidate: 0 }
    );
    const vaults = positions.map((p) => p.vault_address).filter((a): a is string => !!a && isAddress(a));
    const perVault = await Promise.all(
      vaults.map(async (vaultAddress) => {
        const selector = morphoSelector(BASE_CHAIN_ID, vaultAddress);
        const [vault, rows] = await Promise.all([
          getRestVault(BASE_CHAIN_ID, vaultAddress),
          morphoRestList<RestActivity>(`/v0/vaults-v2/${selector}/users/${treasury}/position/activity`, { limit: 1000 }, {
            revalidate: 0,
          }),
        ]);
        const symbolHint = vault.asset.symbol?.trim() || null;
        const asset = treasuryAssetKeyForVault(vaultAddress, symbolHint);
        return rows.flatMap((row): TreasuryVaultTransfer[] => {
          const kind = REST_TYPE[row.type ?? ''];
          if (!kind || !row.tx_hash || row.timestamp == null) return [];
          const counterparty =
            row.type === 'shares_transfer_in'
              ? row.data?.from_address ?? null
              : row.type === 'shares_transfer_out'
                ? row.data?.to_address ?? null
                : null;
          return [
            {
              hash: row.tx_hash,
              timestamp: Number(row.timestamp),
              direction: kind.direction,
              type: kind.type,
              vaultAddress: getAddress(vaultAddress),
              asset,
              assetSymbol: symbolHint || asset || 'TOKEN',
              assetDecimals: vault.asset.decimals,
              assetAddress: vault.asset.address,
              assetsRaw: rawToString(row.data?.assets),
              sharesRaw: rawToString(row.data?.shares) ?? '0',
              counterparty,
              isSelfDeposit: false,
            },
          ];
        });
      })
    );
    for (const rows of perVault) out.push(...rows);
    out.sort((a, b) => b.timestamp - a.timestamp);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn('Failed to fetch treasury vault transfers', { error });
    return { transfers: out, truncated: false, error };
  }
  return { transfers: out, truncated: false, error: null };
}
