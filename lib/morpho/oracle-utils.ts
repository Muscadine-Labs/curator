import { Address, Abi, parseAbi, zeroAddress } from 'viem';
import { publicClient, safeContractRead } from '@/lib/onchain/client';

const CHAINLINK_AGGREGATOR_ABI = parseAbi([
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
]);

const MORPHO_CHAINLINK_ORACLE_ABI = parseAbi([
  'function BASE_FEED_1() view returns (address)',
  'function BASE_FEED_2() view returns (address)',
  'function QUOTE_FEED_1() view returns (address)',
  'function QUOTE_FEED_2() view returns (address)',
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
  baseFeedOne?: { address: string } | null;
  baseFeedTwo?: { address: string } | null;
  quoteFeedOne?: { address: string } | null;
  quoteFeedTwo?: { address: string } | null;
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
  const seen = new Set<string>();
  const candidates: Address[] = [];

  const add = (addr: string | null | undefined) => {
    if (!isValidFeedAddress(addr)) return;
    const key = addr.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(addr);
  };

  add(hints?.baseFeedOne);
  add(hints?.baseFeedTwo);
  add(hints?.quoteFeedOne);
  add(hints?.quoteFeedTwo);

  const onChainReads = await Promise.all([
    safeContractRead<Address>(oracleAddress, MORPHO_CHAINLINK_ORACLE_ABI as Abi, 'BASE_FEED_1', []),
    safeContractRead<Address>(oracleAddress, MORPHO_CHAINLINK_ORACLE_ABI as Abi, 'BASE_FEED_2', []),
    safeContractRead<Address>(oracleAddress, MORPHO_CHAINLINK_ORACLE_ABI as Abi, 'QUOTE_FEED_1', []),
    safeContractRead<Address>(oracleAddress, MORPHO_CHAINLINK_ORACLE_ABI as Abi, 'QUOTE_FEED_2', []),
  ]);

  for (const addr of onChainReads) {
    add(addr);
  }

  return candidates;
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
