import type {
  ChainlinkFeedSnapshot,
  OracleKind,
  OracleSourceSnapshot,
} from '@/lib/morpho/oracle-price';

export type ChainlinkFeedRegistryEntry = {
  /** Directory name, e.g. "PAXG / USD". */
  name: string;
  /** Max seconds between updates. */
  heartbeatSeconds: number | null;
  /** Deviation trigger in percent (0.5 = 0.5%). */
  deviationPct: number | null;
  /** e.g. "Crypto", "Commodities", "Fiat", "Exchange rate". */
  feedType: string | null;
  /** e.g. "Price", "ExchangeRate". */
  productType: string | null;
  /** data.chain.link path slug. */
  path: string | null;
};

/** data.chain.link page for a feed (Base). */
export function chainlinkFeedPageUrl(
  entry: ChainlinkFeedRegistryEntry,
  chainId: number
): string | null {
  if (!entry.path || chainId !== 8453) return null;
  return `https://data.chain.link/feeds/base/base/${entry.path}`;
}

/** Morpho Blue liquidation incentive: LIF = min(1.15, 1 / (0.3·LLTV + 0.7)). */
const LIF_CURSOR = 0.3;
const LIF_MAX = 1.15;

/** LLTV as a fraction (0–1). Accepts WAD strings (`"770000000000000000"`) or fractions. */
export function lltvToFraction(lltv: string | number | null | undefined): number | null {
  if (lltv == null || lltv === '') return null;
  // Same convention as formatLtv: wei (> 1e6), fraction (≤ 1), else percent.
  const n = typeof lltv === 'string' ? Number(lltv) : lltv;
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n > 1_000_000) return n / 1e18;
  if (n <= 1) return n;
  return n / 100;
}

export function liquidationIncentiveFactor(lltv: string | number | null | undefined): number | null {
  const f = lltvToFraction(lltv);
  if (f == null) return null;
  return Math.min(LIF_MAX, 1 / (LIF_CURSOR * f + (1 - LIF_CURSOR)));
}

/** Liquidation penalty in percent (7.41 for a 77% LLTV market). */
export function liquidationPenaltyPct(lltv: string | number | null | undefined): number | null {
  const lif = liquidationIncentiveFactor(lltv);
  return lif == null ? null : (lif - 1) * 100;
}

