/**
 * Ratio helpers that keep wei/share amounts in bigint until the last Number()
 * on a scaled 1e18 fraction (safe for display USD).
 */

const SCALE = 10n ** 18n;

/** `numerator / denominator` as a JS number (18-decimal fixed point). */
export function bigintRatio(numerator: bigint, denominator: bigint): number {
  if (denominator === 0n) return 0;
  if (numerator === 0n) return 0;
  const sign = numerator < 0n !== denominator < 0n ? -1 : 1;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  return (sign * Number((n * SCALE) / d)) / 1e18;
}

/** `(amount / total) * scale` without floating the raw amounts. */
export function bigintShareOf(amount: bigint, total: bigint, scale: number): number {
  return bigintRatio(amount, total) * scale;
}
