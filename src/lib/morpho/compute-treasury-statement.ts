/**
 * Treasury income from Morpho GraphQL daily share-balance history (no RPC / ABI).
 *
 * Income = positive day-over-day **share** change, valued at that day's USD per
 * share. Fee mints stay. Capital inflows are subtracted only up to income
 * already booked for that vault on the same UTC day: deposits on behalf of the
 * treasury, and inbound share transfers from a non-zero address. A transfer
 * from address(0) is a fee mint, not capital. Opening deposits — including
 * redeem-underlying → deposit-wrapper migrations — are not income and are not
 * subtracted. Yield and price moves on a constant share balance are not income.
 * Outflows are not subtracted.
 */
import { getVaultByAddress } from '@/lib/config/vaults';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { API_CACHE_MAX_AGE_MS } from '@/lib/api/response-cache';
import { withServerResponseCache } from '@/lib/api/server-response-cache';
import { morphoRestGet, morphoRestList, morphoSelector } from '@/lib/morpho/rest-client';
import { fetchDailyPricesUsd, priceOnDay } from '@/lib/defillama/historical-prices';
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
import {
  capitalInflowTokens,
  fetchTreasuryVaultTransfers,
  isPrincipalCapitalInflow,
} from '@/lib/morpho/treasury-transfers';
import { resolveAssetDecimals } from '@/lib/format/asset-decimals';
import { bigintRatio } from '@/lib/format/bigint-ratio';
import {
  utcDayClosedBySnapshot,
  utcDayKeyFromTimestamp,
  utcMonthKeyFromTimestamp,
  utcMonthsFrom,
  fromFirstNonZeroPeriod,
} from '@/lib/utils/utc-calendar';
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
   * Set when treasury capital inflows could not be fully loaded. Deposits and
   * inbound transfers are then not subtracted, so revenue is overstated; the
   * result is not cached.
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

export type DayPoint = {
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

  const raw: Array<Omit<DayPoint, 'tokens'> & { tokens: number | null }> = [];
  for (const p of shares ?? []) {
    if (p.x == null) continue;
    const shareRaw = parseRaw(p.y);
    if (shareRaw == null) continue;
    const assetRaw = assetsByX.get(p.x);
    raw.push({
      x: p.x,
      shares: shareRaw,
      tokens: assetRaw != null ? humanFromRaw(assetRaw, decimals) : null,
      usd: usdByX.get(p.x) ?? null,
    });
  }
  raw.sort((a, b) => a.x - b.x);
  return fillMissingTokens(raw);
}

/**
 * A day Morpho returned shares for but no `assets` sample: value its shares at
 * the nearest day's assets-per-share (earlier first, else later). Leaving it at
 * 0 booked that day's fee mint in USD with 0 tokens and dropped its price.
 */
export function fillMissingTokens(
  points: ReadonlyArray<Omit<DayPoint, 'tokens'> & { tokens: number | null }>
): DayPoint[] {
  const perShare = (p: { shares: bigint; tokens: number | null }): number | null =>
    p.tokens != null && p.shares > 0n ? p.tokens / Number(p.shares) : null;
  const filled: DayPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (p.tokens != null) {
      filled.push({ ...p, tokens: p.tokens });
      continue;
    }
    let rate: number | null = null;
    for (let j = i - 1; j >= 0 && rate == null; j--) rate = perShare(points[j]!);
    for (let j = i + 1; j < points.length && rate == null; j++) rate = perShare(points[j]!);
    filled.push({ ...p, tokens: rate != null ? rate * Number(p.shares) : 0 });
  }
  return filled;
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
      // The share change happened during the day this point closes, where deposits are dated.
      timestamp: cur.x - 1,
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

type RestUserPosition = { vault_address?: string | null };
type RestHistoryPoint = { timestamp: number; shares?: string | null; assets?: string | null };

/**
 * The treasury's daily share and asset history in every vault it ever held (V1 and V2), from
 * Morpho REST (`/users/{u}/positions` + `/position/history?lookback=inception`). REST points
 * are 00:00 UTC balances like GraphQL's DAY buckets; the trailing off-grid "now" point is
 * dropped so a partial day is never booked. USD = tokens × that day's DefiLlama price (REST
 * has no `assetsUsd`); a day with no price is left out of USD, not valued at 0.
 */
