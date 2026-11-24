import { Address, parseAbi, zeroAddress } from 'viem';
import { publicClient } from '@/lib/onchain/client';
import type { OracleFeedHints } from '@/lib/morpho/oracle-utils';
import { logger } from '@/lib/utils/logger';

/**
 * On-chain oracle decoding. Morpho GraphQL only types MorphoChainlinkOracle(V2);
 * everything else (e.g. the primary/backup MetaOracleDeviationTimelock proxies)
 * comes back as `type: Unknown` with `data: null`. We read the contract
 * directly so the oracle panel and freshness scoring see the real feeds.
 */

const CHAINLINK_V2_ABI = parseAbi([
  'function BASE_FEED_1() view returns (address)',
  'function BASE_FEED_2() view returns (address)',
  'function QUOTE_FEED_1() view returns (address)',
  'function QUOTE_FEED_2() view returns (address)',
  'function BASE_VAULT() view returns (address)',
  'function QUOTE_VAULT() view returns (address)',
  'function BASE_VAULT_CONVERSION_SAMPLE() view returns (uint256)',
  'function QUOTE_VAULT_CONVERSION_SAMPLE() view returns (uint256)',
  'function price() view returns (uint256)',
]);

const META_ORACLE_ABI = parseAbi([
  'function primaryOracle() view returns (address)',
  'function backupOracle() view returns (address)',
  'function currentOracle() view returns (address)',
  'function deviationThreshold() view returns (uint256)',
  'function getDeviation() view returns (uint256)',
  'function isChallenged() view returns (bool)',
  'function isHealing() view returns (bool)',
  'function challengeExpiresAt() view returns (uint256)',
  'function healingExpiresAt() view returns (uint256)',
  'function challengeTimelockDuration() view returns (uint256)',
  'function healingTimelockDuration() view returns (uint256)',
]);

const ZERO = zeroAddress.toLowerCase();

export type OracleVaultRef = {
  address: string;
  /** Raw conversion sample (shares) passed to `convertToAssets`. */
  conversionSample: string | null;
};

/** One MorphoChainlinkOracle(V2)-shaped price source. */
export type DecodedChainlinkSource = {
  address: string;
  feeds: OracleFeedHints;
  baseVault: OracleVaultRef | null;
  quoteVault: OracleVaultRef | null;
  /** Raw Morpho `price()` of this source (36-decimal scaled). */
  priceRaw: string | null;
};

/** State of a primary/backup oracle with a deviation challenge timelock. */
export type MetaOracleState = {
  primaryOracle: string;
  backupOracle: string;
  currentOracle: string | null;
  /** WAD (1e18 = 100%). */
  deviationThreshold: string | null;
  /** WAD (1e18 = 100%) — current primary/backup price gap. */
  deviation: string | null;
  isChallenged: boolean | null;
  isHealing: boolean | null;
  challengeExpiresAt: number | null;
  healingExpiresAt: number | null;
  challengeTimelockDuration: number | null;
  healingTimelockDuration: number | null;
};

export type DecodedOracle =
  | { kind: 'chainlinkV2'; source: DecodedChainlinkSource }
  | {
      kind: 'metaOracle';
      meta: MetaOracleState;
      primary: DecodedChainlinkSource | null;
      backup: DecodedChainlinkSource | null;
    }
  | { kind: 'unknown' }
  /** The RPC read failed and GraphQL had no feed hints — the type is not known. */
  | { kind: 'error' };

function addressOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.toLowerCase() === ZERO ? null : value;
}

function bigintOrNull(value: unknown): bigint | null {
  return typeof value === 'bigint' ? value : null;
}

function numberOrNull(value: unknown): number | null {
  const b = bigintOrNull(value);
  if (b == null || b === 0n) return null;
  return Number(b);
}

function hasAnyFeed(hints: OracleFeedHints | undefined): boolean {
  if (!hints) return false;
  return [hints.baseFeedOne, hints.baseFeedTwo, hints.quoteFeedOne, hints.quoteFeedTwo].some(
    (a) => addressOrNull(a) != null
  );
}

type Outcome = { status: 'success'; result: unknown } | { status: 'failure'; error: Error };

/**
 * Reads the MorphoChainlinkOracleV2 immutables in one multicall. Returns
 * `null` when the contract does not expose `BASE_FEED_1` (not that shape),
 * and throws on RPC failure so the caller can fall back to hints.
 */
async function readChainlinkSource(address: Address): Promise<DecodedChainlinkSource | null> {
  const fns = [
    'BASE_FEED_1',
    'BASE_FEED_2',
    'QUOTE_FEED_1',
    'QUOTE_FEED_2',
    'BASE_VAULT',
    'QUOTE_VAULT',
    'BASE_VAULT_CONVERSION_SAMPLE',
    'QUOTE_VAULT_CONVERSION_SAMPLE',
    'price',
  ] as const;
  const results = (await publicClient.multicall({
    allowFailure: true,
    contracts: fns.map((functionName) => ({
      address,
      abi: CHAINLINK_V2_ABI,
      functionName,
    })),
  })) as Outcome[];

  const value = (i: number) => (results[i]?.status === 'success' ? results[i].result : null);
  if (results[0]?.status !== 'success') return null;

  const baseVault = addressOrNull(value(4));
  const quoteVault = addressOrNull(value(5));
  const price = bigintOrNull(value(8));

  return {
    address,
    feeds: {
      baseFeedOne: addressOrNull(value(0)) as Address | null,
      baseFeedTwo: addressOrNull(value(1)) as Address | null,
      quoteFeedOne: addressOrNull(value(2)) as Address | null,
      quoteFeedTwo: addressOrNull(value(3)) as Address | null,
    },
    baseVault: baseVault
      ? { address: baseVault, conversionSample: bigintOrNull(value(6))?.toString() ?? null }
      : null,
    quoteVault: quoteVault
      ? { address: quoteVault, conversionSample: bigintOrNull(value(7))?.toString() ?? null }
      : null,
    priceRaw: price != null ? price.toString() : null,
  };
}

