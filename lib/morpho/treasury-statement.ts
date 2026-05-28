import { gql } from 'graphql-request';
import { getAddress } from 'viem';
import { morphoGraphQLClient } from '@/lib/morpho/graphql-client';
import { logger } from '@/lib/utils/logger';

/** Safe that receives vault performance fees and holds vault share positions. */
export const TREASURY_ADDRESS = '0x057fd8B961Eb664baA647a5C7A6e9728fabA266A';

/** Monthly statements begin November 2025. */
export const STATEMENT_START_DATE = new Date('2025-11-01T00:00:00Z');

export type TreasuryAssetKey = 'USDC' | 'cbBTC' | 'WETH';

export type TreasuryAssetBreakdown = Record<
  TreasuryAssetKey,
  { tokens: number; usd: number }
>;

export function emptyTreasuryAssetBreakdown(): TreasuryAssetBreakdown {
  return {
    USDC: { tokens: 0, usd: 0 },
    cbBTC: { tokens: 0, usd: 0 },
    WETH: { tokens: 0, usd: 0 },
  };
}

export function sumTreasuryBreakdownUsd(assets: TreasuryAssetBreakdown): number {
  return assets.USDC.usd + assets.cbBTC.usd + assets.WETH.usd;
}

export function addTreasuryBreakdowns(
  a: TreasuryAssetBreakdown,
  b: TreasuryAssetBreakdown
): TreasuryAssetBreakdown {
  return {
    USDC: { tokens: a.USDC.tokens + b.USDC.tokens, usd: a.USDC.usd + b.USDC.usd },
    cbBTC: { tokens: a.cbBTC.tokens + b.cbBTC.tokens, usd: a.cbBTC.usd + b.cbBTC.usd },
    WETH: { tokens: a.WETH.tokens + b.WETH.tokens, usd: a.WETH.usd + b.WETH.usd },
  };
}

export function subtractTreasuryBreakdowns(
  total: TreasuryAssetBreakdown,
  misc: TreasuryAssetBreakdown
): TreasuryAssetBreakdown {
  return {
    USDC: {
      tokens: Math.max(0, total.USDC.tokens - misc.USDC.tokens),
      usd: Math.max(0, total.USDC.usd - misc.USDC.usd),
    },
    cbBTC: {
      tokens: Math.max(0, total.cbBTC.tokens - misc.cbBTC.tokens),
      usd: Math.max(0, total.cbBTC.usd - misc.cbBTC.usd),
    },
    WETH: {
      tokens: Math.max(0, total.WETH.tokens - misc.WETH.tokens),
      usd: Math.max(0, total.WETH.usd - misc.WETH.usd),
    },
  };
}

