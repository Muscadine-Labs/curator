import type { Address, Hex, PublicClient } from 'viem';
import { clampDeallocateAmount } from '@/lib/format/allocation-display';
import { vaultV2Abi } from '@/lib/onchain/abis';
import { v2WriteConfigs } from '@/lib/onchain/vault-writes';

export type RebalanceTarget = {
  label: string;
  adapterAddress: string;
  data: Hex;
  /** keccak256(idData) — used to read live `allocation(id)` before submit. */
  capIdHash?: Hex;
  isVaultIdle?: boolean;
  absoluteCapRaw: bigint | null;
  relativeCapWad: bigint | null;
};

export type RebalancePlanRow = {
  target: RebalanceTarget;
  assets: bigint;
  current: bigint;
};

const WAD = BigInt('1000000000000000000');

export type AllocationRowSnapshot = {
  isVaultIdle?: boolean;
  currentAssets: bigint;
};

export type ResolveRowAssetsFn = (rowIndex: number) => bigint;

/** On-chain idle plus tokens freed by planned deallocations on other strategy rows. */
export function computeDeployableIdle(
  targets: ReadonlyArray<AllocationRowSnapshot>,
  resolveRowAssets: ResolveRowAssetsFn,
  excludeRowIndex: number
): bigint {
  const idleIdx = targets.findIndex((t) => t.isVaultIdle);
  let deployable =
    idleIdx >= 0 ? (targets[idleIdx]?.currentAssets ?? BigInt(0)) : BigInt(0);

  for (let i = 0; i < targets.length; i++) {
    if (i === excludeRowIndex || targets[i]?.isVaultIdle) continue;
    const current = targets[i]!.currentAssets;
    const planned = resolveRowAssets(i);
    if (planned < current) {
      deployable += current - planned;
    }
  }

  return deployable;
}

/** Idle target that balances strategy rows to vault total (for Max / dust planning). */
export function computeIdleTargetFromStrategyPlan(
  totalRaw: bigint,
  targets: ReadonlyArray<Pick<RebalanceTarget, 'isVaultIdle'>>,
  resolveRowAssets: ResolveRowAssetsFn
): bigint {
  let strategySum = BigInt(0);
  for (let i = 0; i < targets.length; i++) {
    if (targets[i]?.isVaultIdle) continue;
    strategySum += resolveRowAssets(i);
  }
  const idle = totalRaw - strategySum;
  return idle > BigInt(0) ? idle : BigInt(0);
}

/** Maximum absolute target this row can hold under known caps (Morpho V2 firstTotalAssets proxy). */
export function maxTargetForRow(
  t: Pick<RebalanceTarget, 'isVaultIdle' | 'absoluteCapRaw' | 'relativeCapWad'>,
  totalRaw: bigint
): bigint {
  if (t.isVaultIdle) return totalRaw;

  let max = totalRaw;
  if (t.absoluteCapRaw != null && max > t.absoluteCapRaw) {
    max = t.absoluteCapRaw;
  }
  if (t.relativeCapWad != null && totalRaw > BigInt(0)) {
    const maxRel = (totalRaw * t.relativeCapWad) / WAD;
    if (max > maxRel) max = maxRel;
  }
  return max;
}

/** Idle that can be deployed onto a strategy row (cap headroom), excluding current allocation. */
export function idleDeployAmount(
  current: bigint,
  t: Pick<RebalanceTarget, 'isVaultIdle' | 'absoluteCapRaw' | 'relativeCapWad'>,
  totalRaw: bigint,
  idleRaw: bigint
): bigint {
  if (t.isVaultIdle || idleRaw <= BigInt(0)) return BigInt(0);

  let deploy = idleRaw;
  if (t.absoluteCapRaw != null) {
    const headroom = t.absoluteCapRaw - current;
    if (headroom <= BigInt(0)) return BigInt(0);
    if (deploy > headroom) deploy = headroom;
  }
  if (t.relativeCapWad != null && totalRaw > BigInt(0)) {
    const maxRel = (totalRaw * t.relativeCapWad) / WAD;
    const headroom = maxRel - current;
    if (headroom <= BigInt(0)) return BigInt(0);
    if (deploy > headroom) deploy = headroom;
  }
  return deploy;
}

