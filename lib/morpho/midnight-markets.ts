/**
 * Morpho Midnight markets via REST.
 * GraphQL (`api.morpho.org/graphql`) is Blue-only — Midnight is not in that schema.
 * Docs: https://docs.morpho.org/developers/api/morpho-midnight/
 */
import { BASE_CHAIN_ID, MORPHO_REST_ORIGIN, SECONDS_PER_YEAR } from '@/lib/constants';
import { fetchAssetUsdPrice, resolveTokenMeta } from '@/lib/morpho/known-tokens';
import { getOraclePriceSnapshot, type OraclePriceSnapshot } from '@/lib/morpho/oracle-price';
import { getOracleTimestampData, type OracleTimestampData } from '@/lib/morpho/oracle-utils';
import { bigintRatio } from '@/lib/format/bigint-ratio';
import { logger } from '@/lib/utils/logger';
import { AppError } from '@/lib/utils/error-handler';
import type { Address } from 'viem';

export type MidnightCollateral = {
  token: string;
  symbol: string;
  decimals: number;
  lltv: string;
  liquidationCursor: string;
  oracle: string;
  /** Posted collateral, token raw units. Null when the position scan did not finish. */
  postedAssets?: string | null;
  oracleTimestampData?: OracleTimestampData | null;
  oraclePrice?: OraclePriceSnapshot | null;
};

export type MidnightMarketListItem = {
  marketId: string;
  chainId: number;
  loanSymbol: string;
  loanAddress: string;
  loanDecimals: number;
  collaterals: MidnightCollateral[];
  collateralLabel: string;
  lltvLabel: string;
  oracleAddress: string | null;
  maturity: number;
  tenorSeconds: number;
  tenorLabel: string;
  /** Outstanding loan-token units (`total_units`). Blue's market size. */
  sizeAssets: string;
  sizeUsd: number | null;
  /** Primary collateral LLTV as a 0–1 ratio, for sorting. */
  lltvRatio: number | null;
};

type MidnightBookCollateral = {
  token?: string;
  lltv?: string;
  liquidation_cursor?: string;
  oracle?: string;
};

type MidnightBookLevel = {
  tick?: number;
  price?: string;
  units?: string;
  assets?: string;
  count?: number;
};

type MidnightBook = {
  market_id?: string;
  id?: string;
  chain_id?: number;
  midnight?: string;
  loan_token?: string;
  collaterals?: MidnightBookCollateral[];
  maturity?: number | string;
  rcf_threshold?: string;
  enter_gate?: string;
  liquidator_gate?: string;
  asks?: MidnightBookLevel[];
  bids?: MidnightBookLevel[];
};

function sumAssets(levels: MidnightBookLevel[] | undefined): bigint {
  let total = 0n;
  for (const level of levels ?? []) {
    if (!level.assets) continue;
    try {
      total += BigInt(level.assets);
    } catch {
      // skip
    }
  }
  return total;
}

/** WAD price → annualized rate. Midnight: (1/price − 1) × year / TTM. */
function midnightPriceToApr(
  priceWad: string | null | undefined,
  ttmSeconds: number
): number | null {
  if (!priceWad || ttmSeconds <= 0) return null;
  try {
    const price = Number(BigInt(priceWad)) / 1e18;
    if (!Number.isFinite(price) || price <= 0) return null;
    const rate = (1 / price - 1) * (SECONDS_PER_YEAR / ttmSeconds);
    return Number.isFinite(rate) ? rate : null;
  } catch {
    return null;
  }
}

function formatTenorLabel(ttmSeconds: number): string {
  if (ttmSeconds <= 0) return 'Matured';
  const days = Math.round(ttmSeconds / 86400);
  if (days < 14) return `${days}d`;
  if (days < 80) return `${Math.round(days / 7)}w`;
  const months = Math.round(days / 30.44);
  return `${months}M`;
}

