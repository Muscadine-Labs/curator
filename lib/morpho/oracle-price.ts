import { Address, Abi, parseAbi, zeroAddress } from 'viem';
import { publicClient, safeContractRead } from '@/lib/onchain/client';
import type { OracleFeedHints } from '@/lib/morpho/oracle-utils';

export const ORACLE_PRICE_SCALE = 10n ** 36n;

const MORPHO_ORACLE_ABI = parseAbi(['function price() view returns (uint256)']);

const CHAINLINK_AGGREGATOR_ABI = parseAbi([
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() view returns (uint8)',
  'function description() view returns (string)',
  'function minAnswer() view returns (int192)',
  'function maxAnswer() view returns (int192)',
  'function aggregator() view returns (address)',
]);

const ZERO = zeroAddress.toLowerCase();

export type ChainlinkFeedRole = 'baseFeedOne' | 'baseFeedTwo' | 'quoteFeedOne' | 'quoteFeedTwo';

export type ChainlinkFeedSnapshot = {
  address: string;
  role: ChainlinkFeedRole;
  /** Chainlink aggregator description, e.g. "ETH / USD". */
  description: string | null;
  answer: string | null;
  minAnswer: string | null;
  maxAnswer: string | null;
  decimals: number | null;
  updatedAt: number | null;
  answerHuman: number | null;
  minAnswerHuman: number | null;
  maxAnswerHuman: number | null;
  atMinBound: boolean;
  atMaxBound: boolean;
};

export type OraclePriceSnapshot = {
  oracleAddress: string;
  priceRaw: string;
  /** Loan tokens per 1 collateral token (human units). */
  loanPerCollateral: number | null;
  /** Collateral USD implied by the Morpho oracle price and loan spot. */
  oracleCollateralUsd: number | null;
  /** Morpho-indexed collateral USD spot. */
  spotCollateralUsd: number | null;
  spotLoanUsd: number | null;
  /** Oracle implied / spot — >1 means oracle overstates collateral. */
  mismatchRatio: number | null;
  /** Material divergence or a feed pinned to min/max. */
  priceWarning: boolean;
  feeds: ChainlinkFeedSnapshot[];
};

function isValidFeedAddress(address: string | null | undefined): address is Address {
  return Boolean(address && address.toLowerCase() !== ZERO);
}

function toHumanPrice(raw: bigint | null, decimals: number | null): number | null {
  if (raw == null || decimals == null) return null;
  if (raw < 0n) return null;
  return Number(raw) / 10 ** decimals;
}

/** Morpho Blue oracle price → human loan tokens per 1 collateral token. */
export function loanPerCollateralFromOraclePrice(
  priceRaw: bigint,
  loanDecimals: number,
  collateralDecimals: number
): number {
  const exponent = 36 + loanDecimals - collateralDecimals;
  return Number(priceRaw) / 10 ** exponent;
}

export function collateralUsdFromOracleLoanPrice(
  loanPerCollateral: number | null,
  loanUsd: number | null
): number | null {
  if (loanPerCollateral == null || loanUsd == null || !Number.isFinite(loanUsd)) {
    return null;
  }
  return loanPerCollateral * loanUsd;
}

const FEED_ROLES: ChainlinkFeedRole[] = [
  'baseFeedOne',
  'baseFeedTwo',
  'quoteFeedOne',
  'quoteFeedTwo',
];

async function readFeedBound(
  feedAddress: Address,
  fn: 'minAnswer' | 'maxAnswer'
): Promise<bigint | null> {
  const direct = await safeContractRead<bigint>(
    feedAddress,
    CHAINLINK_AGGREGATOR_ABI as Abi,
    fn,
    []
  );
  if (direct != null) return direct;

  const aggregator = await safeContractRead<Address>(
    feedAddress,
    CHAINLINK_AGGREGATOR_ABI as Abi,
    'aggregator',
    []
  );
  if (!aggregator || aggregator.toLowerCase() === ZERO) return null;

  return safeContractRead<bigint>(aggregator, CHAINLINK_AGGREGATOR_ABI as Abi, fn, []);
}

