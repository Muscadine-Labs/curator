/** Poll dashboard KPIs (protocol stats, vault list) every 60s. */
export const CURATOR_REFETCH_INTERVAL_MS = 60_000;

/** Default stale window before a query is considered outdated. */
export const CURATOR_DEFAULT_STALE_MS = 60_000;

/**
 * Vault caps + allocation amounts come from on-chain multicall (expensive).
 * Do not poll — refresh on page load, vault tab switch, or post-tx refetch only.
 */
export const ON_CHAIN_VAULT_QUERY_OPTIONS = {
  refetchInterval: false as const,
  refetchOnWindowFocus: false as const,
  staleTime: 60_000,
};

/**
 * Morpho-indexed vault data (history, reallocations, holders, transactions).
 * No background polling — these hit the public Blue API on every refetch.
 */
export const INDEXED_VAULT_QUERY_OPTIONS = {
  refetchInterval: false as const,
  refetchOnWindowFocus: false as const,
  staleTime: 60_000,
};

/** Dashboard aggregates (protocol stats, vault list). */
export const DASHBOARD_QUERY_OPTIONS = {
  refetchInterval: CURATOR_REFETCH_INTERVAL_MS,
  refetchOnWindowFocus: false as const,
  staleTime: 60_000,
};

/** Heavy statement / treasury queries — no background poll. */
export const STATEMENT_QUERY_OPTIONS = {
  refetchInterval: false as const,
  refetchOnWindowFocus: false as const,
  staleTime: 60_000,
};

/** Do not retry Morpho rate-limit errors — they amplify 429 storms. */
export function shouldRetryCuratorQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  const msg = error instanceof Error ? error.message : String(error);
  if (
    msg.includes('429') ||
    msg.includes('Rate limit') ||
    msg.includes('temporarily_blocked') ||
    msg.includes('public_blue_api')
  ) {
    return false;
  }
  return true;
}
