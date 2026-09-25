/**
 * Treasury income from Morpho GraphQL daily share-balance history (no RPC / ABI).
 *
 * Income = positive day-over-day **share** change (fee mints + inbound share
 * transfers), valued at that day's USD per share. Self-deposits (GraphQL Deposit
 * where sender is the treasury) are subtracted only up to income already booked
 * for that vault on the same UTC day. Opening deposits — including
 * redeem-underlying → deposit-wrapper migrations — are not income and are not
 * subtracted. Yield and price moves on a constant share balance are not income.
 * Outflows are not subtracted.
 */
import { getVaultByAddress } from '@/lib/config/vaults';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { API_CACHE_MAX_AGE_MS } from '@/lib/api/response-cache';
import { withServerResponseCache } from '@/lib/api/server-response-cache';
import { morphoGraphQLClient } from '@/lib/morpho/graphql-client';
import {
  STATEMENT_START_DATE,
  TREASURY_ADDRESS,
  emptyTreasuryAssetBreakdown,
  sumTreasuryBreakdownUsd,
  treasuryAssetKeyForVault,
  type TreasuryAssetBreakdown,
  type TreasuryAssetKey,
} from '@/lib/morpho/treasury-statement';
import {
  creditIncomeBucket,
  takeMatchedIncome,
} from '@/lib/morpho/treasury-self-deposit';
import { fetchTreasuryVaultTransfers } from '@/lib/morpho/treasury-transfers';
import { resolveAssetDecimals } from '@/lib/format/asset-decimals';
import { bigintRatio } from '@/lib/format/bigint-ratio';
import {
  utcDayKeyFromTimestamp,
  utcMonthKeyFromTimestamp,
  utcMonthsFrom,
  fromFirstNonZeroPeriod,
} from '@/lib/utils/utc-calendar';
import { gql } from 'graphql-request';
import { formatUnits, getAddress, isAddress } from 'viem';
import { logger } from '@/lib/utils/logger';

export interface MonthlyStatementData {
  month: string;
  assets: TreasuryAssetBreakdown;
  total: {
    tokens: number;
    usd: number;
  };
  isComplete: boolean;
}

export interface VaultMonthlyData {
  vaultAddress: string;
  asset: 'USDC' | 'cbBTC' | 'WETH';
  month: string;
  tokens: number;
  usd: number;
}

export interface TreasuryStatementResult {
  statements: MonthlyStatementData[];
  daily: Array<{ date: string; value: number }>;
  vaults: VaultMonthlyData[];
  /**
   * Set when treasury self-deposits could not be fully loaded. Those deposits
   * are then not subtracted, so revenue is overstated; the result is not cached.
   */
  warning: string | null;
}

type TimeseriesPoint = { x?: number | null; y?: number | string | null };

type GqlVault = {
  address?: string | null;
  name?: string | null;
  asset?: {
    address?: string | null;
    symbol?: string | null;
    decimals?: number | null;
  } | null;
};

type GqlHistory = {
  shares?: TimeseriesPoint[] | null;
  assets?: TimeseriesPoint[] | null;
  assetsUsd?: TimeseriesPoint[] | null;
};

const TREASURY_HISTORY_QUERY = gql`
  query TreasuryPositionHistory(
    $userAddress: String!
    $chainId: Int!
    $options: TimeseriesOptions
  ) {
    userByAddress(address: $userAddress, chainId: $chainId) {
      vaultPositions {
        vault {
          address
          name
          asset {
            address
            symbol
            decimals
          }
        }
        historicalState {
          shares(options: $options) {
            x
            y
          }
          assets(options: $options) {
            x
            y
          }
          assetsUsd(options: $options) {
            x
            y
          }
        }
      }
      vaultV2Positions {
        vault {
          address
          name
          asset {
            address
            symbol
            decimals
          }
        }
        history {
          shares(options: $options) {
            x
            y
          }
          assets(options: $options) {
            x
            y
          }
          assetsUsd(options: $options) {
            x
            y
          }
        }
      }
    }
  }
`;

function yToFloat(y: number | string | null | undefined): number | null {
  if (y == null) return null;
  if (typeof y === 'number') return Number.isFinite(y) ? y : null;
  const n = Number(y);
  return Number.isFinite(n) ? n : null;
}

