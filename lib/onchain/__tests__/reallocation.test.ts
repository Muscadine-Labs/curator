/**
 * @jest-environment node
 *
 * Tests for `lib/onchain/reallocation.ts`.
 *
 * The catcher pattern (last deposit = `type(uint256).max`) protects V1
 * reallocations from `InconsistentReallocation` reverts caused by interest
 * accruing between read and write. Regressing it has caused real production
 * incidents, so the contract enforced here is:
 *
 *   - Withdrawals come first, in their input order.
 *   - Deposits come next, sorted ascending by delta so the LARGEST is last.
 *   - If at least one withdrawal exists, the LAST deposit's `assets` is
 *     `maxUint256` (the "catcher").
 *   - Pure no-ops (`assets === current`) are dropped.
 */

import { type Address, decodeFunctionData, encodeFunctionData, maxUint256 } from 'viem';
import { metaMorphoV1Abi } from '../abis';
import { v1WriteConfigs, type MarketParams } from '../vault-writes';
import {
  buildV1ReallocationPlan,
  buildV1ReallocationPlanFromMap,
  ZERO_ADDRESS,
  type ReallocationTarget,
} from '../reallocation';

const VAULT: Address = '0x0000000000000000000000000000000000000a11';

function paramsFor(key: string): MarketParams {
  // Distinguishable but valid-looking MarketParams for each key. Use the
  // lowercase hex tag of the first char of `key` to produce a 20-byte
  // address that passes viem's checksum check.
  const tag = key.toLowerCase().charCodeAt(0).toString(16).padStart(2, '0');
  return {
    loanToken: (`0x${tag.repeat(20)}`) as Address,
    collateralToken: ZERO_ADDRESS,
    oracle: ZERO_ADDRESS,
    irm: ZERO_ADDRESS,
    lltv: 0n,
  };
}

