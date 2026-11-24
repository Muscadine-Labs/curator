import { describe, expect, it } from 'vitest';
import { applyPlanningDust } from '@/lib/onchain/allocation-dust';

type Row = { id: string; assets: bigint };
const get = (row: Row) => row.assets;
const patch = (row: Row, assets: bigint): Row => ({ ...row, assets });

const rows: Row[] = [
  { id: 'idle', assets: 10n },
  { id: 'market', assets: 85n },
];

describe('applyPlanningDust', () => {
  it('moves an under-allocation onto the chosen row only', () => {
    const result = applyPlanningDust(rows, 100n, 0, get, patch);
    expect(result.error).toBeNull();
    expect(result.diff).toBe(5n);
    expect(result.sum).toBe(100n);
    expect(result.items.map(get)).toEqual([15n, 85n]);
    // Input is not mutated.
    expect(rows.map(get)).toEqual([10n, 85n]);
  });

  it('takes an over-allocation off the chosen row', () => {
    const result = applyPlanningDust(rows, 90n, 1, get, patch);
    expect(result.error).toBeNull();
    expect(result.items.map(get)).toEqual([10n, 80n]);
  });

  it('is a no-op when the plan already sums to the total', () => {
    const result = applyPlanningDust(rows, 95n, 0, get, patch);
    expect(result).toMatchObject({ diff: 0n, sum: 95n, error: null });
    expect(result.items.map(get)).toEqual([10n, 85n]);
  });

  it('refuses to drive the recipient negative', () => {
    const result = applyPlanningDust(rows, 80n, 0, get, patch);
    expect(result.error).toMatch(/negative/);
    expect(result.items.map(get)).toEqual([10n, 85n]);
    expect(result.sum).toBe(95n);
  });

  it('rejects an out-of-range recipient', () => {
    expect(applyPlanningDust(rows, 100n, 2, get, patch).error).toBe('Invalid dust recipient');
    expect(applyPlanningDust(rows, 100n, -1, get, patch).error).toBe('Invalid dust recipient');
  });
});
