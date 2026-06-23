/** Morpho GraphQL pagination limits for Vault V2 BFF routes. */
export const VAULT_V2_GRAPHQL_ADAPTER_LIMIT = 50;
/** Caps list — separate from adapters; vaults can have many market caps. */
export const VAULT_V2_GRAPHQL_CAPS_LIMIT = 100;
/** Per-adapter Blue market positions in risk query — keep low to avoid Morpho "Query is too complex". */
export const VAULT_V2_GRAPHQL_POSITION_LIMIT = 50;
export const VAULT_V2_GRAPHQL_PENDING_LIMIT = 100;
