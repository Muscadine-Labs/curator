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

function marketHref(
  path: string,
  chainId: number,
  returnTo?: string | null
): string {
  const params = new URLSearchParams({ chainId: String(chainId) });
  const safeReturn = safeReturnPath(returnTo);
  if (safeReturn) params.set('from', safeReturn);
  return `${path}?${params.toString()}`;
}

const RETURN_PATH_BASE = 'https://curator.invalid';
// Browsers read `\` as `/` and drop tab/CR/LF inside URLs, so `/\evil.com` and
// `/<TAB>/evil.com` are protocol-relative even though they start with one `/`.
const UNSAFE_RETURN_CHARS = /[\\\u0000-\u001f\u007f]/;

/** In-app path to return to, or null when the query is missing or unsafe. */
export function safeReturnPath(from: string | null | undefined): string | null {
  if (!from || !from.startsWith('/') || from.startsWith('//')) return null;
  if (UNSAFE_RETURN_CHARS.test(from)) return null;
  try {
    const url = new URL(from, RETURN_PATH_BASE);
    if (url.origin !== RETURN_PATH_BASE) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/** Curator Morpho Blue market detail page. */
export function curatorBlueMarketHref(
  marketId: string | null | undefined,
  chainId: number = BASE_CHAIN_ID,
  returnTo?: string | null
): string | null {
  if (!marketId) return null;
  return marketHref(`/market/blue/${encodeURIComponent(marketId)}`, chainId, returnTo);
}

/** In-app Midnight market detail (`/midnight/{id}`). */
export function curatorMidnightMarketHref(
  marketId: string | null | undefined,
  chainId: number = BASE_CHAIN_ID,
  returnTo?: string | null
): string | null {
  if (!marketId) return null;
  return marketHref(`/midnight/${encodeURIComponent(marketId)}`, chainId, returnTo);
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
