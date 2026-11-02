/**
 * Pure Midnight display helpers, safe to import from client components.
 * `midnight-markets.ts` is server code (REST, GraphQL, RPC, oracle decode) —
 * importing a value from it in a client component bundles all of that.
 */

export function formatLltvWad(lltv: string | null | undefined): string {
  if (!lltv) return '—';
  try {
    const pct = Number(BigInt(lltv)) / 1e16;
    if (!Number.isFinite(pct)) return '—';
    return `${pct.toFixed(0)}%`;
  } catch {
    return '—';
  }
}

export function formatWadPercent(wad: string | null | undefined, digits = 2): string {
  if (!wad) return '—';
  try {
    const pct = Number(BigInt(wad)) / 1e16;
    if (!Number.isFinite(pct)) return '—';
    return `${pct.toFixed(digits)}%`;
  } catch {
    return '—';
  }
}

/** Morpho LIF − 1 from LLTV + liquidation cursor (WAD). */
export function midnightLiquidationIncentive(
  lltvWad: string | null | undefined,
  cursorWad: string | null | undefined
): number | null {
  if (!lltvWad || !cursorWad) return null;
  try {
    const lltv = Number(BigInt(lltvWad)) / 1e18;
    const cursor = Number(BigInt(cursorWad)) / 1e18;
    const denom = lltv + cursor * (1 - lltv);
    if (!(denom > 0)) return null;
    const incentive = 1 / denom - 1;
    return Number.isFinite(incentive) ? incentive : null;
  } catch {
    return null;
  }
}

/** Still open when maturity is strictly in the future. A missing maturity is not active. */
export function isMidnightMarketActive(
  maturitySec: number,
  nowSec = Math.floor(Date.now() / 1000)
): boolean {
  return maturitySec > nowSec;
}

export function formatMidnightMaturityUtc(maturitySec: number): string {
  if (!maturitySec) return '—';
  return new Date(maturitySec * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Tenor collateral-vault receipt (`cbBTC-USDC-collat`), not a second collateral asset. */
export function isTenorCollateralShare(symbol: string | undefined): boolean {
  return Boolean(symbol && symbol.toLowerCase().endsWith('-collat'));
}

/**
 * Collaterals borrowers post. Two extras are not the pair:
 * the loan token itself (a USDC-debt market may accept USDC), and the Tenor
 * collateral-vault share (`cbBTC-USDC-collat`), which is a receipt for the
 * real collateral. Keep an extra only when nothing else is listed.
 */
export function selectMidnightCollaterals<T extends { token: string; symbol?: string }>(
  collaterals: readonly T[],
  loanAddress: string
): T[] {
  const loan = loanAddress.toLowerCase();
  const notLoan = collaterals.filter((c) => c.token.toLowerCase() !== loan);
  const pool = notLoan.length > 0 ? notLoan : [...collaterals];
  const withoutShares = pool.filter((c) => !isTenorCollateralShare(c.symbol));
  return withoutShares.length > 0 ? withoutShares : pool;
}
