import { logger } from '@/lib/utils/logger';
import { MORPHO_REST_ORIGIN as MORPHO_REST_URL } from '@/lib/constants';
import { API_CACHE_MAX_AGE_SECONDS } from '@/lib/api/response-cache';

/** Curator caps every cache at 30s (`API_CACHE_MAX_AGE_SECONDS`). */
const MORPHO_REST_REVALIDATE_SECONDS = API_CACHE_MAX_AGE_SECONDS;
const MORPHO_FETCH_TIMEOUT_MS = 15_000;
const MORPHO_MAX_RETRIES = 3;

/**
 * Morpho REST API (`https://api.morpho.org`), server code only. Replaces Morpho GraphQL, which
 * shuts down on 2027-01-29 (fields removed 2027-01-25). See `docs/morpho-rest-migration.md` for what each route reads and
 * what GraphQL had that REST does not.
 *
 * Responses are `{ data, cursor? }`; lists page with an opaque `cursor` (`null` on the last
 * page). Public host limit: about 750 requests a minute per IP (3,334 in 10 minutes blocks the
 * IP for 7 days). Set the server-only `MORPHO_API_KEY` to use Morpho's keyed host instead.
 */

const MORPHO_PRIVATE_URL = 'https://private.api.morpho.org';
/** An expired entry is kept this long so a rate-limited request can still serve it. */
const STALE_ON_RATE_LIMIT_MS = 10 * 60_000;
/** Longest a route handler waits on Morpho's Retry-After before retrying. */
const MAX_RETRY_WAIT_MS = 3_000;
const MAX_CACHE_ENTRIES = 500;
/** Lists we read are short (positions, pending actions, activity); this bounds a runaway cursor. */
const MAX_LIST_PAGES = 20;

export class MorphoRestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly rateLimited = false
  ) {
    super(message);
    this.name = 'MorphoRestError';
  }
}

export function isMorphoRestNotFound(error: unknown): boolean {
  return error instanceof MorphoRestError && error.status === 404;
}

export function isMorphoRestRateLimited(error: unknown): boolean {
  return error instanceof MorphoRestError && error.rateLimited;
}

/** `8453:0xAddress`: how REST names a vault, token or market. */
export function morphoSelector(chainId: number, address: string): string {
  return `${chainId}:${address}`;
}

export type MorphoRestOptions = {
  /**
   * Seconds this response may be reused (Next data cache and the in-memory cache).
   * `0` = always fresh (per-wallet reads).
   */
  revalidate?: number;
  timeoutMs?: number;
  tags?: string[];
};

type Envelope<T> = { data: T; cursor?: string | null };
type CacheEntry = { expiresAt: number; body: Envelope<unknown> };

const memoryCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<Envelope<unknown>>>();

function restHost(): { origin: string; headers: Record<string, string> } {
  const key = process.env.MORPHO_API_KEY?.trim();
  return key
    ? { origin: MORPHO_PRIVATE_URL, headers: { 'x-api-key': key } }
    : { origin: MORPHO_REST_URL, headers: {} };
}

