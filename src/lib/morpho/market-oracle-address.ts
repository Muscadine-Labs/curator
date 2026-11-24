const ZERO_ORACLE = '0x0000000000000000000000000000000000000000';

/** Resolve on-chain oracle contract address from explicit field or Morpho GraphQL `oracle.address`. */
export function resolveMarketOracleAddress(
  market:
    | {
        oracleAddress?: string | null;
        oracle?: { address?: string | null } | null;
      }
    | null
    | undefined
): string | null {
  const explicit = market?.oracleAddress;
  if (explicit && explicit.toLowerCase() !== ZERO_ORACLE) {
    return explicit;
  }
  const nested = market?.oracle?.address;
  if (nested && nested.toLowerCase() !== ZERO_ORACLE) {
    return nested;
  }
  return null;
}
