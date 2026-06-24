export const API_CACHE_MAX_AGE_SECONDS = 30;
export const API_CACHE_MAX_AGE_MS = API_CACHE_MAX_AGE_SECONDS * 1000;
export const API_CACHE_STALE_WHILE_REVALIDATE_SECONDS = API_CACHE_MAX_AGE_SECONDS;

export function clampCacheMaxAgeSeconds(seconds: number): number {
  return Math.min(seconds, API_CACHE_MAX_AGE_SECONDS);
}

export function clampCacheTtlMs(ttlMs: number): number {
  return Math.min(ttlMs, API_CACHE_MAX_AGE_MS);
}

export function mergeApiCacheHeaders(
  rateLimitHeaders: Headers | undefined,
  maxAgeSeconds = API_CACHE_MAX_AGE_SECONDS
): Headers {
  const headers = new Headers(rateLimitHeaders);
  const maxAge = clampCacheMaxAgeSeconds(maxAgeSeconds);
  headers.set(
    'Cache-Control',
    `public, s-maxage=${maxAge}, stale-while-revalidate=${API_CACHE_STALE_WHILE_REVALIDATE_SECONDS}`
  );
  return headers;
}

/** Risk/governance routes overlay live on-chain reads — do not CDN-cache. */
export function mergeApiOnChainVaultHeaders(rateLimitHeaders: Headers | undefined): Headers {
  const headers = new Headers(rateLimitHeaders);
  headers.set('Cache-Control', 'private, no-store, must-revalidate');
  return headers;
}
