import {
  BASE_CHAIN_ID,
  ETHEREUM_CHAIN_ID,
  HYPEREVM_CHAIN_ID,
  MORPHO_APP_ORIGIN,
} from '@/lib/constants';

/** Morpho API market identifier (`marketId` replaced legacy `uniqueKey`). */
export function marketKeyFromGraphQL(
  market: { marketId?: string | null; uniqueKey?: string | null; id?: string } | null | undefined
): string | null {
  return market?.marketId ?? market?.uniqueKey ?? market?.id ?? null;
}

/** Morpho app chain slug for deep links. */
export function morphoChainSlug(chainId: number): string {
  if (chainId === BASE_CHAIN_ID) return 'base';
  if (chainId === ETHEREUM_CHAIN_ID) return 'ethereum';
  if (chainId === HYPEREVM_CHAIN_ID) return 'hyperevm';
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
