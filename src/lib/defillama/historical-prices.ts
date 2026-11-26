import { logger } from '@/lib/utils/logger';
import { API_CACHE_MAX_AGE_MS } from '@/lib/api/response-cache';

/**
 * Daily historical USD prices from DefiLlama's free coins API (`coins.llama.fi/chart`), the
 * same provider Morpho uses for its spot prices. Morpho REST has no historical price route;
 * GraphQL's `historicalPriceUsd` / per-point `*Usd` came from this kind of series.
 */

const COINS_API = 'https://coins.llama.fi/chart';
const DAY = 86_400;
const TIMEOUT_MS = 8_000;
/** DefiLlama returns at most this many points per call. */
const MAX_SPAN = 500;

const CHAIN_SLUG: Record<number, string> = { 8453: 'base', 1: 'ethereum' };

const cache = new Map<string, { expiresAt: number; prices: Map<number, number> }>();

/** UTC day start (seconds) for a unix timestamp. */
export function utcDayStart(seconds: number): number {
  return Math.floor(seconds / DAY) * DAY;
}

/**
 * USD price per UTC day (keyed by day start, seconds) from `sinceSec` to now. Empty on any
 * failure: callers fall back to spot (never a wrong number).
 */
export async function fetchDailyPricesUsd(
  chainId: number,
  token: string,
  sinceSec: number
): Promise<Map<number, number>> {
  const chain = CHAIN_SLUG[chainId];
  if (!chain) return new Map();
  const start = utcDayStart(sinceSec);
  const key = `${chainId}:${token.toLowerCase()}:${start}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.prices;

  const out = new Map<number, number>();
  const now = Math.floor(Date.now() / 1000);
  try {
    for (let from = start; from <= now; from += MAX_SPAN * DAY) {
      const span = Math.min(MAX_SPAN, Math.ceil((now - from) / DAY) + 1);
      const url = `${COINS_API}/${chain}:${token}?start=${from}&span=${span}&period=1d&searchWidth=600`;
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), next: { revalidate: 3600 } });
      if (!res.ok) throw new Error(`DefiLlama coins HTTP ${res.status}`);
      const body = (await res.json()) as {
        coins?: Record<string, { prices?: Array<{ timestamp: number; price: number }> }>;
      };
      for (const coin of Object.values(body.coins ?? {})) {
        for (const p of coin.prices ?? []) {
          if (Number.isFinite(p.price) && p.price > 0) out.set(utcDayStart(p.timestamp), p.price);
        }
      }
    }
  } catch (error) {
    logger.warn('DefiLlama historical prices failed; using spot', {
      token,
      error: error instanceof Error ? error.message : String(error),
    });
    return new Map();
  }
  cache.set(key, { expiresAt: Date.now() + API_CACHE_MAX_AGE_MS, prices: out });
  return out;
}

/** The price for the UTC day of `seconds`, else the nearest earlier day within a week. */
export function priceOnDay(prices: ReadonlyMap<number, number>, seconds: number): number | null {
  const day = utcDayStart(seconds);
  for (let i = 0; i <= 7; i++) {
    const p = prices.get(day - i * DAY);
    if (p != null) return p;
  }
  return null;
}