describe('buildV1ReallocationPlan', () => {
  test('returns empty plan when no targets change', () => {
    const targets: ReallocationTarget[] = [
      { key: 'A', assets: 100n, current: 100n },
      { key: 'B', assets: 50n, current: 50n },
    ];
    const plan = buildV1ReallocationPlan(targets, paramsFor);
    expect(plan.allocations).toHaveLength(0);
    expect(plan.withdrawalCount).toBe(0);
    expect(plan.depositCount).toBe(0);
    expect(plan.catcherUsed).toBe(false);
  });

  test('orders withdrawals before deposits and tags the largest deposit as catcher', () => {
    // A: 1000 → 700 (withdraw 300)
    // B: 200 → 800 (deposit +600)  ← largest delta, should be catcher
    // C: 500 → 600 (deposit +100)
    const targets: ReallocationTarget[] = [
      { key: 'A', assets: 700n, current: 1000n },
      { key: 'B', assets: 800n, current: 200n },
      { key: 'C', assets: 600n, current: 500n },
    ];
    const plan = buildV1ReallocationPlan(targets, paramsFor);
    expect(plan.withdrawalCount).toBe(1);
    expect(plan.depositCount).toBe(2);
    expect(plan.catcherUsed).toBe(true);
    expect(plan.allocations).toHaveLength(3);

    // Withdrawal first.
    expect(plan.allocations[0].assets).toBe(700n);
    // Smaller deposit (C) before larger (B).
    expect(plan.allocations[1].assets).toBe(600n);
    // Largest deposit is the catcher: maxUint256.
    expect(plan.allocations[2].assets).toBe(maxUint256);
  });

  test('does NOT use the catcher when there are no withdrawals (pure deposit plan)', () => {
    const targets: ReallocationTarget[] = [
      { key: 'A', assets: 200n, current: 100n },
      { key: 'B', assets: 500n, current: 100n },
    ];
    const plan = buildV1ReallocationPlan(targets, paramsFor);
    expect(plan.withdrawalCount).toBe(0);
    expect(plan.depositCount).toBe(2);
    expect(plan.catcherUsed).toBe(false);
    // Both deposits keep their numeric targets.
    expect(plan.allocations.every((a) => a.assets !== maxUint256)).toBe(true);
  });

  test('handles withdrawal-only plan (no deposits to catch)', () => {
    const targets: ReallocationTarget[] = [
      { key: 'A', assets: 100n, current: 200n },
      { key: 'B', assets: 0n, current: 50n },
    ];
    const plan = buildV1ReallocationPlan(targets, paramsFor);
    expect(plan.withdrawalCount).toBe(2);
    expect(plan.depositCount).toBe(0);
    expect(plan.catcherUsed).toBe(false);
    expect(plan.allocations).toHaveLength(2);
  });

  test('skips targets whose MarketParams are missing', () => {
    const targets: ReallocationTarget[] = [
      { key: 'A', assets: 700n, current: 1000n },
      { key: 'B', assets: 800n, current: 200n },
      { key: 'MISSING', assets: 600n, current: 500n },
    ];
    const plan = buildV1ReallocationPlan(targets, (k) =>
      k === 'MISSING' ? null : paramsFor(k)
    );
    // 1 withdrawal + 1 deposit (the MISSING deposit is dropped).
    expect(plan.withdrawalCount).toBe(1);
    expect(plan.depositCount).toBe(1);
    // The single remaining deposit becomes the catcher because there's also
    // a withdrawal.
    expect(plan.catcherUsed).toBe(true);
    expect(plan.allocations[1].assets).toBe(maxUint256);
  });

  test('plan output round-trips through v1WriteConfigs.reallocate + encodeFunctionData', () => {
    const targets: ReallocationTarget[] = [
      { key: 'A', assets: 700n, current: 1000n },
      { key: 'B', assets: 800n, current: 200n },
      { key: 'C', assets: 600n, current: 500n },
    ];
    const plan = buildV1ReallocationPlan(targets, paramsFor);
    const cfg = v1WriteConfigs.reallocate(VAULT, plan.allocations);
    const data = encodeFunctionData(cfg);
    const decoded = decodeFunctionData({ abi: metaMorphoV1Abi, data });
    expect(decoded.functionName).toBe('reallocate');
    const list = (decoded.args as readonly [readonly { assets: bigint }[]])[0];
    expect(list).toHaveLength(3);
    // Last entry is the catcher.
    expect(list[2].assets).toBe(maxUint256);
  });

  test('Map variant is equivalent to the function variant', () => {
    const targets: ReallocationTarget[] = [
      { key: 'A', assets: 700n, current: 1000n },
      { key: 'B', assets: 800n, current: 200n },
    ];
    const map = new Map<string, MarketParams>([
      ['A', paramsFor('A')],
      ['B', paramsFor('B')],
    ]);
    const fromMap = buildV1ReallocationPlanFromMap(targets, map);
    const fromFn = buildV1ReallocationPlan(targets, paramsFor);
    expect(fromMap.allocations).toHaveLength(fromFn.allocations.length);
    expect(fromMap.allocations[0].assets).toBe(fromFn.allocations[0].assets);
    expect(fromMap.allocations[1].assets).toBe(fromFn.allocations[1].assets);
    expect(fromMap.catcherUsed).toBe(fromFn.catcherUsed);
  });

  test('stable when two deposits have identical deltas', () => {
    const targets: ReallocationTarget[] = [
      { key: 'A', assets: 0n, current: 100n },
      { key: 'B', assets: 200n, current: 100n },
      { key: 'C', assets: 300n, current: 200n },
    ];
    const plan = buildV1ReallocationPlan(targets, paramsFor);
    expect(plan.withdrawalCount).toBe(1);
    expect(plan.depositCount).toBe(2);
    expect(plan.allocations).toHaveLength(3);
    // The last deposit should be the catcher regardless of which equal-delta
    // entry tied-broke into last position.
    expect(plan.allocations[2].assets).toBe(maxUint256);
  });
});