async function readChainlinkFeedSnapshot(
  address: Address,
  role: ChainlinkFeedRole
): Promise<ChainlinkFeedSnapshot> {
  const base: ChainlinkFeedSnapshot = {
    address,
    role,
    description: null,
    answer: null,
    minAnswer: null,
    maxAnswer: null,
    decimals: null,
    updatedAt: null,
    answerHuman: null,
    minAnswerHuman: null,
    maxAnswerHuman: null,
    atMinBound: false,
    atMaxBound: false,
  };

  const decimals = await safeContractRead<number>(address, CHAINLINK_AGGREGATOR_ABI as Abi, 'decimals', []);
  base.decimals = decimals ?? null;

  const description = await safeContractRead<string>(
    address,
    CHAINLINK_AGGREGATOR_ABI as Abi,
    'description',
    []
  );
  base.description = description?.trim() ? description.trim() : null;

  try {
    const result = await publicClient.readContract({
      address,
      abi: CHAINLINK_AGGREGATOR_ABI,
      functionName: 'latestRoundData',
    });
    const answer = result[1];
    const updatedAt = Number(result[3]);
    base.answer = answer.toString();
    base.updatedAt = updatedAt > 0 ? updatedAt : null;
    base.answerHuman = toHumanPrice(answer, base.decimals);

    const [minAnswer, maxAnswer] = await Promise.all([
      readFeedBound(address, 'minAnswer'),
      readFeedBound(address, 'maxAnswer'),
    ]);

    if (minAnswer != null) {
      base.minAnswer = minAnswer.toString();
      base.minAnswerHuman = toHumanPrice(minAnswer, base.decimals);
      if (answer === minAnswer) base.atMinBound = true;
    }
    if (maxAnswer != null) {
      base.maxAnswer = maxAnswer.toString();
      base.maxAnswerHuman = toHumanPrice(maxAnswer, base.decimals);
      if (answer === maxAnswer) base.atMaxBound = true;
    }
  } catch {
    // Feed may not expose min/max or latestRoundData
  }

  return base;
}

async function collectFeedSnapshots(hints?: OracleFeedHints): Promise<ChainlinkFeedSnapshot[]> {
  if (!hints) return [];

  const snapshots = await Promise.all(
    FEED_ROLES.map(async (role) => {
      const addr = hints[role];
      if (!isValidFeedAddress(addr)) return null;
      return readChainlinkFeedSnapshot(addr, role);
    })
  );

  return snapshots.filter((s): s is ChainlinkFeedSnapshot => s != null);
}

export async function getMorphoOraclePriceRaw(
  oracleAddress: Address | null
): Promise<bigint | null> {
  if (!oracleAddress || oracleAddress.toLowerCase() === ZERO) return null;
  return safeContractRead<bigint>(
    oracleAddress,
    MORPHO_ORACLE_ABI as Abi,
    'price',
    []
  );
}

export async function getOraclePriceSnapshot(input: {
  oracleAddress: string | null;
  feedHints?: OracleFeedHints;
  loanDecimals: number;
  collateralDecimals: number;
  spotCollateralUsd?: number | null;
  spotLoanUsd?: number | null;
  /** Relative spot/oracle gap that triggers priceWarning (default 5%). */
  mismatchThreshold?: number;
}): Promise<OraclePriceSnapshot | null> {
  const oracleAddr = input.oracleAddress as Address | null;
  const priceRaw = await getMorphoOraclePriceRaw(oracleAddr);
  if (!oracleAddr || priceRaw == null) return null;

  const loanPerCollateral = loanPerCollateralFromOraclePrice(
    priceRaw,
    input.loanDecimals,
    input.collateralDecimals
  );
  const oracleCollateralUsd = collateralUsdFromOracleLoanPrice(
    loanPerCollateral,
    input.spotLoanUsd ?? null
  );
  const spotCollateralUsd = input.spotCollateralUsd ?? null;

  let mismatchRatio: number | null = null;
  if (
    oracleCollateralUsd != null &&
    spotCollateralUsd != null &&
    spotCollateralUsd > 0 &&
    Number.isFinite(oracleCollateralUsd)
  ) {
    mismatchRatio = oracleCollateralUsd / spotCollateralUsd;
  }

  const feeds = await collectFeedSnapshots(input.feedHints);
  const hasBoundCappedFeed = feeds.some((f) => f.atMinBound || f.atMaxBound);
  const threshold = input.mismatchThreshold ?? 0.05;
  const materialMismatch =
    mismatchRatio != null &&
    (mismatchRatio > 1 + threshold || mismatchRatio < 1 - threshold);

  return {
    oracleAddress: oracleAddr,
    priceRaw: priceRaw.toString(),
    loanPerCollateral,
    oracleCollateralUsd,
    spotCollateralUsd,
    spotLoanUsd: input.spotLoanUsd ?? null,
    mismatchRatio,
    priceWarning: hasBoundCappedFeed || materialMismatch,
    feeds,
  };
}