export function formatLltvWad(lltv: string | null | undefined): string {
  if (!lltv) return '—';
  try {
    const pct = Number(BigInt(lltv)) / 1e16;
    if (!Number.isFinite(pct)) return '—';
    return `${pct.toFixed(0)}%`;
  } catch {
    return '—';
  }
}

export function formatWadPercent(wad: string | null | undefined, digits = 2): string {
  if (!wad) return '—';
  try {
    const pct = Number(BigInt(wad)) / 1e16;
    if (!Number.isFinite(pct)) return '—';
    return `${pct.toFixed(digits)}%`;
  } catch {
    return '—';
  }
}

/** Morpho LIF − 1 from LLTV + liquidation cursor (WAD). */
export function midnightLiquidationIncentive(
  lltvWad: string | null | undefined,
  cursorWad: string | null | undefined
): number | null {
  if (!lltvWad || !cursorWad) return null;
  try {
    const lltv = Number(BigInt(lltvWad)) / 1e18;
    const cursor = Number(BigInt(cursorWad)) / 1e18;
    const denom = lltv + cursor * (1 - lltv);
    if (!(denom > 0)) return null;
    const incentive = 1 / denom - 1;
    return Number.isFinite(incentive) ? incentive : null;
  } catch {
    return null;
  }
}

