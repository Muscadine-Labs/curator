/**
 * Integer query param clamped to `[min, max]`. Missing, non-numeric, or
 * fractional junk falls back to `fallback` instead of reaching GraphQL (where
 * NaN fails variable validation) or a server cache key.
 */
export function parseBoundedIntParam(
  value: string | null,
  fallback: number,
  { min, max }: { min: number; max: number }
): number {
  if (value == null || value.trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), min), max);
}
