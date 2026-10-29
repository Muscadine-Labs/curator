/**
 * Treasury vault share transfers (GraphQL).
 * Used by Bots → Rebater for outflows, and by the monthly statement to remove
 * capital inflows (deposits and non-mint transfers) from fee revenue.
 */
import { gql } from 'graphql-request';
import { formatUnits, getAddress, isAddress, zeroAddress } from 'viem';
import { bigintRatio } from '@/lib/format/bigint-ratio';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { morphoGraphQLClient } from '@/lib/morpho/graphql-client';
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

type TxData =
  | {
      __typename: 'VaultV2DepositData';
      assets?: string | number | null;
      onBehalf?: string | null;
      sender?: string | null;
    }
  | {
      __typename: 'VaultV2WithdrawData';
      assets?: string | number | null;
      onBehalf?: string | null;
      receiver?: string | null;
      sender?: string | null;
    }
  | {
      __typename: 'VaultV2TransferData';
      from?: string | null;
      to?: string | null;
    };

type TxItem = {
  txHash?: string | null;
  timestamp?: number | string | null;
  type?: string | null;
  assets?: string | number | null;
  shares?: string | number | null;
  vault?: {
    address?: string | null;
    asset?: {
      address?: string | null;
      symbol?: string | null;
      decimals?: number | null;
    } | null;
  } | null;
  data?: TxData | null;
};

const TREASURY_TX_QUERY = gql`
  query TreasuryVaultTransfers(
    $user: String!
    $chainIds: [Int!]
    $first: Int!
    $skip: Int!
  ) {
    vaultV2transactions(
      first: $first
      skip: $skip
      orderBy: Time
      orderDirection: Desc
      where: { userAddress_in: [$user], chainId_in: $chainIds }
    ) {
      items {
        txHash
        timestamp
        type
        assets
        shares
        vault {
          address
          asset {
            address
            symbol
            decimals
          }
        }
        data {
          __typename
          ... on VaultV2DepositData {
            assets
            onBehalf
            sender
          }
          ... on VaultV2WithdrawData {
            assets
            onBehalf
            receiver
            sender
          }
          ... on VaultV2TransferData {
            from
            to
          }
        }
      }
    }
  }
`;

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

function classify(
  treasury: string,
  data: TxData | null | undefined
): {
  direction: TreasuryTransferDirection;
  counterparty: string | null;
  isSelfDeposit: boolean;
} | null {
  const t = treasury.toLowerCase();
  if (!data?.__typename) return null;

  if (data.__typename === 'VaultV2TransferData') {
    const from = data.from?.toLowerCase() ?? '';
    const to = data.to?.toLowerCase() ?? '';
    if (to === t && from !== t) {
      return { direction: 'in', counterparty: data.from ?? null, isSelfDeposit: false };
    }
    if (from === t && to !== t) {
      return { direction: 'out', counterparty: data.to ?? null, isSelfDeposit: false };
    }
    return null;
  }

  if (data.__typename === 'VaultV2DepositData') {
    const onBehalf = data.onBehalf?.toLowerCase() ?? '';
    const sender = data.sender?.toLowerCase() ?? '';
    if (onBehalf !== t) return null;
    return {
      direction: 'in',
      counterparty: data.sender ?? null,
      isSelfDeposit: sender === t,
    };
  }

  if (data.__typename === 'VaultV2WithdrawData') {
    const sender = (data.sender ?? data.onBehalf)?.toLowerCase() ?? '';
    if (sender !== t) return null;
    return { direction: 'out', counterparty: data.receiver ?? null, isSelfDeposit: false };
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

function mapItem(treasury: string, item: TxItem): TreasuryVaultTransfer | null {
  if (!item.txHash || item.timestamp == null) return null;
  const typeRaw = item.type ?? '';
  const type =
    typeRaw === 'Deposit' || typeRaw === 'Withdraw' || typeRaw === 'Transfer'
      ? typeRaw
      : null;
  if (!type) return null;

  const classified = classify(treasury, item.data ?? null);
  if (!classified) return null;

  const vaultAddress = item.vault?.address;
  if (!vaultAddress || !isAddress(vaultAddress)) return null;
  const symbolHint = item.vault?.asset?.symbol?.trim() || null;
  const asset = treasuryAssetKeyForVault(vaultAddress, symbolHint);
  const symbol = symbolHint || asset || 'TOKEN';
  const decimals = item.vault?.asset?.decimals ?? (symbol === 'USDC' ? 6 : 18);
  const assetsFromData =
    item.data && 'assets' in item.data ? rawToString(item.data.assets) : null;

  return {
    hash: String(item.txHash),
    timestamp: Number(item.timestamp),
    direction: classified.direction,
    type,
    vaultAddress: getAddress(vaultAddress),
    asset,
    assetSymbol: symbol,
    assetDecimals: decimals,
    assetAddress: item.vault?.asset?.address ?? null,
    assetsRaw: rawToString(item.assets) ?? assetsFromData,
    sharesRaw: rawToString(item.shares) ?? '0',
    counterparty: classified.counterparty,
    isSelfDeposit: classified.isSelfDeposit,
  };
}

const PAGE = 100;
const MAX_PAGES = 20;

export type TreasuryTransfersFetch = {
  transfers: TreasuryVaultTransfer[];
  truncated: boolean;
  error: string | null;
};

export async function fetchTreasuryVaultTransfers(): Promise<TreasuryTransfersFetch> {
  const treasury = getAddress(TREASURY_ADDRESS);
  const out: TreasuryVaultTransfer[] = [];
  let skip = 0;
  let truncated = false;
  let error: string | null = null;

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await morphoGraphQLClient.request<{
        vaultV2transactions?: { items?: Array<TxItem | null> | null } | null;
      }>(TREASURY_TX_QUERY, {
        user: treasury,
        chainIds: [BASE_CHAIN_ID],
        first: PAGE,
        skip,
      });
      const items = (data.vaultV2transactions?.items ?? []).filter(
        (x): x is TxItem => x != null
      );
      if (items.length === 0) {
        truncated = false;
        break;
      }
      for (const item of items) {
        const mapped = mapItem(treasury, item);
        if (mapped) out.push(mapped);
      }
      if (items.length < PAGE) {
        truncated = false;
        break;
      }
      skip += PAGE;
      if (page === MAX_PAGES - 1) truncated = true;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    logger.warn('Failed to fetch treasury vault transfers', { error });
  }

  return { transfers: out, truncated, error };
}
