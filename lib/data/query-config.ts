/** Poll dashboard / indexed Morpho queries every 20s. */
export const CURATOR_REFETCH_INTERVAL_MS = 20_000;

/**
 * Vault caps + allocation amounts come from on-chain multicall (expensive).
 * Do not poll — refresh on page load, vault tab switch, or post-tx refetch only.
 */
export const ON_CHAIN_VAULT_QUERY_OPTIONS = {
  refetchInterval: false as const,
  refetchOnWindowFocus: false as const,
  staleTime: 60_000,
};