async function fetchTreasuryPositionHistories(): Promise<FetchedPosition[]> {
  const treasury = getAddress(TREASURY_ADDRESS);
  const startTimestamp = Math.floor(STATEMENT_START_DATE.getTime() / 1000);
  const loadVersion = async (version: 'v1' | 'v2'): Promise<FetchedPosition[]> => {
    const rows = await morphoRestList<RestUserPosition>(
      `/v0/vaults-${version}/users/${treasury}/positions`,
      { chain_ids: BASE_CHAIN_ID, active_only: false },
      { revalidate: 0 }
    );
    return Promise.all(
      rows
        .map((r) => r.vault_address)
        .filter((a): a is string => !!a && isAddress(a))
        .map(async (address) => {
          const selector = morphoSelector(BASE_CHAIN_ID, address);
          const [vault, points] = await Promise.all([
            morphoRestGet<{ name?: string | null; asset?: { address: string; symbol: string | null; decimals: number } }>(
              `/v0/vaults-${version}/${selector}`
            ),
            morphoRestGet<RestHistoryPoint[]>(`/v0/vaults-${version}/${selector}/users/${treasury}/position/history`, {
              lookback: 'inception',
            }, { revalidate: 0 }),
          ]);
          const daily = (points ?? [])
            .filter((p) => Number.isFinite(p.timestamp) && p.timestamp % 86_400 === 0 && p.timestamp >= startTimestamp)
            .sort((x, y) => x.timestamp - y.timestamp);
          const decimals = vault.asset?.decimals ?? 18;
          const prices = vault.asset?.address
            ? await fetchDailyPricesUsd(BASE_CHAIN_ID, vault.asset.address, startTimestamp)
            : new Map<number, number>();
          const history: GqlHistory = {
            shares: daily.map((p) => ({ x: p.timestamp, y: p.shares ?? '0' })),
            assets: daily.map((p) => ({ x: p.timestamp, y: p.assets ?? '0' })),
            assetsUsd: daily.flatMap((p) => {
              const price = priceOnDay(prices, p.timestamp);
              return price === null
                ? []
                : [{ x: p.timestamp, y: Number(formatUnits(BigInt(p.assets ?? '0'), decimals)) * price }];
            }),
          };
          return {
            vault: { address, name: vault.name ?? null, asset: vault.asset ?? null },
            history,
          } satisfies FetchedPosition;
        })
    );
  };
  const [v1, v2] = await Promise.all([loadVersion('v1'), loadVersion('v2')]);
  const byAddress = new Map<string, FetchedPosition>();
  for (const row of [...v1, ...v2]) byAddress.set(row.vault.address!.toLowerCase(), row);
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
  const positionByVaultDay = new Map<string, { shares: bigint; tokens: number }>();
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
      // End-of-day balance and price, keyed by the day the point closes.
      const day = utcDayClosedBySnapshot(p.x);
      if (p.tokens > 0 && p.usd != null && p.usd > 0) {
        priceByVaultDay.set(`${vaultAddress}|${day}`, p.usd / p.tokens);
      }
      if (p.shares > 0n && p.tokens > 0) {
        positionByVaultDay.set(`${vaultAddress}|${day}`, {
          shares: p.shares,
          tokens: p.tokens,
        });
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

  let capitalInflowsExcluded = 0;
  let unmatchedCapitalInflows = 0;
  const capitalInflows = transferFetch.transfers
    .filter((row) => isPrincipalCapitalInflow(row) && row.asset && includeVault(row.vaultAddress))
    .sort((a, b) => a.timestamp - b.timestamp);
  for (const row of capitalInflows) {
    const asset = row.asset;
    if (!asset) continue;
    const vaultAddress = row.vaultAddress.toLowerCase();
    const day = utcDayKeyFromTimestamp(row.timestamp);
    const snap = positionByVaultDay.get(`${vaultAddress}|${day}`);
    const tokens = capitalInflowTokens({
      assetsRaw: row.assetsRaw,
      assetDecimals: row.assetDecimals,
      sharesRaw: row.sharesRaw,
      dayShares: snap?.shares ?? null,
      dayTokens: snap?.tokens ?? 0,
    });
    if (!(tokens > 0)) continue;
    const price =
      priceByVaultDay.get(`${vaultAddress}|${day}`) ?? (asset === 'USDC' ? 1 : null);
    const usd = price != null ? tokens * price : 0;
    const matched = takeMatchedIncome(remainingIncome, vaultAddress, day, {
      tokens,
      usd,
    });
    if (!matched) {
      unmatchedCapitalInflows += 1;
      continue;
    }
    subtractIncome(monthlyStatements, vaultMonthlyMap, dailyMap, {
      vaultAddress,
      asset,
      timestamp: row.timestamp,
      tokens: matched.tokens,
      usd: matched.usd,
    });
    capitalInflowsExcluded += 1;
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
    capitalInflowsExcluded,
    unmatchedCapitalInflows,
    transferError: transferFetch.error,
    monthsWithData: statements.length,
  });

  const warning = transferFetch.error
    ? 'Treasury deposits and inbound transfers could not be loaded, so capital movements are still in revenue — revenue may be overstated. Retry shortly.'
    : transferFetch.truncated
      ? 'Treasury transfer history was cut off at the page limit, so older deposits and inbound transfers may still be in revenue — revenue may be overstated.'
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
    'treasury-statement-daily-shares-v6',
    API_CACHE_MAX_AGE_MS,
    computeTreasuryStatementUncached,
    (result) => result.warning == null
  );
}
