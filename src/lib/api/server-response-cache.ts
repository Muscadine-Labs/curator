import { clampCacheTtlMs } from '@/lib/api/response-cache';

type CacheEntry<T> = { data: T; expiresAt: number };

const store = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

const DEFAULT_LOADER_TIMEOUT_MS = 40_000;
const MAX_STORE_KEYS = 80;

function pruneExpired(now: number): void {
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
  if (store.size <= MAX_STORE_KEYS) return;
  const oldest = [...store.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  for (let i = 0; i < oldest.length - MAX_STORE_KEYS; i++) {
    store.delete(oldest[i][0]);
  }
}

function withTimeout<T>(loader: () => Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Cache loader timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    loader()
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Short-lived in-process cache for expensive BFF handlers (e.g. protocol-stats).
 * Dedupes Morpho GraphQL bursts across tabs, HMR reloads, and concurrent requests.
 */
export async function withServerResponseCache<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
  /** Return false to serve this result without caching it (e.g. partial data). */
  shouldCache: (data: T) => boolean = () => true
): Promise<T> {
  const now = Date.now();
  pruneExpired(now);

  const hit = store.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.data as T;
  }
  if (hit) store.delete(key);

  const pending = inflight.get(key);
  if (pending) {
    return pending as Promise<T>;
  }

  const ttl = clampCacheTtlMs(ttlMs);
  const promise = withTimeout(loader, DEFAULT_LOADER_TIMEOUT_MS)
    .then((data) => {
      if (shouldCache(data)) store.set(key, { data, expiresAt: Date.now() + ttl });
      inflight.delete(key);
      return data;
    })
    .catch((err) => {
      inflight.delete(key);
      throw err;
    });

  inflight.set(key, promise);
  return promise as Promise<T>;
}