function parseRaw(y: number | string | null | undefined): bigint | null {
  if (y == null) return null;
  try {
    if (typeof y === 'string') {
      const s = y.trim();
      if (/^-?\d+$/.test(s)) return BigInt(s);
    }
    if (typeof y === 'number' && Number.isSafeInteger(y)) {
      return BigInt(y);
    }
    return null;
  } catch {
    return null;
  }
}

function humanFromRaw(raw: bigint, decimals: number): number {
  try {
    return Number(formatUnits(raw, decimals));
  } catch {
    return 0;
  }
}

type DayPoint = {
  x: number;
  shares: bigint;
  tokens: number;
  usd: number | null;
};

function mergeDailySeries(
  shares: TimeseriesPoint[] | null | undefined,
  assets: TimeseriesPoint[] | null | undefined,
  assetsUsd: TimeseriesPoint[] | null | undefined,
  decimals: number
): DayPoint[] {
  const assetsByX = new Map<number, bigint>();
  for (const p of assets ?? []) {
    if (p.x == null) continue;
    const raw = parseRaw(p.y);
    if (raw == null) continue;
    assetsByX.set(p.x, raw);
  }
  const usdByX = new Map<number, number>();
  for (const p of assetsUsd ?? []) {
    if (p.x == null) continue;
    const usd = yToFloat(p.y);
    if (usd == null) continue;
    usdByX.set(p.x, usd);
  }

  const points: DayPoint[] = [];
  for (const p of shares ?? []) {
    if (p.x == null) continue;
    const shareRaw = parseRaw(p.y);
    if (shareRaw == null) continue;
    const assetRaw = assetsByX.get(p.x);
    points.push({
      x: p.x,
      shares: shareRaw,
      tokens: assetRaw != null ? humanFromRaw(assetRaw, decimals) : 0,
      usd: usdByX.get(p.x) ?? null,
    });
  }
  points.sort((a, b) => a.x - b.x);
  return points;
}

type PositionIncome = {
  vaultAddress: string;
  asset: TreasuryAssetKey;
  timestamp: number;
  tokens: number;
  usd: number;
};

function incomesFromHistory(
  points: DayPoint[],
  vaultAddress: string,
  asset: TreasuryAssetKey
): PositionIncome[] {
  const out: PositionIncome[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const deltaShares = cur.shares - prev.shares;
    if (deltaShares <= 0n || cur.shares <= 0n) continue;

    const weight = bigintRatio(deltaShares, cur.shares);
    if (!(weight > 0)) continue;
    const tokens = weight * cur.tokens;
    const usd = cur.usd != null && cur.usd > 0 ? weight * cur.usd : 0;
    if (tokens <= 0 && usd <= 0) continue;

    out.push({
      vaultAddress,
      asset,
      timestamp: cur.x,
      tokens,
      usd,
    });
  }
  return out;
}

function includeVault(address: string): boolean {
  const cfg = getVaultByAddress(address);
  return !cfg?.excludeFromBusinessViews;
}

type FetchedPosition = {
  vault: GqlVault;
  history: GqlHistory | null;
};

async function fetchTreasuryPositionHistories(): Promise<FetchedPosition[]> {
  const treasuryAddr = getAddress(TREASURY_ADDRESS);
  const startTimestamp = Math.floor(STATEMENT_START_DATE.getTime() / 1000);
  const endTimestamp = Math.floor(Date.now() / 1000);

  const data = await morphoGraphQLClient.request<{
    userByAddress?: {
      vaultPositions?: Array<{
        vault?: GqlVault | null;
        historicalState?: GqlHistory | null;
      } | null> | null;
      vaultV2Positions?: Array<{
        vault?: GqlVault | null;
        history?: GqlHistory | null;
      } | null> | null;
    } | null;
  }>(TREASURY_HISTORY_QUERY, {
    userAddress: treasuryAddr,
    chainId: BASE_CHAIN_ID,
    options: {
      startTimestamp,
      endTimestamp,
      interval: 'DAY',
    },
  });

  const user = data.userByAddress;
  const byAddress = new Map<string, FetchedPosition>();

  for (const row of user?.vaultPositions ?? []) {
    const vault = row?.vault;
    const address = vault?.address;
    if (!address || !isAddress(address)) continue;
    byAddress.set(address.toLowerCase(), {
      vault,
      history: row?.historicalState ?? null,
    });
  }

  for (const row of user?.vaultV2Positions ?? []) {
    const vault = row?.vault;
    const address = vault?.address;
    if (!address || !isAddress(address)) continue;
    byAddress.set(address.toLowerCase(), {
      vault,
      history: row?.history ?? null,
    });
  }

  return Array.from(byAddress.values());
}

