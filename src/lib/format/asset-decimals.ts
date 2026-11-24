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

  if (core === 'USDC' || core === 'USDT' || core === 'USDBC') return 6;
  if (core === 'DAI') return 18;
  if (core === 'WETH' || core === 'ETH') return 18;
  if (core === 'BTC' || core === 'WBTC' || core === 'TBTC' || core === 'LBTC') return 8;

  return null;
}

/**
 * Prefer on-chain / API decimals when provided so Max→parseUnits stays consistent.
 * Known symbols only fill in when apiDecimals is missing.
 */
export function resolveAssetDecimals(
  symbol: string | null | undefined,
  apiDecimals?: number | null
): number {
  if (apiDecimals != null && apiDecimals >= 0 && apiDecimals <= 36) return apiDecimals;
  const known = getKnownAssetDecimals(symbol);
  if (known != null) return known;
  return 18;
}

/** Max fraction digits to show in the UI for a given asset. */
export function getTokenDisplayDecimals(
  symbol: string | null | undefined,
  chainDecimals: number
): number {
  const raw = normalizeAssetSymbol(symbol);
  const core = raw.replace(/^CB/, '');

  // UI fraction digits (not chain decimals): stables with 6 chain dp → 3 display;
  // DAI/WETH/cbBTC use more of the chain precision in tables.
  if (core === 'USDC' || core === 'USDT' || core === 'USDBC') return 3;
  if (core === 'DAI') return Math.min(chainDecimals, 6);
  if (core === 'WETH' || core === 'ETH') return 6;
  if (core === 'BTC' || core === 'WBTC' || core === 'TBTC' || core === 'LBTC') return 6;

  const known = getKnownAssetDecimals(symbol);
  if (known != null) return Math.min(known, 6);
  return Math.min(Math.max(chainDecimals, 0), 6);
}

/** Chain + UI display decimals for token formatting (`TokenUsdValue`, tables). */
export function resolveTokenDisplayProps(
  symbol: string | null | undefined,
  apiDecimals?: number | null
): { chainDecimals: number; displayDecimals: number } {
  const chainDecimals = resolveAssetDecimals(symbol, apiDecimals ?? undefined);
  return {
    chainDecimals,
    displayDecimals: getTokenDisplayDecimals(symbol, chainDecimals),
  };
}