/** Compact duration: 86400 → "1d", 3600 → "1h", 1200 → "20m", 45 → "45s". */
export function formatDurationShort(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds >= 86400 && seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds >= 3600 && seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds >= 86400) return `${(seconds / 86400).toFixed(1)}d`;
  if (seconds >= 3600) return `${(seconds / 3600).toFixed(1)}h`;
  if (seconds >= 60) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds)}s`;
}

/** Relative age: "12m ago", "3h ago", "2d ago". */
export function formatAgo(unixSeconds: number | null | undefined, nowSeconds: number): string {
  if (unixSeconds == null) return '—';
  const age = Math.max(0, nowSeconds - unixSeconds);
  if (age < 60) return `${Math.floor(age)}s ago`;
  if (age < 3600) return `${Math.floor(age / 60)}m ago`;
  if (age < 86400) return `${Math.floor(age / 3600)}h ago`;
  return `${Math.floor(age / 86400)}d ago`;
}

export type FeedFreshness = 'fresh' | 'late' | 'unknown';

/**
 * A Chainlink feed must update at least every heartbeat. Late = older than the
 * heartbeat plus 10% grace (block / keeper jitter). Without a known heartbeat
 * freshness is unknown — the panel still shows the age.
 */
export function feedFreshness(
  feed: Pick<ChainlinkFeedSnapshot, 'updatedAt' | 'registry'>,
  nowSeconds: number
): FeedFreshness {
  const heartbeat = feed.registry?.heartbeatSeconds ?? null;
  if (feed.updatedAt == null || heartbeat == null) return 'unknown';
  return nowSeconds - feed.updatedAt > heartbeat * 1.1 ? 'late' : 'fresh';
}

export function feedProvider(feed: Pick<ChainlinkFeedSnapshot, 'registry'>): string {
  return feed.registry ? 'Chainlink' : 'Unverified';
}

/** Price · Exchange rate · Commodity … from the Chainlink directory. */
export function feedTypeLabel(feed: Pick<ChainlinkFeedSnapshot, 'registry'>): string {
  const r = feed.registry;
  if (!r) return 'Feed';
  if (r.productType && /exchange/i.test(r.productType)) return 'Exchange rate';
  if (r.feedType && /exchange|rate/i.test(r.feedType)) return 'Exchange rate';
  return 'Price';
}

export function feedName(
  feed: Pick<ChainlinkFeedSnapshot, 'registry' | 'description'>
): string | null {
  return feed.registry?.name ?? feed.description ?? null;
}

export type OracleSide = 'collateral' | 'loan';

export type OracleConstructionRow =
  | { kind: 'feed'; side: OracleSide; feed: ChainlinkFeedSnapshot }
  | { kind: 'vault'; side: OracleSide; address: string }
  | { kind: 'fixed'; side: OracleSide };

/**
 * Rows for one source's price construction, grouped collateral (base) then
 * loan (quote). A side with no feed and no vault is a fixed 1:1 unit — the
 * oracle prices that token as exactly 1 of the other side's denomination.
 */
export function oracleConstructionRows(
  source: Pick<OracleSourceSnapshot, 'feeds' | 'baseVault' | 'quoteVault'>
): Record<OracleSide, OracleConstructionRow[]> {
  const out: Record<OracleSide, OracleConstructionRow[]> = { collateral: [], loan: [] };
  const vaults: Record<OracleSide, string | null> = {
    collateral: source.baseVault?.address ?? null,
    loan: source.quoteVault?.address ?? null,
  };
  for (const side of ['collateral', 'loan'] as const) {
    const vault = vaults[side];
    if (vault) out[side].push({ kind: 'vault', side, address: vault });
    for (const feed of source.feeds) {
      if ((feed.role.startsWith('base') ? 'collateral' : 'loan') === side) {
        out[side].push({ kind: 'feed', side, feed });
      }
    }
    if (out[side].length === 0) out[side].push({ kind: 'fixed', side });
  }
  return out;
}

export function oracleKindLabel(kind: OracleKind): string {
  switch (kind) {
    case 'chainlinkV2':
      return 'Morpho Chainlink oracle';
    case 'metaOracle':
      return 'Primary / backup oracle';
    case 'error':
      return 'Oracle read failed';
    default:
      return 'Unrecognized oracle';
  }
}

/** Distinct providers across sources, e.g. ["Chainlink"]. */
export function oracleProviders(sources: ReadonlyArray<Pick<OracleSourceSnapshot, 'feeds'>>): string[] {
  const set = new Set<string>();
  for (const s of sources) for (const f of s.feeds) set.add(feedProvider(f));
  return [...set];
}

/** "1 PAXG = 3,875.42 USDC". */
export function formatOraclePriceLine(
  loanPerCollateral: number | null | undefined,
  collateralSymbol: string,
  loanSymbol: string
): string | null {
  if (loanPerCollateral == null || !Number.isFinite(loanPerCollateral)) return null;
  const abs = Math.abs(loanPerCollateral);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : 8;
  return `1 ${collateralSymbol} = ${loanPerCollateral.toLocaleString('en-US', {
    maximumFractionDigits: digits,
  })} ${loanSymbol}`;
}

/** WAD string → percent number (1e16 = 1%). */
export function wadToPct(wad: string | null | undefined): number | null {
  if (wad == null) return null;
  const n = Number(wad);
  return Number.isFinite(n) ? n / 1e16 : null;
}

/** Signed oracle vs reference gap in percent (+ = oracle above reference). */
export function oracleDeviationPct(mismatchRatio: number | null | undefined): number | null {
  if (mismatchRatio == null || !Number.isFinite(mismatchRatio)) return null;
  return (mismatchRatio - 1) * 100;
}

const MARKET_WARNING_LABELS: Record<string, string> = {
  unrecognized_collateral_asset: 'Unrecognized collateral asset',
  unrecognized_loan_asset: 'Unrecognized loan asset',
  unrecognized_oracle: 'Unrecognized oracle',
  unrecognized_vault_curator: 'Unrecognized curator',
  bad_debt_realized: 'Realized bad debt',
  bad_debt_unrealized: 'Unrealized bad debt',
  hardcoded_oracle: 'Hardcoded oracle',
  incorrect_loan_exchange_rate: 'Incorrect loan exchange rate',
  incorrect_collateral_exchange_rate: 'Incorrect collateral exchange rate',
  oracle_not_from_factory: 'Oracle not from factory',
  misconfigured_oracle_decimals: 'Misconfigured oracle decimals',
};

export function marketWarningLabel(type: string): string {
  return (
    MARKET_WARNING_LABELS[type] ??
    type.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
  );
}
