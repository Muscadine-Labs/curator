import { formatLtv } from '@/lib/format/number';

/** `cbBTC/USDC` style pair label. */
export function formatMarketPairSlash(
  collateral: string | null | undefined,
  loan: string | null | undefined
): string {
  if (collateral && loan) return `${collateral}/${loan}`;
  return collateral || loan || 'Market';
}

/** `86%` / `86.5%` from Morpho LLTV (WAD, fraction, or percent). */
export function formatLltvPercentCompact(
  lltv: string | number | null | undefined
): string | null {
  const formatted = formatLtv(lltv);
  if (formatted === '—') return null;
  const parsed = parseFloat(formatted);
  if (!Number.isFinite(parsed)) return null;
  const rounded =
    Math.abs(parsed - Math.round(parsed)) < 0.05
      ? String(Math.round(parsed))
      : parsed.toFixed(1).replace(/\.0$/, '');
  return `${rounded}%`;
}

/** `cbBTC/USDC (86%)` — GraphQL market display used on bots activity. */
export function formatMarketNameWithLltv(
  collateral: string | null | undefined,
  loan: string | null | undefined,
  lltv: string | number | null | undefined
): string {
  const pair = formatMarketPairSlash(collateral, loan);
  const pct = formatLltvPercentCompact(lltv);
  return pct ? `${pair} (${pct})` : pair;
}