async function readMetaOracle(address: Address): Promise<MetaOracleState | null> {
  const fns = [
    'primaryOracle',
    'backupOracle',
    'currentOracle',
    'deviationThreshold',
    'getDeviation',
    'isChallenged',
    'isHealing',
    'challengeExpiresAt',
    'healingExpiresAt',
    'challengeTimelockDuration',
    'healingTimelockDuration',
  ] as const;
  const results = (await publicClient.multicall({
    allowFailure: true,
    contracts: fns.map((functionName) => ({
      address,
      abi: META_ORACLE_ABI,
      functionName,
    })),
  })) as Outcome[];

  const value = (i: number) => (results[i]?.status === 'success' ? results[i].result : null);
  const primaryOracle = addressOrNull(value(0));
  const backupOracle = addressOrNull(value(1));
  if (!primaryOracle || !backupOracle) return null;

  const bool = (i: number) => {
    const v = value(i);
    return typeof v === 'boolean' ? v : null;
  };

  return {
    primaryOracle,
    backupOracle,
    currentOracle: addressOrNull(value(2)),
    deviationThreshold: bigintOrNull(value(3))?.toString() ?? null,
    deviation: bigintOrNull(value(4))?.toString() ?? null,
    isChallenged: bool(5),
    isHealing: bool(6),
    challengeExpiresAt: numberOrNull(value(7)),
    healingExpiresAt: numberOrNull(value(8)),
    challengeTimelockDuration: numberOrNull(value(9)),
    healingTimelockDuration: numberOrNull(value(10)),
  };
}

function sourceFromHints(address: string, hints: OracleFeedHints): DecodedChainlinkSource {
  return { address, feeds: hints, baseVault: null, quoteVault: null, priceRaw: null };
}

/**
 * Decode a Morpho Blue oracle. Tries MorphoChainlinkOracleV2 first, then the
 * primary/backup meta oracle (whose two sources are each decoded as V2).
 * GraphQL `hints` are used when the RPC read fails.
 */
export async function decodeMorphoOracle(
  oracleAddress: string | null,
  hints?: OracleFeedHints
): Promise<DecodedOracle> {
  if (!oracleAddress || oracleAddress.toLowerCase() === ZERO) return { kind: 'unknown' };
  const address = oracleAddress as Address;

  let rpcFailed = false;
  try {
    const direct = await readChainlinkSource(address);
    if (direct) return { kind: 'chainlinkV2', source: direct };

    const meta = await readMetaOracle(address);
    if (meta) {
      const [primary, backup] = await Promise.all([
        readChainlinkSource(meta.primaryOracle as Address).catch(() => null),
        readChainlinkSource(meta.backupOracle as Address).catch(() => null),
      ]);
      return { kind: 'metaOracle', meta, primary, backup };
    }
  } catch (error) {
    rpcFailed = true;
    logger.warn('Oracle decode failed', {
      oracleAddress,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (hasAnyFeed(hints)) {
    return { kind: 'chainlinkV2', source: sourceFromHints(oracleAddress, hints!) };
  }
  return rpcFailed ? { kind: 'error' } : { kind: 'unknown' };
}

/**
 * The source that currently prices the market: the V2 oracle itself, or the
 * meta oracle's `currentOracle()` (falls back to primary when unreadable).
 */
export function activeChainlinkSource(decoded: DecodedOracle): DecodedChainlinkSource | null {
  if (decoded.kind === 'chainlinkV2') return decoded.source;
  if (decoded.kind !== 'metaOracle') return null;
  return metaActiveSource(decoded.meta, decoded.primary, decoded.backup);
}

/**
 * Which decoded source matches `currentOracle()`. Returns null when
 * `currentOracle()` was unreadable or its source failed to decode — never
 * substitute the other one,
 * or a switch to backup would read as "primary active".
 */
function metaActiveSource<T extends { address: string }>(
  meta: MetaOracleState,
  primary: T | null,
  backup: T | null
): T | null {
  // An unreadable currentOracle() means we do not know which source prices
  // the market; assuming primary would hide a switch to backup.
  const current = meta.currentOracle?.toLowerCase();
  if (!current) return null;
  if (primary && primary.address.toLowerCase() === current) return primary;
  if (backup && backup.address.toLowerCase() === current) return backup;
  return null;
}

/** True when the meta oracle is pricing from its backup source. */
export function isMetaOnBackup(meta: MetaOracleState): boolean {
  return (
    meta.currentOracle != null &&
    meta.currentOracle.toLowerCase() === meta.backupOracle.toLowerCase()
  );
}