export function monthKeyFromTimestamp(timestampSec: number): string {
  const d = new Date(timestampSec * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export const VAULT_ASSET_MAP: Record<string, TreasuryAssetKey> = {
  '0xf7e26fa48a568b8b0038e104dfd8abdf0f99074f': 'USDC',
  '0x89712980cb434ef5ae4ab29349419eb976b0b496': 'USDC',
  '0xaecc8113a7bd0cfaf7000ea7a31affd4691ff3e9': 'cbBTC',
  '0x99dcd0d75822ba398f13b2a8852b07c7e137ec70': 'cbBTC',
  '0x21e0d366272798da3a977feba699fcb91959d120': 'WETH',
  '0xd6dcad2f7da91fbb27bda471540d9770c97a5a43': 'WETH',
};

export const VAULT_VERSION_MAP: Record<string, 'v1' | 'v2'> = {
  '0xf7e26fa48a568b8b0038e104dfd8abdf0f99074f': 'v1',
  '0x89712980cb434ef5ae4ab29349419eb976b0b496': 'v2',
  '0xaecc8113a7bd0cfaf7000ea7a31affd4691ff3e9': 'v1',
  '0x99dcd0d75822ba398f13b2a8852b07c7e137ec70': 'v2',
  '0x21e0d366272798da3a977feba699fcb91959d120': 'v1',
  '0xd6dcad2f7da91fbb27bda471540d9770c97a5a43': 'v2',
};

export const VAULT_DECIMALS: Record<TreasuryAssetKey, number> = {
  USDC: 6,
  cbBTC: 8,
  WETH: 18,
};

/** Morpho Vault V1 tx index (MetaMorpho) — not the legacy `transactions` query. */
const V1_MISC_TX_QUERY = gql`
  query TreasuryV1MiscTxs(
    $vaultAddress: String!
    $chainId: Int!
    $first: Int!
    $startTimestamp: Int!
    $cursor: VaultV1TransactionCursorInput
  ) {
    vaultV1Transactions(
      first: $first
      orderBy: Time
      orderDirection: Desc
      where: {
        vaultAddress_in: [$vaultAddress]
        chainId_in: [$chainId]
        type_in: [Deposit, Transfer]
        timestamp_gte: $startTimestamp
        cursor: $cursor
      }
    ) {
      items {
        timestamp
        type
        assets
        data {
          __typename
          ... on VaultV1DepositData {
            assets
            onBehalf
            sender
          }
          ... on VaultV1TransferData {
            from
            to
          }
        }
      }
      pageInfo {
        count
        endCursor {
          txHash
          logIndex
        }
      }
    }
  }
`;

const V2_MISC_TX_QUERY = gql`
  query TreasuryV2MiscTxs(
    $vaultAddress: String!
    $chainId: Int!
    $first: Int!
    $skip: Int!
  ) {
    vaultV2transactions(
      first: $first
      skip: $skip
      orderBy: Time
      orderDirection: Desc
      where: {
        vaultAddress_in: [$vaultAddress]
        chainId_in: [$chainId]
        type_in: [Deposit, Transfer]
      }
    ) {
      items {
        timestamp
        type
        assets
        data {
          __typename
          ... on VaultV2DepositData {
            assets
            onBehalf
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

type V1MiscTxItem = {
  timestamp?: number | string | null;
  type?: string | null;
  assets?: string | number | null;
  data?:
    | {
        __typename?: string;
        assets?: string | number | null;
        onBehalf?: string | null;
        sender?: string | null;
        from?: string | null;
        to?: string | null;
      }
    | null;
};

type V2MiscTxItem = V1MiscTxItem;

type VaultV1TransactionCursor = {
  txHash?: string | null;
  logIndex?: number | string | null;
};

type V1MiscTxResponse = {
  vaultV1Transactions?: {
    items?: Array<V1MiscTxItem | null> | null;
    pageInfo?: {
      count?: number | null;
      endCursor?: VaultV1TransactionCursor | null;
    } | null;
  } | null;
};

type V2MiscTxResponse = {
  vaultV2transactions?: {
    items?: Array<V2MiscTxItem | null> | null;
  } | null;
};

const PAGE_SIZE = 100;
const MAX_PAGES = 50;

export function parseRawAssets(value: string | number | null | undefined): bigint {
  if (value == null) return BigInt(0);
  try {
    return BigInt(typeof value === 'number' ? Math.floor(value) : value);
  } catch {
    return BigInt(0);
  }
}

/** Underlying asset amount for a vault deposit/transfer row. */
export function extractVaultMiscAssets(tx: V1MiscTxItem): bigint {
  const root = parseRawAssets(tx.assets);
  if (root > BigInt(0)) return root;
  if (tx.data?.__typename === 'VaultV1DepositData' || tx.data?.__typename === 'VaultV2DepositData') {
    return parseRawAssets(tx.data.assets);
  }
  return BigInt(0);
}

/** Capital flowing into the treasury position (deposit or share transfer in). */
export function isIncomingVaultMiscTx(tx: V1MiscTxItem, treasuryLower: string): boolean {
  if (!tx.data?.__typename) return false;

  if (tx.data.__typename === 'VaultV1DepositData' || tx.data.__typename === 'VaultV2DepositData') {
    const onBehalf = tx.data.onBehalf?.toLowerCase();
    return onBehalf === treasuryLower;
  }

  if (tx.data.__typename === 'VaultV1TransferData' || tx.data.__typename === 'VaultV2TransferData') {
    return tx.data.to?.toLowerCase() === treasuryLower;
  }

  return false;
}

function addMiscEntry(
  byMonth: Map<string, TreasuryAssetBreakdown>,
  monthKey: string,
  asset: TreasuryAssetKey,
  tokens: number,
  usd: number
) {
  if (tokens <= 0 && usd <= 0) return;
  const existing = byMonth.get(monthKey) ?? emptyTreasuryAssetBreakdown();
  existing[asset].tokens += tokens;
  existing[asset].usd += usd;
  byMonth.set(monthKey, existing);
}

function resolveMiscUsd(
  asset: TreasuryAssetKey,
  tokens: number,
  timestampSec: number,
  vaultAddressLower: string,
  pricePerTokenAt: (
    asset: TreasuryAssetKey,
    timestampSec: number,
    vaultAddressLower: string
  ) => number | null
): number {
  const price = pricePerTokenAt(asset, timestampSec, vaultAddressLower);
  if (price != null && price > 0) return tokens * price;
  if (asset === 'USDC') return tokens;
  return 0;
}

async function paginateV1MiscTxs(
  vaultAddress: string,
  chainId: number,
  startTimestampSec: number
): Promise<V1MiscTxItem[]> {
  const all: V1MiscTxItem[] = [];
  let cursor: VaultV1TransactionCursor | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const variables: {
      vaultAddress: string;
      chainId: number;
      first: number;
      startTimestamp: number;
      cursor?: VaultV1TransactionCursor;
    } = {
      vaultAddress,
      chainId,
      first: PAGE_SIZE,
      startTimestamp: startTimestampSec,
    };
    if (cursor) variables.cursor = cursor;

    const result: V1MiscTxResponse = await morphoGraphQLClient.request<V1MiscTxResponse>(
      V1_MISC_TX_QUERY,
      variables
    );

    const items = (result.vaultV1Transactions?.items ?? []).filter(
      (tx: V1MiscTxItem | null): tx is V1MiscTxItem => tx != null
    );
    if (items.length === 0) break;

    all.push(...items);

    const endCursor: VaultV1TransactionCursor | null | undefined =
      result.vaultV1Transactions?.pageInfo?.endCursor;
    if (!endCursor?.txHash || endCursor.logIndex == null || items.length < PAGE_SIZE) break;
    cursor = {
      txHash: endCursor.txHash,
      logIndex: Number(endCursor.logIndex),
    };
  }

  return all;
}

async function paginateV2MiscTxs(
  vaultAddress: string,
  chainId: number,
  startTimestampSec: number
): Promise<V1MiscTxItem[]> {
  const all: V1MiscTxItem[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const skip = page * PAGE_SIZE;
    const result = await morphoGraphQLClient.request<V2MiscTxResponse>(V2_MISC_TX_QUERY, {
      vaultAddress,
      chainId,
      first: PAGE_SIZE,
      skip,
    });

    const items = (result.vaultV2transactions?.items ?? []).filter(
      (tx): tx is V1MiscTxItem => tx != null
    );
    if (items.length === 0) break;

    all.push(...items);

    const oldestTs = items.reduce((min, tx) => {
      const ts = tx.timestamp != null ? Number(tx.timestamp) : Infinity;
      return Math.min(min, ts);
    }, Infinity);
    if (oldestTs < startTimestampSec || items.length < PAGE_SIZE) break;
  }

  return all;
}

/**
 * Capital contributions to treasury vault positions (deposits + share transfers in).
 * Excludes fee accrual — those stay in vault performance fees.
 */
export async function fetchTreasuryMiscellaneousByMonth(
  vaultAddresses: string[],
  chainId: number,
  startTimestampSec: number,
  pricePerTokenAt: (
    asset: TreasuryAssetKey,
    timestampSec: number,
    vaultAddressLower: string
  ) => number | null
): Promise<Map<string, TreasuryAssetBreakdown>> {
  const treasuryLower = getAddress(TREASURY_ADDRESS).toLowerCase();
  const byMonth = new Map<string, TreasuryAssetBreakdown>();

  for (const vaultAddress of vaultAddresses) {
    const vaultLower = vaultAddress.toLowerCase();
    const asset = VAULT_ASSET_MAP[vaultLower];
    const version = VAULT_VERSION_MAP[vaultLower];
    if (!asset || !version) continue;

    const decimals = VAULT_DECIMALS[asset];

    try {
      const items =
        version === 'v1'
          ? await paginateV1MiscTxs(vaultLower, chainId, startTimestampSec)
          : await paginateV2MiscTxs(vaultLower, chainId, startTimestampSec);

      for (const tx of items) {
        const ts = tx.timestamp != null ? Number(tx.timestamp) : 0;
        if (!ts || ts < startTimestampSec) continue;
        if (!isIncomingVaultMiscTx(tx, treasuryLower)) continue;

        const raw = extractVaultMiscAssets(tx);
        if (raw <= BigInt(0)) continue;

        const tokens = Number(raw) / Math.pow(10, decimals);
        const usd = resolveMiscUsd(asset, tokens, ts, vaultLower, pricePerTokenAt);
        addMiscEntry(byMonth, monthKeyFromTimestamp(ts), asset, tokens, usd);
      }
    } catch (error) {
      logger.warn('Failed to fetch treasury miscellaneous transactions', {
        vaultAddress: vaultLower,
        version,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return byMonth;
}
