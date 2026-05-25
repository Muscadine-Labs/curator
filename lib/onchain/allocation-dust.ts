/**
 * Client-side planning dust: when target inputs don't sum exactly to vault
 * total (common in % mode), push the remainder onto a chosen row before submit.
 */

export type DustRecipientChoice = 'auto' | string;

export function resolveDustRecipientIndex<T>(
  items: ReadonlyArray<T>,
  choice: DustRecipientChoice,
  getKey: (item: T, index: number) => string,
  pickAutoIndex: (items: ReadonlyArray<T>) => number
): number {
  if (items.length === 0) return -1;
  if (choice === 'auto') return pickAutoIndex(items);
  const idx = items.findIndex((item, i) => getKey(item, i) === choice);
  return idx >= 0 ? idx : pickAutoIndex(items);
}

export function pickLargestAssetsIndex<T>(
  items: ReadonlyArray<T>,
  getAssets: (item: T) => bigint
): number {
  if (items.length === 0) return -1;
  let bestIdx = 0;
  let best = getAssets(items[0]);
  for (let i = 1; i < items.length; i++) {
    const v = getAssets(items[i]);
    if (v > best) {
      best = v;
      bestIdx = i;
    }
  }
  return bestIdx;
}

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
