/** Safe API free tier: 5 requests/second — stay under with ~210ms spacing. */
export const SAFE_TX_SERVICE_MIN_INTERVAL_MS = 210;

let rateLimitTail: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

/** Serialize Transaction Service calls so bursts stay under 5 req/s. */
export function withSafeTxServiceRateLimit<T>(fn: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const now = Date.now();
    const wait = Math.max(0, SAFE_TX_SERVICE_MIN_INTERVAL_MS - (now - lastCallAt));
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    lastCallAt = Date.now();
    return fn();
  };

  const next = rateLimitTail.then(run, run);
  rateLimitTail = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}