/** Target after deploying all available idle onto this row; other rows unchanged. */
export function maxTargetFromIdleDeploy(
  current: bigint,
  t: Pick<RebalanceTarget, 'isVaultIdle' | 'absoluteCapRaw' | 'relativeCapWad'>,
  totalRaw: bigint,
  deployableIdle: bigint
): bigint {
  if (t.isVaultIdle) return deployableIdle;
  return current + idleDeployAmount(current, t, totalRaw, deployableIdle);
}

/** Human percentage string for allocation edit inputs (two decimal places). */
export function rawToPercentInput(raw: bigint, totalRaw: bigint): string {
  if (totalRaw <= BigInt(0)) return '0';
  return (Number((raw * BigInt(10000)) / totalRaw) / 100).toFixed(2);
}

/** Trim planning overshoot (e.g. percentage rounding) so row targets sum to vault total. */
export function trimPlanToVaultTotal(
  rows: ReadonlyArray<RebalancePlanRow>,
  totalRaw: bigint
): RebalancePlanRow[] {
  const list = rows.map((r) => ({ ...r, target: { ...r.target } }));
  let excess = list.reduce((s, r) => s + r.assets, BigInt(0)) - totalRaw;
  if (excess <= BigInt(0)) return list;

  const idleIdx = list.findIndex((r) => r.target.isVaultIdle);
  if (idleIdx >= 0 && list[idleIdx]!.assets > BigInt(0)) {
    const trim =
      list[idleIdx]!.assets >= excess ? excess : list[idleIdx]!.assets;
    list[idleIdx] = { ...list[idleIdx]!, assets: list[idleIdx]!.assets - trim };
    excess -= trim;
  }

  while (excess > BigInt(0)) {
    let pick = -1;
    let reducible = BigInt(0);
    for (let i = 0; i < list.length; i++) {
      const row = list[i]!;
      const headroom = row.target.isVaultIdle
        ? row.assets
        : row.assets > row.current
          ? row.assets - row.current
          : row.assets;
      if (headroom > reducible) {
        reducible = headroom;
        pick = i;
      }
    }
    if (pick < 0 || reducible === BigInt(0)) break;
    const step = excess > reducible ? reducible : excess;
    list[pick] = { ...list[pick]!, assets: list[pick]!.assets - step };
    excess -= step;
  }

  return list;
}

/**
 * Validate planned targets against on-chain totalAssets at submit time.
 * Surplus from interest accrual stays implicit idle — never inflate strategy allocates.
 */
export function applySubmitTimeSurplus(
  rows: ReadonlyArray<RebalancePlanRow>,
  chainTotalAssets: bigint
): { rows: RebalancePlanRow[]; surplus: bigint; error: string | null } {
  const list = rows.map((r) => ({ ...r }));
  const plannedSum = list.reduce((s, r) => s + r.assets, BigInt(0));
  const surplus = chainTotalAssets - plannedSum;

  if (surplus < BigInt(0)) {
    return {
      rows: list,
      surplus,
      error: 'Planned allocation exceeds on-chain vault total — refresh and replan.',
    };
  }

  return { rows: list, surplus, error: null };
}

/** Deployable vault cash before same-tx deallocations (Morpho GraphQL idleAssets). */
export function resolveDeployableIdleBase(
  rows: ReadonlyArray<RebalancePlanRow>
): bigint {
  const idleRow = rows.find((r) => r.target.isVaultIdle);
  return idleRow?.current ?? BigInt(0);
}

