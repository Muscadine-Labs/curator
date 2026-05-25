import { BASE_CHAIN_ID } from '@/lib/constants';

const MORPHO_APP_ORIGIN = 'https://app.morpho.org';

/** Morpho app chain slug (Curator vaults are on Base today). */
function morphoChainSlug(chainId: number): string {
  if (chainId === BASE_CHAIN_ID) return 'base';
  return 'base';
}

export function morphoMarketHref(
  uniqueKey: string | null | undefined,
  chainId: number = BASE_CHAIN_ID
): string | null {
  if (!uniqueKey) return null;
  return `${MORPHO_APP_ORIGIN}/${morphoChainSlug(chainId)}/market/${uniqueKey}`;
}

export function morphoVaultHref(
  address: string | null | undefined,
  chainId: number = BASE_CHAIN_ID
): string | null {
  if (!address) return null;
  return `${MORPHO_APP_ORIGIN}/${morphoChainSlug(chainId)}/vault/${address.toLowerCase()}`;
}
