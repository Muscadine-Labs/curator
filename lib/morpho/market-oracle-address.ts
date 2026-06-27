/** Resolve on-chain oracle contract address from Morpho GraphQL `oracle.address`. */
export function resolveMarketOracleAddress(
  market:
    | {
        oracle?: { address?: string | null } | null;
      }
    | null
    | undefined
): string | null {
  return market?.oracle?.address ?? null;
}