function addIncome(
  monthlyStatements: Map<string, TreasuryAssetBreakdown>,
  vaultMonthlyMap: Map<string, VaultMonthlyData>,
  dailyMap: Map<string, number>,
  inflow: PositionIncome
): void {
  const month = utcMonthKeyFromTimestamp(inflow.timestamp);
  const statement = monthlyStatements.get(month);
  if (statement) {
    statement[inflow.asset].tokens += inflow.tokens;
    statement[inflow.asset].usd += inflow.usd;
  }

  const vaultKey = `${inflow.vaultAddress}|${month}`;
  const existing = vaultMonthlyMap.get(vaultKey);
  if (existing) {
    existing.tokens += inflow.tokens;
    existing.usd += inflow.usd;
  } else {
    vaultMonthlyMap.set(vaultKey, {
      vaultAddress: inflow.vaultAddress,
      asset: inflow.asset,
      month,
      tokens: inflow.tokens,
      usd: inflow.usd,
    });
  }

  const day = utcDayKeyFromTimestamp(inflow.timestamp);
  dailyMap.set(day, (dailyMap.get(day) ?? 0) + inflow.usd);
}

function subtractIncome(
  monthlyStatements: Map<string, TreasuryAssetBreakdown>,
  vaultMonthlyMap: Map<string, VaultMonthlyData>,
  dailyMap: Map<string, number>,
  inflow: PositionIncome
): void {
  addIncome(monthlyStatements, vaultMonthlyMap, dailyMap, {
    ...inflow,
    tokens: -inflow.tokens,
    usd: -inflow.usd,
  });
}