function buildUrl(origin: string, path: string, params?: Record<string, string | number | boolean | undefined | null>) {
  const url = new URL(`${origin}${path}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function pruneCache(now: number) {
  for (const [key, entry] of memoryCache) {
    if (entry.expiresAt + STALE_ON_RATE_LIMIT_MS <= now) memoryCache.delete(key);
  }
  while (memoryCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = memoryCache.keys().next().value;
    if (oldest === undefined) break;
    memoryCache.delete(oldest);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransient(status: number) {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/** Test hook: forget every cached response. */
export function clearMorphoRestCache() {
  memoryCache.clear();
  inFlight.clear();
}

async function requestOnce(
  url: string,
  headers: Record<string, string>,
  options: MorphoRestOptions
): Promise<Envelope<unknown>> {
  const revalidate = options.revalidate ?? MORPHO_REST_REVALIDATE_SECONDS;
  let lastError: MorphoRestError | null = null;

  for (let attempt = 1; attempt <= MORPHO_MAX_RETRIES; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { accept: 'application/json', ...headers },
        signal: AbortSignal.timeout(options.timeoutMs ?? MORPHO_FETCH_TIMEOUT_MS),
        ...(revalidate > 0
          ? { next: { revalidate, ...(options.tags ? { tags: options.tags } : {}) } }
          : { cache: 'no-store' as const }),
      });
    } catch (error) {
      lastError = new MorphoRestError(
        `Morpho REST request failed: ${error instanceof Error ? error.message : String(error)}`,
        0
      );
      if (attempt < MORPHO_MAX_RETRIES) {
        await sleep(1000 * attempt);
        continue;
      }
      break;
    }

    if (response.ok) {
      const body = (await response.json().catch(() => null)) as Envelope<unknown> | null;
      if (!body || typeof body !== 'object' || !('data' in body)) {
        throw new MorphoRestError('Morpho REST response has no data', response.status);
      }
      return body;
    }

    lastError = new MorphoRestError(
      `Morpho REST HTTP ${response.status}`,
      response.status,
      response.status === 429
    );
    if (!isTransient(response.status) || attempt >= MORPHO_MAX_RETRIES) break;
    const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10) * 1000;
    const waitMs = Number.isFinite(retryAfter) ? retryAfter : 1000 * attempt;
    // Morpho asks for 600s on a rate limit; waiting that long would hang the page.
    if (waitMs > MAX_RETRY_WAIT_MS) break;
    await sleep(waitMs);
  }

  throw lastError ?? new MorphoRestError('Morpho REST request failed', 0);
}

async function request(
  path: string,
  params: Record<string, string | number | boolean | undefined | null> | undefined,
  options: MorphoRestOptions = {}
): Promise<Envelope<unknown>> {
  const { origin, headers } = restHost();
  const url = buildUrl(origin, path, params);
  const revalidate = options.revalidate ?? MORPHO_REST_REVALIDATE_SECONDS;
  const useMemory = revalidate > 0;
  const now = Date.now();
  pruneCache(now);

  const cached = useMemory ? memoryCache.get(url) : undefined;
  if (cached && cached.expiresAt > now) return cached.body;

  const running = useMemory ? inFlight.get(url) : undefined;
  if (running) return running;

  const promise = (async () => {
    try {
      const body = await requestOnce(url, headers, options);
      if (useMemory) memoryCache.set(url, { expiresAt: Date.now() + revalidate * 1000, body });
      return body;
    } catch (error) {
      // A rate limit or outage serves the last good response for a while.
      if (cached && error instanceof MorphoRestError && (error.rateLimited || isTransient(error.status) || error.status === 0)) {
        logger.warn('Morpho REST failed; serving the last good response', { path, status: error.status });
        return cached.body;
      }
      throw error;
    } finally {
      if (useMemory) inFlight.delete(url);
    }
  })();
  if (useMemory) inFlight.set(url, promise);
  return promise;
}

/** One object endpoint, e.g. `/v0/vaults-v2/{v}`. Throws `MorphoRestError` (404 for unknown). */
export async function morphoRestGet<T>(
  path: string,
  params?: Record<string, string | number | boolean | undefined | null>,
  options?: MorphoRestOptions
): Promise<T> {
  return (await request(path, params, options)).data as T;
}

/**
 * Every page of a list endpoint. Throws rather than return a cut list: a partial list
 * (positions, activity, pending changes) must not look complete.
 */
export async function morphoRestList<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined | null> = {},
  options?: MorphoRestOptions
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const body = await request(path, { ...params, cursor }, options);
    out.push(...((body.data as T[] | null) ?? []));
    if (!body.cursor) return out;
    cursor = body.cursor;
  }
  throw new MorphoRestError(`Morpho REST list exceeded ${MAX_LIST_PAGES} pages`, 200);
}
