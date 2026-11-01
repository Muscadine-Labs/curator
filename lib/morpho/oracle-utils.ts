import { Address, parseAbi, zeroAddress } from 'viem';
import { publicClient } from '@/lib/onchain/client';
import { activeChainlinkSource, decodeMorphoOracle } from '@/lib/morpho/oracle-decode.server';

const CHAINLINK_AGGREGATOR_ABI = parseAbi([
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
]);

const ZERO = zeroAddress.toLowerCase();

export interface OracleTimestampData {
  chainlinkAddress: Address | null;
  updatedAt: number | null;
  ageSeconds: number | null;
}

export type OracleFeedHints = {
  baseFeedOne?: Address | null;
  baseFeedTwo?: Address | null;
  quoteFeedOne?: Address | null;
  quoteFeedTwo?: Address | null;
};

type OracleDataFragment = {
  baseFeedOne?: { address?: string | null } | null;
  baseFeedTwo?: { address?: string | null } | null;
  quoteFeedOne?: { address?: string | null } | null;
  quoteFeedTwo?: { address?: string | null } | null;
} | null;

export function getOracleFeedHintsFromMarket(market: {
  oracle?: { data?: OracleDataFragment } | null;
}): OracleFeedHints | undefined {
  const data = market.oracle?.data;
  if (!data) return undefined;

  return {
    baseFeedOne: data.baseFeedOne?.address as Address | undefined,
    baseFeedTwo: data.baseFeedTwo?.address as Address | undefined,
    quoteFeedOne: data.quoteFeedOne?.address as Address | undefined,
    quoteFeedTwo: data.quoteFeedTwo?.address as Address | undefined,
  };
}

function isValidFeedAddress(address: string | null | undefined): address is Address {
  return Boolean(address && address.toLowerCase() !== ZERO);
}

async function collectFeedCandidates(
  oracleAddress: Address,
  hints?: OracleFeedHints
): Promise<Address[]> {
  // Same decoder as the oracle panel: V2 feeds, or a meta oracle's
  // `currentOracle()` source. GraphQL hints are its RPC-failure fallback.
  const decoded = await decodeMorphoOracle(oracleAddress, hints);
  const active = activeChainlinkSource(decoded);
  const feeds = active?.feeds ?? (decoded.kind === 'error' ? hints : undefined);
  if (!feeds) return [];

  const seen = new Set<string>();
  const out: Address[] = [];
  for (const addr of [feeds.baseFeedOne, feeds.baseFeedTwo, feeds.quoteFeedOne, feeds.quoteFeedTwo]) {
    if (!isValidFeedAddress(addr)) continue;
    const key = addr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(addr);
  }
  return out;
}

/**
 * Freshness from feeds already read (e.g. an oracle price snapshot), so the
 * market detail route does not re-read every `latestRoundData`.
 */
export function oracleTimestampFromFeeds(
  feeds: ReadonlyArray<{ address: string; updatedAt: number | null }>,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): OracleTimestampData {
  let stalest: { address: string; updatedAt: number } | null = null;
  for (const f of feeds) {
    if (f.updatedAt == null) continue;
    if (!stalest || f.updatedAt < stalest.updatedAt) {
      stalest = { address: f.address, updatedAt: f.updatedAt };
    }
  }
  if (!stalest) {
    return {
      chainlinkAddress: (feeds[0]?.address as Address | undefined) ?? null,
      updatedAt: null,
      ageSeconds: null,
    };
  }
  return {
    chainlinkAddress: stalest.address as Address,
    updatedAt: stalest.updatedAt,
    ageSeconds: nowSeconds - stalest.updatedAt,
  };
}

async function getChainlinkTimestamp(chainlinkAddress: Address): Promise<number | null> {
  try {
    const result = await publicClient.readContract({
      address: chainlinkAddress,
      abi: CHAINLINK_AGGREGATOR_ABI,
      functionName: 'latestRoundData',
    });

    const updatedAt = Number(result[3]);
    return updatedAt > 0 ? updatedAt : null;
  } catch {
    return null;
  }
}

async function getStalestFeedTimestamp(
  feeds: Address[]
): Promise<{ chainlinkAddress: Address; updatedAt: number } | null> {
  if (feeds.length === 0) return null;

  const timestamps = await Promise.all(
    feeds.map(async (feed) => {
      const updatedAt = await getChainlinkTimestamp(feed);
      return { feed, updatedAt };
    })
  );

  let stalest: { chainlinkAddress: Address; updatedAt: number } | null = null;

  for (const { feed, updatedAt } of timestamps) {
    if (updatedAt === null) continue;
    if (!stalest || updatedAt < stalest.updatedAt) {
      stalest = { chainlinkAddress: feed, updatedAt };
    }
  }

  return stalest;
}

/**
 * Get oracle timestamp data for a Morpho oracle address.
 * Prefers GraphQL feed hints, then reads BASE_FEED_1/2 and QUOTE_FEED_1/2 immutables on-chain.
 */
export async function getOracleTimestampData(
  oracleAddress: Address | null,
  feedHints?: OracleFeedHints | Address | null
): Promise<OracleTimestampData> {
  if (!oracleAddress || oracleAddress.toLowerCase() === ZERO) {
    return { chainlinkAddress: null, updatedAt: null, ageSeconds: null };
  }

  const hints: OracleFeedHints | undefined =
    typeof feedHints === 'string' || feedHints === null
      ? feedHints
        ? { baseFeedOne: feedHints }
        : undefined
      : feedHints ?? undefined;

  const feeds = await collectFeedCandidates(oracleAddress, hints);

  if (feeds.length === 0) {
    return { chainlinkAddress: null, updatedAt: null, ageSeconds: null };
  }

  const stalest = await getStalestFeedTimestamp(feeds);

  if (!stalest) {
    return {
      chainlinkAddress: feeds[0] ?? null,
      updatedAt: null,
      ageSeconds: null,
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const ageSeconds = now - stalest.updatedAt;

  return {
    chainlinkAddress: stalest.chainlinkAddress,
    updatedAt: stalest.updatedAt,
    ageSeconds,
  };
}
