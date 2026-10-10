/** Morpho utilization is a fraction. 1.2 means 120%, not 1.2 percentage points. */
export function utilizationFractionToPercentagePoints(
  raw: number | null | undefined
): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null;
  return raw * 100;
}
