import { clampCacheTtlMs } from '@/lib/api/response-cache';

type CacheEntry<T> = { data: T; expiresAt: number };

const store = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

/**
 * Short-lived in-process cache for expensive BFF handlers (e.g. protocol-stats).
 * Dedupes Morpho GraphQL bursts across tabs, HMR reloads, and concurrent requests.
 */
export async function withServerResponseCache<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.data as T;
  }

  const pending = inflight.get(key);
  if (pending) {
    return pending as Promise<T>;
  }

  const ttl = clampCacheTtlMs(ttlMs);
  const promise = loader()
    .then((data) => {
      store.set(key, { data, expiresAt: Date.now() + ttl });
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
