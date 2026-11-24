/** Shared Loan / Collateral / pair search for Blue + Midnight browse tables. */

export type MarketPairFilterInput = {
  search: string;
  loanFilter: string;
  collateralFilter: string;
};

function normalizeTokenText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[/\-_|,·]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function queryTokens(value: string): string[] {
  return normalizeTokenText(value).split(' ').filter(Boolean);
}

/** Hex market-id fragment — not a ticker like "eth" that can sit inside "weth". */
function looksLikeIdFragment(token: string): boolean {
  if (token.startsWith('0x') && token.length >= 4) return true;
  return token.length >= 8 && /^[0-9a-f]+$/.test(token);
}

function symbolMatches(symbol: string, query: string): boolean {
  const s = normalizeTokenText(symbol);
  if (!s || !query) return false;
  return s === query || s.startsWith(query) || s.includes(` ${query}`) || s.endsWith(` ${query}`);
}

export function marketMatchesPairFilters(
  market: {
    loanSymbol: string;
    collateralSymbols: readonly string[];
    marketId: string;
  },
  filters: MarketPairFilterInput
): boolean {
  const loanQ = normalizeTokenText(filters.loanFilter);
  const colQ = normalizeTokenText(filters.collateralFilter);
  const collaterals = market.collateralSymbols.filter(Boolean);

  if (loanQ && !symbolMatches(market.loanSymbol, loanQ)) return false;
  if (colQ && !collaterals.some((s) => symbolMatches(s, colQ))) return false;

  const q = filters.search.trim();
  if (!q) return true;

  const id = market.marketId.toLowerCase();
  const symbolWords = queryTokens(
    [market.loanSymbol, ...collaterals].join(' ')
  );

  return queryTokens(q).every((token) => {
    if (looksLikeIdFragment(token)) {
      return id.includes(token) || id.includes(token.replace(/^0x/, ''));
    }
    return symbolWords.some((word) => word === token || word.startsWith(token));
  });
}