export function formatMidnightMaturityUtc(maturitySec: number): string {
  if (!maturitySec) return '—';
  return new Date(maturitySec * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

function isZeroAddress(addr: string | null | undefined): boolean {
  if (!addr) return true;
  return addr.toLowerCase() === ZERO_ADDRESS;
}

/** Tenor collateral-vault receipt (`cbBTC-USDC-collat`), not a second collateral asset. */
export function isTenorCollateralShare(symbol: string | undefined): boolean {
  return Boolean(symbol && symbol.toLowerCase().endsWith('-collat'));
}

/**
 * Collaterals borrowers post. Two extras are not the pair:
 * the loan token itself (a USDC-debt market may accept USDC), and the Tenor
 * collateral-vault share (`cbBTC-USDC-collat`), which is a receipt for the
 * real collateral. Keep an extra only when nothing else is listed.
 */
export function selectMidnightCollaterals<T extends { token: string; symbol?: string }>(
  collaterals: readonly T[],
  loanAddress: string
): T[] {
  const loan = loanAddress.toLowerCase();
  const notLoan = collaterals.filter((c) => c.token.toLowerCase() !== loan);
  const pool = notLoan.length > 0 ? notLoan : [...collaterals];
  const withoutShares = pool.filter((c) => !isTenorCollateralShare(c.symbol));
  return withoutShares.length > 0 ? withoutShares : pool;
}

function wadToRatio(wad: string | null | undefined): number | null {
  if (!wad) return null;
  try {
    const ratio = Number(BigInt(wad)) / 1e18;
    return Number.isFinite(ratio) ? ratio : null;
  } catch {
    return null;
  }
}

type MidnightMarketRow = {
  chain_id?: number;
  market_id?: string;
  loan_token?: string;
  maturity?: number | string;
  total_units?: string;
  collaterals?: MidnightBookCollateral[];
};

async function fetchMarketsPage(
  chainId: number,
  cursor: string | null
): Promise<{ cursor?: string | null; data?: MidnightMarketRow[] }> {
  const url = new URL(`${MORPHO_REST_ORIGIN}/v0/midnight/markets`);
  url.searchParams.set('chain_ids', String(chainId));
  url.searchParams.set('limit', '100');
  url.searchParams.set('sort', 'total_units');
  url.searchParams.set('order', 'desc');
  if (cursor) url.searchParams.set('cursor', cursor);

  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Midnight markets HTTP ${res.status}`);
  }
  return res.json() as Promise<{ cursor?: string | null; data?: MidnightMarketRow[] }>;
}

function rawToUsd(raw: string, decimals: number, priceUsd: number | null): number | null {
  if (priceUsd == null) return null;
  try {
    const amount = bigintRatio(BigInt(raw), 10n ** BigInt(decimals));
    if (!Number.isFinite(amount)) return null;
    return amount * priceUsd;
  } catch {
    return null;
  }
}

export async function fetchMidnightMarkets(
  chainId: number = BASE_CHAIN_ID
): Promise<MidnightMarketListItem[]> {
  const rows: MidnightMarketRow[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 15; i += 1) {
    const page = await fetchMarketsPage(chainId, cursor);
    rows.push(...(page.data ?? []));
    cursor = page.cursor ?? null;
    if (!cursor) break;
  }

  const tokenAddrs = new Set<string>();
  for (const row of rows) {
    if (row.loan_token) tokenAddrs.add(row.loan_token.toLowerCase());
    for (const c of row.collaterals ?? []) {
      if (c.token) tokenAddrs.add(c.token.toLowerCase());
    }
  }
  await Promise.all(
    Array.from(tokenAddrs).map((addr) => resolveTokenMeta(addr, chainId))
  );
  const loanAddrs = [
    ...new Set(rows.map((row) => row.loan_token?.toLowerCase()).filter((addr): addr is string => Boolean(addr))),
  ];
  const loanPrices = new Map<string, number | null>();
  await Promise.all(
    loanAddrs.map(async (addr) => {
      loanPrices.set(addr, await fetchAssetUsdPrice(addr, chainId));
    })
  );

  const nowSec = Math.floor(Date.now() / 1000);
  const mapped: MidnightMarketListItem[] = [];

  for (const row of rows) {
    const marketId = row.market_id;
    const loanAddress = row.loan_token;
    if (!marketId || !loanAddress) continue;

    const maturity = Number(row.maturity ?? 0);
    const tenorSeconds = Math.max(0, maturity - nowSec);
    const loanMeta = await resolveTokenMeta(loanAddress, chainId);
    const allCollaterals: MidnightCollateral[] = [];
    for (const c of row.collaterals ?? []) {
      if (!c.token) continue;
      const meta = await resolveTokenMeta(c.token, chainId);
      allCollaterals.push({
        token: c.token,
        symbol: meta.symbol,
        decimals: meta.decimals,
        lltv: c.lltv ?? '0',
        liquidationCursor: c.liquidation_cursor ?? '0',
        oracle: c.oracle ?? '',
      });
    }
    const collaterals = selectMidnightCollaterals(allCollaterals, loanAddress);
    const sizeAssets = row.total_units ?? '0';

    mapped.push({
      marketId,
      chainId: row.chain_id ?? chainId,
      loanSymbol: loanMeta.symbol,
      loanAddress,
      loanDecimals: loanMeta.decimals,
      collaterals,
      collateralLabel: collaterals.map((c) => c.symbol).join(', ') || '—',
      lltvLabel: collaterals.map((c) => formatLltvWad(c.lltv)).join(' / ') || '—',
      lltvRatio: wadToRatio(collaterals[0]?.lltv),
      oracleAddress: collaterals[0]?.oracle || null,
      maturity,
      tenorSeconds,
      tenorLabel: formatTenorLabel(tenorSeconds),
      sizeAssets,
      sizeUsd: rawToUsd(
        sizeAssets,
        loanMeta.decimals,
        loanPrices.get(loanAddress.toLowerCase()) ?? null
      ),
    });
  }

  mapped.sort((a, b) => (b.sizeUsd ?? 0) - (a.sizeUsd ?? 0));
  logger.debug('Fetched Midnight markets', { chainId, count: mapped.length });
  return mapped;
}

export type MidnightBookLevelView = {
  tick: number;
  priceWad: string;
  units: string;
  assets: string;
  count: number;
  rate: number | null;
};

export type MidnightMarketDetail = {
  marketId: string;
  chainId: number;
  midnight: string | null;
  marketFamilyId: string | null;
  loanSymbol: string;
  loanAddress: string;
  loanDecimals: number;
  collaterals: MidnightCollateral[];
  collateralLabel: string;
  lltvLabel: string;
  maturity: number;
  tenorSeconds: number;
  tenorLabel: string;
  rcfThreshold: string | null;
  enterGate: string | null;
  liquidatorGate: string | null;
  totalUnits: string | null;
  tickGranularity: number | null;
  currentSettlementFeeCbp: string | null;
  continuousFeeRate: string | null;
  lastIndexedBlock: string | null;
  asks: MidnightBookLevelView[];
  bids: MidnightBookLevelView[];
  bestLendRate: number | null;
  bestBorrowRate: number | null;
  /** Open ask size, loan-token raw. Not filled deposits. */
  lendDepthAssets: string;
  /** Open bid size, loan-token raw. Not filled borrows. */
  borrowDepthAssets: string;
  /** Sum of position credit, loan-token raw. Null when the scan did not finish. */
  lenderCredit: string | null;
  /** Sum of position debt, loan-token raw. Null when the scan did not finish. */
  borrowerDebt: string | null;
  lendPositionCount: number;
  borrowPositionCount: number;
};

type MidnightMarketConfig = {
  chain_id?: number;
  market_id?: string;
  market_family_id?: string;
  loan_token?: string;
  collaterals?: MidnightBookCollateral[];
  maturity?: number | string;
  rcf_threshold?: string;
  enter_gate?: string;
  liquidator_gate?: string;
};

type MidnightMarketState = {
  chain_id?: number;
  market_id?: string;
  market_family_id?: string;
  total_units?: string;
  tick_granularity?: number;
  current_settlement_fee_cbp?: string;
  continuous_fee_rate?: string;
  last_indexed_block?: string;
};

type RestWrap<T> = { data?: T };

type MidnightPositionRow = {
  credit?: string;
  debt?: string;
  type?: string;
  collaterals?: Array<{ token?: string; amount?: string }>;
};

type MidnightPositionsPage = {
  cursor?: string | null;
  data?: MidnightPositionRow[];
};

const POSITIONS_PAGE_LIMIT = 100;
const POSITIONS_MAX_PAGES = 20;

function addRaw(total: bigint, raw: string | null | undefined): bigint {
  if (!raw) return total;
  try {
    return total + BigInt(raw);
  } catch {
    return total;
  }
}

/** Sum lender credit, borrower debt, and posted collateral across one positions page. */
export function sumMidnightPositionRows(rows: MidnightPositionRow[]): {
  lenderCredit: bigint;
  borrowerDebt: bigint;
  lendCount: number;
  borrowCount: number;
  collateralByToken: Map<string, bigint>;
} {
  let lenderCredit = 0n;
  let borrowerDebt = 0n;
  let lendCount = 0;
  let borrowCount = 0;
  const collateralByToken = new Map<string, bigint>();
  for (const row of rows) {
    if (row.type === 'lend') lendCount += 1;
    else if (row.type === 'borrow') borrowCount += 1;
    lenderCredit = addRaw(lenderCredit, row.credit);
    borrowerDebt = addRaw(borrowerDebt, row.debt);
    for (const collateral of row.collaterals ?? []) {
      if (!collateral.token) continue;
      const key = collateral.token.toLowerCase();
      collateralByToken.set(key, addRaw(collateralByToken.get(key) ?? 0n, collateral.amount));
    }
  }
  return { lenderCredit, borrowerDebt, lendCount, borrowCount, collateralByToken };
}

async function fetchMidnightPositionTotals(marketId: string): Promise<{
  lenderCredit: string;
  borrowerDebt: string;
  lendPositionCount: number;
  borrowPositionCount: number;
  collateralByToken: Map<string, bigint>;
} | null> {
  let cursor: string | null = null;
  let lenderCredit = 0n;
  let borrowerDebt = 0n;
  let lendPositionCount = 0;
  let borrowPositionCount = 0;
  const collateralByToken = new Map<string, bigint>();

  for (let page = 0; page < POSITIONS_MAX_PAGES; page += 1) {
    const params = new URLSearchParams({ limit: String(POSITIONS_PAGE_LIMIT) });
    if (cursor) params.set('cursor', cursor);
    const body = await fetchMidnightRest<MidnightPositionsPage>(
      `/v0/midnight/markets/${marketId}/positions?${params.toString()}`
    );
    if (body == null) {
      logger.warn('Midnight position page missing', { marketId, page });
      return null;
    }
    const summed = sumMidnightPositionRows(body.data ?? []);
    lenderCredit += summed.lenderCredit;
    borrowerDebt += summed.borrowerDebt;
    lendPositionCount += summed.lendCount;
    borrowPositionCount += summed.borrowCount;
    for (const [token, amount] of summed.collateralByToken) {
      collateralByToken.set(token, (collateralByToken.get(token) ?? 0n) + amount);
    }
    cursor = body.cursor ?? null;
    if (!cursor) {
      return {
        lenderCredit: lenderCredit.toString(),
        borrowerDebt: borrowerDebt.toString(),
        lendPositionCount,
        borrowPositionCount,
        collateralByToken,
      };
    }
  }

  logger.warn('Midnight position list exceeded page cap', { marketId });
  return null;
}

async function fetchMidnightRest<T>(path: string): Promise<T | null> {
  const res = await fetch(`${MORPHO_REST_ORIGIN}${path}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Midnight HTTP ${res.status} (${path})`);
  }
  return res.json() as Promise<T>;
}

function gateOrNull(addr: string | null | undefined): string | null {
  if (!addr || isZeroAddress(addr)) return null;
  return addr;
}

function mapBookLevels(
  levels: MidnightBookLevel[] | undefined,
  tenorSeconds: number
): MidnightBookLevelView[] {
  const out: MidnightBookLevelView[] = [];
  for (const level of levels ?? []) {
    if (!level.price || !level.assets) continue;
    out.push({
      tick: level.tick ?? 0,
      priceWad: level.price,
      units: level.units ?? '0',
      assets: level.assets,
      count: level.count ?? 0,
      rate: midnightPriceToApr(level.price, tenorSeconds),
    });
  }
  return out;
}

async function mapCollaterals(
  raw: MidnightBookCollateral[] | undefined,
  chainId: number,
  loanDecimals: number,
  loanSpotUsd: number | null
): Promise<MidnightCollateral[]> {
  const entries = (raw ?? []).filter((c): c is MidnightBookCollateral & { token: string } =>
    Boolean(c.token)
  );

  return Promise.all(
    entries.map(async (c) => {
      const meta = await resolveTokenMeta(c.token, chainId);
      const oracle = c.oracle ?? '';
      let oracleTimestampData: OracleTimestampData | null = null;
      let oraclePrice: OraclePriceSnapshot | null = null;

      if (chainId === BASE_CHAIN_ID && oracle) {
        const collateralSpotUsd = await fetchAssetUsdPrice(c.token, chainId);
        [oracleTimestampData, oraclePrice] = await Promise.all([
          getOracleTimestampData(oracle as Address),
          getOraclePriceSnapshot({
            oracleAddress: oracle,
            loanDecimals,
            collateralDecimals: meta.decimals,
            spotCollateralUsd: collateralSpotUsd,
            spotLoanUsd: loanSpotUsd,
          }),
        ]);
      }

      return {
        token: c.token,
        symbol: meta.symbol,
        decimals: meta.decimals,
        lltv: c.lltv ?? '0',
        liquidationCursor: c.liquidation_cursor ?? '0',
        oracle,
        oracleTimestampData,
        oraclePrice,
      };
    })
  );
}

export async function fetchMidnightMarketDetail(
  marketId: string,
  chainId: number = BASE_CHAIN_ID
): Promise<MidnightMarketDetail> {
  const id = marketId.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(id)) {
    throw new AppError('Invalid Midnight market id', 400, 'INVALID_MARKET_ID');
  }

  const [marketWrap, stateWrap, bookWrap, positionTotals] = await Promise.all([
    fetchMidnightRest<RestWrap<MidnightMarketConfig>>(`/v0/midnight/markets/${id}`),
    fetchMidnightRest<RestWrap<MidnightMarketState>>(`/v0/midnight/markets/${id}/state`),
    fetchMidnightRest<RestWrap<MidnightBook>>(`/v0/midnight/books/${id}?depth=80`),
    fetchMidnightPositionTotals(id).catch((error: unknown) => {
      logger.warn('Midnight position totals failed', { marketId: id, error });
      return null;
    }),
  ]);

  const config = marketWrap?.data;
  const book = bookWrap?.data;
  const state = stateWrap?.data;
  const loanAddress = config?.loan_token ?? book?.loan_token;
  const resolvedId = config?.market_id ?? book?.market_id ?? book?.id ?? id;
  const resolvedChain = config?.chain_id ?? book?.chain_id ?? chainId;

  if (!loanAddress || !resolvedId) {
    throw new AppError('Midnight market not found', 404, 'MARKET_NOT_FOUND');
  }

  const maturity = Number(config?.maturity ?? book?.maturity ?? 0);
  const nowSec = Math.floor(Date.now() / 1000);
  const tenorSeconds = Math.max(0, maturity - nowSec);
  const loanMeta = await resolveTokenMeta(loanAddress, resolvedChain);
  const loanSpotUsd =
    resolvedChain === BASE_CHAIN_ID
      ? await fetchAssetUsdPrice(loanAddress, resolvedChain)
      : null;
  const collaterals = await mapCollaterals(
    config?.collaterals ?? book?.collaterals,
    resolvedChain,
    loanMeta.decimals,
    loanSpotUsd
  );
  const posted = positionTotals?.collateralByToken;
  for (const collateral of collaterals) {
    collateral.postedAssets = posted
      ? (posted.get(collateral.token.toLowerCase()) ?? 0n).toString()
      : null;
  }
  const pairCollaterals = selectMidnightCollaterals(collaterals, loanAddress);
  const asks = mapBookLevels(book?.asks, tenorSeconds);
  const bids = mapBookLevels(book?.bids, tenorSeconds);

  const detail: MidnightMarketDetail = {
    marketId: resolvedId,
    chainId: resolvedChain,
    midnight: book?.midnight ?? null,
    marketFamilyId: config?.market_family_id ?? state?.market_family_id ?? null,
    loanSymbol: loanMeta.symbol,
    loanAddress,
    loanDecimals: loanMeta.decimals,
    collaterals,
    collateralLabel: pairCollaterals.map((c) => c.symbol).join(', ') || '—',
    lltvLabel: pairCollaterals.map((c) => formatLltvWad(c.lltv)).join(' / ') || '—',
    maturity,
    tenorSeconds,
    tenorLabel: formatTenorLabel(tenorSeconds),
    rcfThreshold: config?.rcf_threshold ?? book?.rcf_threshold ?? null,
    enterGate: gateOrNull(config?.enter_gate ?? book?.enter_gate),
    liquidatorGate: gateOrNull(config?.liquidator_gate ?? book?.liquidator_gate),
    totalUnits: state?.total_units ?? null,
    tickGranularity: state?.tick_granularity ?? null,
    currentSettlementFeeCbp: state?.current_settlement_fee_cbp ?? null,
    continuousFeeRate: state?.continuous_fee_rate ?? null,
    lastIndexedBlock: state?.last_indexed_block ?? null,
    asks,
    bids,
    bestLendRate: asks[0]?.rate ?? null,
    bestBorrowRate: bids[0]?.rate ?? null,
    lendDepthAssets: sumAssets(book?.asks).toString(),
    borrowDepthAssets: sumAssets(book?.bids).toString(),
    lenderCredit: positionTotals?.lenderCredit ?? null,
    borrowerDebt: positionTotals?.borrowerDebt ?? null,
    lendPositionCount: positionTotals?.lendPositionCount ?? 0,
    borrowPositionCount: positionTotals?.borrowPositionCount ?? 0,
  };

  logger.debug('Fetched Midnight market detail', { marketId: resolvedId, chainId: resolvedChain });
  return detail;
}
