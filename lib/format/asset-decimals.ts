/**
 * Asset-aware decimals for display and parsing.
 * Morpho API decimals are preferred when present; known symbols override fallbacks.
 */

export function normalizeAssetSymbol(symbol: string | null | undefined): string {
  return (symbol ?? '').trim().toUpperCase();
}

/** Canonical display decimals for well-known vault assets. */
export function getKnownAssetDecimals(symbol: string | null | undefined): number | null {
  const raw = normalizeAssetSymbol(symbol);
  if (!raw) return null;

  // cbBTC, CBTC, etc. → BTC
  const core = raw.replace(/^CB/, '');

  if (core === 'USDC' || core === 'USDT' || core === 'DAI' || core === 'USDBC') return 6;
  if (core === 'WETH' || core === 'ETH') return 18;
  if (core === 'BTC' || core === 'WBTC' || core === 'TBTC' || core === 'LBTC') return 8;

  return null;
}

/** Chain / API decimals with known-asset fallback (for bigint math). */
export function resolveAssetDecimals(
  symbol: string | null | undefined,
  apiDecimals?: number | null
): number {
  const known = getKnownAssetDecimals(symbol);
  if (known != null) return known;
  if (apiDecimals != null && apiDecimals >= 0 && apiDecimals <= 36) return apiDecimals;
  return 18;
}

/** Max fraction digits to show in the UI for a given asset. */
export function getTokenDisplayDecimals(
  symbol: string | null | undefined,
  chainDecimals: number
): number {
  const raw = normalizeAssetSymbol(symbol);
  const core = raw.replace(/^CB/, '');

  // UI fraction digits (not chain decimals): WETH/cbBTC → 6, stables → 3.
  if (core === 'USDC' || core === 'USDT' || core === 'DAI' || core === 'USDBC') return 3;
  if (core === 'WETH' || core === 'ETH') return 6;
  if (core === 'BTC' || core === 'WBTC' || core === 'TBTC' || core === 'LBTC') return 6;

  const known = getKnownAssetDecimals(symbol);
  if (known != null) return Math.min(known, 6);
  return Math.min(Math.max(chainDecimals, 0), 6);
}