/** Reduce allocate targets until net allocate fits deployable idle plus same-tx deallocations. */
export function clampPlanToFundableIdle(
  rows: ReadonlyArray<RebalancePlanRow>,
  deployableIdleBase?: bigint
): RebalancePlanRow[] {
  const list = rows.map((r) => ({ ...r, target: { ...r.target } }));
  const idleBase = deployableIdleBase ?? resolveDeployableIdleBase(list);

  let deallocateSum = BigInt(0);
  let netAllocate = BigInt(0);
  const allocIndices: number[] = [];

  for (let i = 0; i < list.length; i++) {
    const r = list[i]!;
    if (r.target.isVaultIdle) continue;
    if (r.assets > r.current) {
      netAllocate += r.assets - r.current;
      allocIndices.push(i);
    } else if (r.assets < r.current) {
      const delta =
        r.assets === 0n
          ? r.current
          : clampDeallocateAmount(r.current - r.assets, r.current);
      deallocateSum += delta;
    }
  }

  const maxNetAllocate = idleBase + deallocateSum;
  if (netAllocate <= maxNetAllocate) return list;

  let excess = netAllocate - maxNetAllocate;
  allocIndices.sort((a, b) => {
    const da = list[a]!.assets - list[a]!.current;
    const db = list[b]!.assets - list[b]!.current;
    if (da === db) return 0;
    return da > db ? -1 : 1;
  });

  for (const idx of allocIndices) {
    if (excess <= BigInt(0)) break;
    const row = list[idx]!;
    const delta = row.assets - row.current;
    if (delta <= BigInt(0)) continue;
    const step = excess > delta ? delta : excess;
    list[idx] = { ...row, assets: row.assets - step };
    excess -= step;
  }

  return list;
}

/** Refresh strategy row `current` from live `allocation(id)` before building calldata. */
export async function refreshPlanRowsFromChain(
  client: PublicClient,
  vaultAddress: string,
  rows: ReadonlyArray<RebalancePlanRow>
): Promise<RebalancePlanRow[]> {
  const vault = vaultAddress as Address;
  const indices: number[] = [];
  const contracts: {
    address: Address;
    abi: typeof vaultV2Abi;
    functionName: 'allocation';
    args: readonly [Hex];
  }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.target.isVaultIdle || !row.target.capIdHash) continue;
    indices.push(i);
    contracts.push({
      address: vault,
      abi: vaultV2Abi,
      functionName: 'allocation',
      args: [row.target.capIdHash],
    });
  }

  if (contracts.length === 0) {
    return rows.map((r) => ({ ...r }));
  }

  const results = await client.multicall({ contracts, allowFailure: true });
  const list = rows.map((r) => ({ ...r, target: { ...r.target } }));

  indices.forEach((rowIdx, j) => {
    const result = results[j];
    if (result?.status === 'success') {
      list[rowIdx] = { ...list[rowIdx]!, current: result.result };
    }
  });

  return list;
}

/** Ensure allocate deltas can be funded from deployable idle after deallocations in the same multicall. */
export function validateIdleFunding(
  rows: ReadonlyArray<RebalancePlanRow>,
  deployableIdleBase?: bigint
): string | null {
  const idleBase = deployableIdleBase ?? resolveDeployableIdleBase(rows);

  let netAllocate = BigInt(0);
  let deallocateSum = BigInt(0);

  for (const r of rows) {
    if (r.target.isVaultIdle) continue;
    if (r.assets > r.current) {
      netAllocate += r.assets - r.current;
    } else if (r.assets < r.current) {
      const delta =
        r.assets === 0n
          ? r.current
          : clampDeallocateAmount(r.current - r.assets, r.current);
      deallocateSum += delta;
    }
  }

  const idleAfterDealloc = idleBase + deallocateSum;
  if (netAllocate > idleAfterDealloc) {
    return 'Insufficient idle to fund allocations — deallocate more first (vault idle cash is fully deployed).';
  }

  return null;
}

export function buildRebalanceMulticallData(rows: ReadonlyArray<RebalancePlanRow>): {
  deallocCalls: Hex[];
  allocCalls: Hex[];
} {
  const deallocCalls: Hex[] = [];
  const allocCalls: Hex[] = [];

  for (const r of rows) {
    if (r.target.isVaultIdle || r.assets === r.current) continue;

    if (r.assets < r.current) {
      const delta =
        r.assets === 0n
          ? r.current
          : clampDeallocateAmount(r.current - r.assets, r.current);
      if (delta <= 0n) continue;
      deallocCalls.push(
        v2WriteConfigs.encodeDeallocate(
          r.target.adapterAddress as Address,
          r.target.data,
          delta
        )
      );
    } else {
      const delta = r.assets - r.current;
      if (delta <= 0n) continue;
      allocCalls.push(
        v2WriteConfigs.encodeAllocate(
          r.target.adapterAddress as Address,
          r.target.data,
          delta
        )
      );
    }
  }

  return { deallocCalls, allocCalls };
}
