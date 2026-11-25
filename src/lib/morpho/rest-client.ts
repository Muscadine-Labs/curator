import { MORPHO_REST_ORIGIN } from '@/lib/constants';

/**
 * Morpho REST API (`https://api.morpho.org`). Server code only.
 *
 * Replaces Morpho GraphQL fields that Morpho retires before the endpoint
 * itself shuts down (see `docs/morpho-rest-migration.md`). The result is under
 * `data`; lists add an opaque `cursor` (`null` on the last page).
 */

const DEFAULT_TIMEOUT_MS = 15_000;
/** Lists we read are short (caps, pending actions); this bounds a runaway cursor. */
const MAX_PAGES = 20;

export class MorphoRestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'MorphoRestError';
  }
}

/** `8453:0xAddress` — how REST names a vault, token or oracle. */
export function morphoSelector(chainId: number, address: string): string {
  return `${chainId}:${address}`;
}

type RestEnvelope<T> = { data: T; cursor?: string | null };

async function morphoRestRequest<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<RestEnvelope<T>> {
  const url = new URL(`${MORPHO_REST_ORIGIN}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const res = await fetch(url.toString(), {
    cache: 'no-store',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(Math.max(1, timeoutMs)),
  });
  if (!res.ok) {
    throw new MorphoRestError(`Morpho REST HTTP ${res.status} (${path})`, res.status);
  }
  const body = (await res.json()) as RestEnvelope<T> | null;
  if (!body || !('data' in body)) {
    throw new MorphoRestError(`Morpho REST response has no data (${path})`, res.status);
  }
  return body;
}

/** One object endpoint, e.g. `/v0/vaults-v2/{v}/allocations`. */
export async function morphoRestGet<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
  timeoutMs?: number
): Promise<T> {
  return (await morphoRestRequest<T>(path, params, timeoutMs)).data;
}

/**
 * Every page of a list endpoint. Throws rather than return a cut list: a
 * partial pending or cap list must not be shown as complete.
 */
export async function morphoRestList<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  timeoutMs?: number
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await morphoRestRequest<T[]>(path, { ...params, cursor }, timeoutMs);
    out.push(...(body.data ?? []));
    if (!body.cursor) return out;
    cursor = body.cursor;
  }
  throw new MorphoRestError(`Morpho REST list exceeded ${MAX_PAGES} pages (${path})`, 200);
}