async function computeTreasuryStatementUncached(): Promise<TreasuryStatementResult> {
  const allMonths = utcMonthsFrom(STATEMENT_START_DATE);
  const [positions, transferFetch] = await Promise.all([
    fetchTreasuryPositionHistories(),
    fetchTreasuryVaultTransfers(),
  ]);

  const monthlyStatements = new Map<string, TreasuryAssetBreakdown>();
  for (const month of allMonths) {
    monthlyStatements.set(month.key, emptyTreasuryAssetBreakdown());
  }

  const vaultMonthlyMap = new Map<string, VaultMonthlyData>();
  const dailyMap = new Map<string, number>();
  const priceByVaultDay = new Map<string, number>();
  const remainingIncome = new Map<string, { tokens: number; usd: number }>();
  let positionCount = 0;
  let inflowCount = 0;

  for (const position of positions) {
    const addressRaw = position.vault.address;
    if (!addressRaw || !isAddress(addressRaw)) continue;
    if (!includeVault(addressRaw)) continue;

    const vaultAddress = getAddress(addressRaw).toLowerCase();
    const symbol = position.vault.asset?.symbol ?? null;
    const asset = treasuryAssetKeyForVault(vaultAddress, symbol);
    if (!asset) continue;

    const decimals = resolveAssetDecimals(symbol, position.vault.asset?.decimals ?? null);
    const points = mergeDailySeries(
      position.history?.shares,
      position.history?.assets,
      position.history?.assetsUsd,
      decimals
    );
    for (const p of points) {
      if (p.tokens > 0 && p.usd != null && p.usd > 0) {
        priceByVaultDay.set(`${vaultAddress}|${utcDayKeyFromTimestamp(p.x)}`, p.usd / p.tokens);
      }
    }

    const inflows = incomesFromHistory(points, vaultAddress, asset);
    if (inflows.length === 0) continue;
    positionCount += 1;
    inflowCount += inflows.length;
    for (const inflow of inflows) {
      addIncome(monthlyStatements, vaultMonthlyMap, dailyMap, inflow);
      creditIncomeBucket(
        remainingIncome,
        inflow.vaultAddress,
        utcDayKeyFromTimestamp(inflow.timestamp),
        { tokens: inflow.tokens, usd: inflow.usd }
      );
    }
  }

  let depositCount = 0;
  let unmatchedSelfDeposits = 0;
  const selfDeposits = transferFetch.transfers
    .filter((dep) => dep.isSelfDeposit && dep.asset && includeVault(dep.vaultAddress))
    .sort((a, b) => a.timestamp - b.timestamp);
  for (const dep of selfDeposits) {
    const asset = dep.asset;
    if (!asset) continue;
    const vaultAddress = dep.vaultAddress.toLowerCase();
    const decimals = dep.assetDecimals;
    let tokens = 0;
    if (dep.assetsRaw) {
      try {
        tokens = humanFromRaw(BigInt(dep.assetsRaw), decimals);
      } catch {
        tokens = 0;
      }
    }
    if (!(tokens > 0)) continue;
    const day = utcDayKeyFromTimestamp(dep.timestamp);
    const price =
      priceByVaultDay.get(`${vaultAddress}|${day}`) ?? (asset === 'USDC' ? 1 : null);
    const usd = price != null ? tokens * price : 0;
    const matched = takeMatchedIncome(remainingIncome, vaultAddress, day, {
      tokens,
      usd,
    });
    if (!matched) {
      unmatchedSelfDeposits += 1;
      continue;
    }
    subtractIncome(monthlyStatements, vaultMonthlyMap, dailyMap, {
      vaultAddress,
      asset,
      timestamp: dep.timestamp,
      tokens: matched.tokens,
      usd: matched.usd,
    });
    depositCount += 1;
  }

  const daily: Array<{ date: string; value: number }> = [];
  const start = new Date(STATEMENT_START_DATE);
  start.setUTCHours(0, 0, 0, 0);
  const now = new Date();
  const todayUTC = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0)
  );
  const d = new Date(start);
  d.setUTCHours(0, 0, 0, 0);
  while (d <= todayUTC) {
    const date = d.toISOString().slice(0, 10);
    daily.push({ date, value: dailyMap.get(date) ?? 0 });
    d.setUTCDate(d.getUTCDate() + 1);
  }

  const nowMs = Date.now();
  const mapped: MonthlyStatementData[] = Array.from(monthlyStatements.entries())
    .map(([month, assets]) => {
      const [year, monthNum] = month.split('-').map(Number);
      const lastDayMs = Date.UTC(year, monthNum, 0, 23, 59, 59, 999);
      const isComplete = nowMs > lastDayMs;
      const totalTokens = assets.USDC.tokens + assets.cbBTC.tokens + assets.WETH.tokens;
      const totalUsd = sumTreasuryBreakdownUsd(assets);
      return {
        month,
        assets,
        total: { tokens: totalTokens, usd: totalUsd },
        isComplete,
      };
    })
    .sort((a, b) => a.month.localeCompare(b.month));

  const statements = fromFirstNonZeroPeriod(
    mapped,
    (s) => s.total.tokens !== 0 || s.total.usd !== 0
  );

  logger.info('Monthly statement from GraphQL daily share change', {
    positions: positionCount,
    inflowDays: inflowCount,
    selfDepositsExcluded: depositCount,
    unmatchedSelfDeposits,
    transferError: transferFetch.error,
    monthsWithData: statements.length,
  });

  const warning = transferFetch.error
    ? 'Treasury self-deposits could not be loaded, so they are not subtracted — revenue may be overstated. Retry shortly.'
    : transferFetch.truncated
      ? 'Treasury transfer history was cut off at the page limit, so older self-deposits may not be subtracted — revenue may be overstated.'
      : null;

  return {
    statements,
    daily,
    vaults: Array.from(vaultMonthlyMap.values()),
    warning,
  };
}

export function computeTreasuryStatement(): Promise<TreasuryStatementResult> {
  return withServerResponseCache(
    'treasury-statement-daily-shares-v4',
    API_CACHE_MAX_AGE_MS,
    computeTreasuryStatementUncached,
    (result) => result.warning == null
  );
}
