import {
  BASE_CHAIN_ID,
  ETHEREUM_CHAIN_ID,
  HYPEREVM_CHAIN_ID,
  POLYGON_CHAIN_ID,
  ROBINHOOD_CHAIN_ID,
  MORPHO_APP_ORIGIN,
} from '@/lib/constants';

/** Morpho API market identifier (`marketId` in GraphQL; `marketKey` in app JSON). */
export function marketKeyFromGraphQL(
  market: { marketId?: string | null; marketKey?: string | null; id?: string } | null | undefined
): string | null {
  return market?.marketId ?? market?.marketKey ?? market?.id ?? null;
}

/** Morpho app chain slug for deep links. */
export function morphoChainSlug(chainId: number): string {
  if (chainId === BASE_CHAIN_ID) return 'base';
  if (chainId === ETHEREUM_CHAIN_ID) return 'ethereum';
  if (chainId === HYPEREVM_CHAIN_ID) return 'hyperevm';
  if (chainId === POLYGON_CHAIN_ID) return 'polygon';
  if (chainId === ROBINHOOD_CHAIN_ID) return 'robinhood';
  return 'base';
}

export function morphoMarketHref(
  marketKey: string | null | undefined,
  chainId: number = BASE_CHAIN_ID
): string | null {
  if (!marketKey) return null;
  return `${MORPHO_APP_ORIGIN}/${morphoChainSlug(chainId)}/market/${marketKey}`;
}

/** Curator Morpho Blue market detail page. */
export function curatorBlueMarketHref(
  marketId: string | null | undefined,
  chainId: number = BASE_CHAIN_ID
): string | null {
  if (!marketId) return null;
  return `/market/blue/${encodeURIComponent(marketId)}?chainId=${chainId}`;
}
