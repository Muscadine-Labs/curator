/**
 * Client-side planning dust: when target inputs don't sum exactly to vault
 * total (common in % mode), push the remainder onto a chosen row before submit.
 */

export type DustRecipientChoice = 'auto' | string;

export function applyPlanningDust<T>(
  items: ReadonlyArray<T>,
  totalRaw: bigint,
  recipientIndex: number,
  getAssets: (item: T) => bigint,
  patchAssets: (item: T, assets: bigint) => T
): {
  items: T[];
  sum: bigint;
  diff: bigint;
  error: string | null;
} {
  const list = [...items];
  if (recipientIndex < 0 || recipientIndex >= list.length) {
    return {
      items: list,
      sum: list.reduce((s, t) => s + getAssets(t), BigInt(0)),
      diff: BigInt(0),
      error: 'Invalid dust recipient',
    };
  }

  let sum = list.reduce((s, t) => s + getAssets(t), BigInt(0));
  const diff = totalRaw - sum;
  if (diff === BigInt(0)) {
    return { items: list, sum, diff: BigInt(0), error: null };
  }

  const patched = patchAssets(list[recipientIndex], getAssets(list[recipientIndex]) + diff);
  if (getAssets(patched) < BigInt(0)) {
    return { items: list, sum, diff, error: 'Allocation would go negative after dust adjustment' };
  }

  list[recipientIndex] = patched;
  return { items: list, sum: totalRaw, diff, error: null };
}
