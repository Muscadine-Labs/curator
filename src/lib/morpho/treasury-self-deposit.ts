/**
 * Match treasury self-deposits to share-increase income already booked.
 *
 * The DAY series opening point is not income. Subtracting a self-deposit that
 * created that opening (e.g. redeem underlying → deposit wrapper) would show
 * a fake loss. Only reverse income that was actually added on the same UTC day.
 */
export type IncomeBucket = { tokens: number; usd: number };

export function vaultDayKey(vaultAddress: string, day: string): string {
  return `${vaultAddress.toLowerCase()}|${day}`;
}

export function creditIncomeBucket(
  remaining: Map<string, IncomeBucket>,
  vaultAddress: string,
  day: string,
  amount: IncomeBucket
): void {
  if (!(amount.tokens > 0) && !(amount.usd > 0)) return;
  const key = vaultDayKey(vaultAddress, day);
  const cur = remaining.get(key) ?? { tokens: 0, usd: 0 };
  remaining.set(key, {
    tokens: cur.tokens + amount.tokens,
    usd: cur.usd + amount.usd,
  });
}

/**
 * Consume booked income for a self-deposit. Unmatched remainder is ignored
 * (opening balance / wrapper migration), not subtracted.
 */
export function takeMatchedIncome(
  remaining: Map<string, IncomeBucket>,
  vaultAddress: string,
  day: string,
  want: IncomeBucket
): IncomeBucket | null {
  const key = vaultDayKey(vaultAddress, day);
  const avail = remaining.get(key);
  if (!avail) return null;
  const availTokens = Math.max(0, avail.tokens);
  const availUsd = Math.max(0, avail.usd);
  let tokens: number;
  let usd: number;
  if (want.tokens > 0 && want.usd > 0 && availTokens > 0 && availUsd > 0) {
    const frac = Math.min(1, want.tokens / availTokens, want.usd / availUsd);
    tokens = availTokens * frac;
    usd = availUsd * frac;
  } else {
    tokens = Math.min(want.tokens, availTokens);
    usd = Math.min(want.usd, availUsd);
  }
  if (!(tokens > 0) && !(usd > 0)) return null;
  avail.tokens -= tokens;
  avail.usd -= usd;
  if (avail.tokens <= 1e-12 && avail.usd <= 1e-12) remaining.delete(key);
  return { tokens, usd };
}
