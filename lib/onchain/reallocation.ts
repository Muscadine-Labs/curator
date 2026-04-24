/**
 * Pure helpers for building Morpho V1 (MetaMorpho) reallocation plans.
 *
 * Lives outside React components so the logic can be unit tested without a
 * DOM. The catcher pattern in particular has been the source of multiple
 * production reverts (`InconsistentReallocation`); keeping it in one place
 * makes it possible to assert the invariants in `__tests__/reallocation.test.ts`.
 *
 * --- Background -----------------------------------------------------------
 *
 * `MetaMorpho.reallocate(MarketAllocation[])` interprets each entry as a
 * **target** supply for that market. The contract iterates the array in
 * order: entries with `assets < currentSupply` perform a withdrawal, entries
 * with `assets > currentSupply` perform a supply. At the end it asserts
 *
 *   sum(withdrawn) == sum(supplied)            // (incl. idle)
 *
 * or it reverts with `InconsistentReallocation`.
 *
 * Between building the tx client-side and execution, every market accrues
 * interest, so the on-chain `currentSupply` drifts upwards by a tiny dust
 * amount. If we encode every target as an exact bigint, the invariant fails
 * and the tx reverts.
 *
 * Mitigation ("max catcher"): mark the LAST deposit's `assets` as
 * `type(uint256).max`. The contract then interprets that entry as
 * "supply whatever residual is needed to balance withdrawals", which exactly
 * absorbs the dust.
 *
 * To keep the catcher robust under price/utilization swings, we also pick
 * the LARGEST deposit (by delta) to be the catcher: dust is a much smaller
 * fraction of a large deposit, so the user sees the most predictable
 * behaviour.
 */

import { maxUint256, type Address } from 'viem';
import type { MarketAllocation, MarketParams } from './vault-writes';

/** Single market target as understood by the reallocation planner. */
export interface ReallocationTarget {
  /** Stable identifier (e.g. Morpho market `uniqueKey`). */
  key: string;
  /** Desired post-reallocation supply, in raw token units (bigint). */
  assets: bigint;
  /** Current on-chain supply (bigint, raw token units). */
  current: bigint;
}

/** Result of `buildV1ReallocationPlan`. Empty `allocations` ⇒ nothing to do. */
export interface ReallocationPlan {
  allocations: MarketAllocation[];
  /** Number of withdrawal entries placed first in the array. */
  withdrawalCount: number;
  /** Number of deposit entries placed after the withdrawals. */
  depositCount: number;
  /** Whether the last deposit was tagged with `maxUint256` (catcher). */
  catcherUsed: boolean;
}

/**
 * Build a V1 `reallocate` plan from a list of target supplies.
 *
 * Ordering invariants (must be preserved — the contract relies on them):
 * 1. All withdrawals (`target < current`) come first, in input order.
 * 2. Deposits (`target > current`) come after, sorted ascending by delta so
 *    that the LARGEST deposit lands last and becomes the dust catcher.
 * 3. If the plan contains at least one withdrawal, the last deposit's
 *    `assets` is replaced with `maxUint256` so the contract absorbs accrued
 *    interest dust.
 *
 * Targets equal to `current` (no-ops) are skipped.
 *
 * @param targets Per-market target supplies.
 * @param getMarketParams Lookup that resolves a key into the on-chain
 *   `MarketParams` tuple. Returning `null` skips that target (e.g. when the
 *   market metadata isn't loaded).
 */
export function buildV1ReallocationPlan(
  targets: ReadonlyArray<ReallocationTarget>,
  getMarketParams: (key: string) => MarketParams | null
): ReallocationPlan {
  const withdrawalTargets: ReallocationTarget[] = [];
  const depositTargets: ReallocationTarget[] = [];

  for (const t of targets) {
    if (t.assets < t.current) withdrawalTargets.push(t);
    else if (t.assets > t.current) depositTargets.push(t);
  }

  // Sort deposits ascending by delta so the largest is last (catcher).
  depositTargets.sort((a, b) => {
    const da = a.assets - a.current;
    const db = b.assets - b.current;
    if (da === db) return 0;
    return da < db ? -1 : 1;
  });

  const toAlloc = (
    t: ReallocationTarget,
    override?: bigint
  ): MarketAllocation | null => {
    const params = getMarketParams(t.key);
    if (!params) return null;
    return {
      marketParams: params,
      assets: override ?? t.assets,
    };
  };

  const withdrawals = withdrawalTargets
    .map((t) => toAlloc(t))
    .filter((a): a is MarketAllocation => a !== null);

  const deposits: MarketAllocation[] = [];
  let catcherUsed = false;
  for (let i = 0; i < depositTargets.length; i++) {
    const isCatcher =
      i === depositTargets.length - 1 && withdrawalTargets.length > 0;
    const alloc = toAlloc(depositTargets[i], isCatcher ? maxUint256 : undefined);
    if (alloc) {
      deposits.push(alloc);
      if (isCatcher) catcherUsed = true;
    }
  }

  return {
    allocations: [...withdrawals, ...deposits],
    withdrawalCount: withdrawals.length,
    depositCount: deposits.length,
    catcherUsed,
  };
}

/**
 * Convenience: same as {@link buildV1ReallocationPlan} but accepts a
 * `Map<string, MarketParams>`. Useful in components that already keep an
 * `allocations` map keyed by market id.
 */
export function buildV1ReallocationPlanFromMap(
  targets: ReadonlyArray<ReallocationTarget>,
  marketParamsByKey: ReadonlyMap<string, MarketParams>
): ReallocationPlan {
  return buildV1ReallocationPlan(targets, (key) => marketParamsByKey.get(key) ?? null);
}

/**
 * Strict zero-address sentinel used when resolving missing addresses.
 * Exported so consumers (e.g. AllocationV1) can reuse the same constant.
 */
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;
