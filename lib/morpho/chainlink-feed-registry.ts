import { API_CACHE_MAX_AGE_MS } from '@/lib/api/response-cache';
import { logger } from '@/lib/utils/logger';

/**
 * Chainlink's public feed directory (the data behind data.chain.link). It is
 * the only source for a feed's heartbeat and deviation threshold — neither is
 * readable on-chain, and Morpho GraphQL no longer exposes feed metadata.
 */
const CHAINLINK_DIRECTORY_URLS: Record<number, string> = {
  8453: 'https://reference-data-directory.vercel.app/feeds-ethereum-mainnet-base-1.json',
};

const FETCH_TIMEOUT_MS = 6_000;

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

type DirectoryRow = {
  name?: unknown;
  heartbeat?: unknown;
  threshold?: unknown;
  feedType?: unknown;
  path?: unknown;
  proxyAddress?: unknown;
  secondaryProxyAddress?: unknown;
  docs?: { productType?: unknown } | null;
};

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;

/** Directory JSON → map keyed by lowercase proxy address (incl. secondary proxies). */
export function parseChainlinkDirectory(json: unknown): Map<string, ChainlinkFeedRegistryEntry> {
  const out = new Map<string, ChainlinkFeedRegistryEntry>();
  if (!Array.isArray(json)) return out;
  for (const row of json as DirectoryRow[]) {
    const name = str(row?.name);
    if (!name) continue;
    const entry: ChainlinkFeedRegistryEntry = {
      name,
      heartbeatSeconds: num(row.heartbeat),
      deviationPct: num(row.threshold),
      feedType: str(row.feedType),
      productType: str(row.docs?.productType),
      path: str(row.path),
    };
    for (const addr of [str(row.proxyAddress), str(row.secondaryProxyAddress)]) {
      if (addr && /^0x[0-9a-fA-F]{40}$/.test(addr)) out.set(addr.toLowerCase(), entry);
    }
  }
  return out;
}

/** data.chain.link page for a feed (Base). */
export function chainlinkFeedPageUrl(entry: ChainlinkFeedRegistryEntry, chainId: number): string | null {
  if (!entry.path || chainId !== 8453) return null;
  return `https://data.chain.link/feeds/base/base/${entry.path}`;
}

type CacheEntry = { fetchedAt: number; map: Map<string, ChainlinkFeedRegistryEntry> };
const cache = new Map<number, CacheEntry>();
const inflight = new Map<number, Promise<Map<string, ChainlinkFeedRegistryEntry>>>();

/** Cached (≤30s) registry for a chain; empty map when unsupported or unreachable. */
export async function getChainlinkFeedRegistry(
  chainId: number
): Promise<Map<string, ChainlinkFeedRegistryEntry>> {
  const url = CHAINLINK_DIRECTORY_URLS[chainId];
  if (!url) return new Map();

  const hit = cache.get(chainId);
  if (hit && Date.now() - hit.fetchedAt < API_CACHE_MAX_AGE_MS) return hit.map;

  const pending = inflight.get(chainId);
  if (pending) return pending;

  const load = (async () => {
    try {
      const res = await fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const map = parseChainlinkDirectory(await res.json());
      cache.set(chainId, { fetchedAt: Date.now(), map });
      return map;
    } catch (error) {
      logger.warn('Chainlink feed directory unavailable', {
        chainId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Serve the last good copy rather than dropping heartbeat data.
      return hit?.map ?? new Map<string, ChainlinkFeedRegistryEntry>();
    } finally {
      inflight.delete(chainId);
    }
  })();
  inflight.set(chainId, load);
  return load;
}
