import {
  getConfiguredVaultDisplayName,
  getVaultByAddress,
} from '@/lib/config/vaults';

/** GraphQL `__typename` for Vault V2 → Vault V2 adapters (fee wrappers). */
export const MORPHO_VAULT_V2_ADAPTER_TYPENAME = 'MorphoVaultV2Adapter';

/** GraphQL `type` field on MorphoVaultV2Adapter. */
export const MORPHO_VAULT_V2_ADAPTER_TYPE = 'MorphoVaultV2';

export const UNDERLYING_VAULT_FALLBACK = 'Underlying vault';

export type VaultV2UnderlyingInfo = {
  address: string;
  name: string | null;
  symbol: string | null;
  avgNetApy?: number | null;
  netApy?: number | null;
  liquidity?: string | null;
  liquidityUsd?: number | null;
};

export function isMorphoVaultV2Adapter(adapter: {
  __typename?: string | null;
  type?: string | null;
  adapterType?: string | null;
}): boolean {
  const t = adapter.__typename ?? adapter.adapterType ?? adapter.type ?? '';
  return t === MORPHO_VAULT_V2_ADAPTER_TYPENAME || t === MORPHO_VAULT_V2_ADAPTER_TYPE;
}

export function underlyingVaultLabel(
  vault: { name?: string | null; symbol?: string | null } | null | undefined,
  fallback = UNDERLYING_VAULT_FALLBACK
): string {
  return vault?.name || vault?.symbol || fallback;
}

/** Morpho GraphQL `innerVault` fields on MorphoVaultV2Adapter. */
export type GraphUnderlyingVaultFields = {
  address?: string | null;
  name?: string | null;
  symbol?: string | null;
  avgNetApy?: number | null;
  netApy?: number | null;
  liquidity?: string | number | null;
  liquidityUsd?: number | null;
};

/**
 * GraphQL `innerVault` plus config fallback (`underlyingAddress` on the wrapper).
 */
export function mergeUnderlyingVaultInfo(
  wrapperVaultAddress: string,
  graph: GraphUnderlyingVaultFields | null | undefined
): VaultV2UnderlyingInfo | null {
  const address =
    graph?.address || getVaultByAddress(wrapperVaultAddress)?.underlyingAddress;
  if (!address) return null;
  const childCfg = getVaultByAddress(address);
  const liquidity =
    graph?.liquidity != null && graph.liquidity !== '' ? String(graph.liquidity) : null;
  return {
    address,
    name: graph?.name ?? (childCfg ? getConfiguredVaultDisplayName(childCfg) : null),
    symbol: graph?.symbol ?? childCfg?.assetSymbol ?? null,
    avgNetApy: graph?.avgNetApy ?? null,
    netApy: graph?.netApy ?? null,
    liquidity,
    liquidityUsd: graph?.liquidityUsd ?? null,
  };
}
