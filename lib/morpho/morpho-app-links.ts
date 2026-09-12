import { getVaultPageHref } from '@/lib/config/vaults';
import {
  BASE_CHAIN_ID,
  ETHEREUM_CHAIN_ID,
  HYPEREVM_CHAIN_ID,
  ROBINHOOD_CHAIN_ID,
  MORPHO_APP_ORIGIN,
  MORPHO_MARKETS_ORIGIN,
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

/** Morpho app vault detail URL for a chain. */
export function morphoVaultHref(vaultAddress: string, chainId: number): string {
  return `${MORPHO_APP_ORIGIN}/${morphoChainSlug(chainId)}/vault/${vaultAddress.toLowerCase()}`;
}

/** In-app vault detail. Fee wrappers land on the underlying vault's Fee wrapper tab. */
export function curatorVaultHref(vaultAddress: string | null | undefined): string | null {
  if (!vaultAddress) return null;
  return getVaultPageHref(vaultAddress);
}

/** Morpho Curator vault page (claim fees, writes). */
export function morphoCuratorVaultHref(vaultAddress: string, chainId: number): string {
  return `https://curator.morpho.org/vaults/${chainId}/${vaultAddress}`;
}

/** Morpho app — Blue market lend/borrow (writes are muscadine-onchain, not this dashboard). */
export function curatorMarketPositionsHref(
  marketId: string | null | undefined,
  chainId: number = BASE_CHAIN_ID
): string | null {
  return morphoMarketHref(marketId, chainId);
}

/** Curator Morpho Blue market detail page. */
export function curatorBlueMarketHref(
  marketId: string | null | undefined,
  chainId: number = BASE_CHAIN_ID
): string | null {
  if (!marketId) return null;
  return `/market/blue/${encodeURIComponent(marketId)}?chainId=${chainId}`;
}

/** In-app Midnight market detail (`/midnight/{id}`). */
export function curatorMidnightMarketHref(
  marketId: string | null | undefined,
  chainId: number = BASE_CHAIN_ID
): string | null {
  if (!marketId) return null;
  return `/midnight/${encodeURIComponent(marketId)}?chainId=${chainId}`;
}

/**
 * Morpho Markets Midnight book.
 * Example: https://markets.morpho.org/fixed/base/0x549c…f221
 */
export function morphoMidnightMarketHref(
  marketId: string | null | undefined,
  chainId: number = BASE_CHAIN_ID
): string | null {
  if (!marketId) return null;
  return `${MORPHO_MARKETS_ORIGIN}/fixed/${morphoChainSlug(chainId)}/${marketId}`;
}
