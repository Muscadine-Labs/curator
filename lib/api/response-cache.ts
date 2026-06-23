export const API_CACHE_MAX_AGE_SECONDS = 30;

export function mergeApiCacheHeaders(
  rateLimitHeaders: Headers | undefined,
  maxAgeSeconds = API_CACHE_MAX_AGE_SECONDS
): Headers {
  const headers = new Headers(rateLimitHeaders);
  headers.set(
    'Cache-Control',
    `public, s-maxage=${maxAgeSeconds}, stale-while-revalidate=60`
  );
  return headers;
}
