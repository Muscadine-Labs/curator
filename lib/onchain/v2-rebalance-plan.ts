import { keccak256, type Address, type Hex, type PublicClient } from 'viem';
import type { CapInfo } from '@/app/api/vaults/[id]/governance/route';
import { clampDeallocateAmount, formatCapDisplayAmount } from '@/lib/format/allocation-display';
import { isAdapterCap, isCollateralCap, isMarketCap } from '@/lib/morpho/cap-utils';
import {
  encodeAdapterCapIdData,
  encodeCollateralCapIdData,
  resolveCapIdData,
} from '@/lib/morpho/v2-id-data';
import { vaultV2Abi } from '@/lib/onchain/abis';
import { erc20ApproveAbi } from '@/lib/onchain/vault-v2-factory';
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
  symbol?: string;
  decimals?: number;
  /** Economic position incl. interest — on-chain allocate writes this, not booked. */
  displayAssets?: bigint;
  /** Blue market collateral; omitted for idle / vault-adapter rows. */
  collateralAddress?: string | null;
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

/** Idle that can be deployed onto a strategy row (cap headroom), excluding current allocation. */
export function idleDeployAmount(
  occupancy: bigint,
  t: Pick<RebalanceTarget, 'isVaultIdle' | 'absoluteCapRaw' | 'relativeCapWad'>,
  totalRaw: bigint,
  idleRaw: bigint
): bigint {
  if (t.isVaultIdle || idleRaw <= BigInt(0)) return BigInt(0);

  let deploy = idleRaw;
  if (t.absoluteCapRaw != null) {
    const headroom = t.absoluteCapRaw - occupancy;
    if (headroom <= BigInt(0)) return BigInt(0);
    if (deploy > headroom) deploy = headroom;
  }
  if (t.relativeCapWad != null && totalRaw > BigInt(0)) {
    const maxRel = (totalRaw * t.relativeCapWad) / WAD;
    const headroom = maxRel - occupancy;
    if (headroom <= BigInt(0)) return BigInt(0);
    if (deploy > headroom) deploy = headroom;
  }
  return deploy;
}

/**
 * Booked target after deploying idle onto this row.
 * `occupancy` is the amount Morpho will count against caps after allocate
 * (display/real, including interest). Defaults to `booked` for callers that
 * do not track a display/booked split.
 */
export function maxTargetFromIdleDeploy(
  booked: bigint,
  t: Pick<RebalanceTarget, 'isVaultIdle' | 'absoluteCapRaw' | 'relativeCapWad'>,
  totalRaw: bigint,
  deployableIdle: bigint,
  occupancy: bigint = booked
): bigint {
  if (t.isVaultIdle) return deployableIdle;
  return booked + idleDeployAmount(occupancy, t, totalRaw, deployableIdle);
}

/**
 * Idle left after Max on a strategy row (deployable basis — not totalAssets residual).
 * Cap headroom can leave unused deployable cash on Idle.
 */
export function remainingDeployableIdleAfterMax(
  current: bigint,
  maxTarget: bigint,
  deployableIdle: bigint
): bigint {
  const deployed = maxTarget > current ? maxTarget - current : 0n;
  const left = deployableIdle - deployed;
  return left > 0n ? left : 0n;
}

/**
 * Min target for a strategy row: cannot withdraw more than market liquidity.
 * When liquidity ≥ allocation, Min = 0; otherwise leave the illiquid remainder.
 */
export function minTargetFromLiquidity(
  current: bigint,
  liquidityAssets: bigint | null | undefined
): bigint {
  if (liquidityAssets == null) return 0n;
  if (liquidityAssets <= 0n) return current;
  if (liquidityAssets >= current) return 0n;
  return current - liquidityAssets;
}

/** Scale factor for percentage inputs with two decimal places (100.00% → 10000). */
const PCT_INPUT_SCALE = 10000n;

/** Convert raw token amount to a percentage input string (two decimal places). */
export function rawToPercentInput(raw: bigint, totalRaw: bigint): string {
  if (totalRaw <= BigInt(0)) return '0.00';
  const pctScaled = (raw * PCT_INPUT_SCALE) / totalRaw;
  const whole = pctScaled / 100n;
  const frac = pctScaled % 100n;
  return `${whole.toString()}.${frac.toString().padStart(2, '0')}`;
}

/** Parse a human percentage string to raw token amount. */
export function percentInputToRaw(
  pctStr: string,
  totalRaw: bigint
): { assets: bigint; error: string | null } {
  const pct = Number.parseFloat(pctStr.trim());
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    return { assets: BigInt(0), error: 'Invalid percentage' };
  }
  const pctScaled = BigInt(Math.round(pct * 100));
  return { assets: (totalRaw * pctScaled) / PCT_INPUT_SCALE, error: null };
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

const ALLOCATION_READ_ERROR =
  'Failed to read live allocation(id) — refresh and retry.';
const MISSING_ALLOCATION_ID_ERROR =
  'Missing allocation id for a strategy row — refresh and retry.';
const IDLE_READ_ERROR = 'Failed to read vault idle cash — refresh and retry.';

/**
 * If the user left a row unchanged (`assets === current`), keep it a no-op after
 * live `allocation(id)` refresh. Otherwise interest/indexer drift turns those
 * rows into phantom alloc/dealloc in the multicall.
 */
export function snapUnchangedTargetsToLiveCurrent(
  row: RebalancePlanRow,
  liveCurrent: bigint
): RebalancePlanRow {
  const leaveUnchanged = row.assets === row.current;
  return {
    ...row,
    current: liveCurrent,
    assets: leaveUnchanged ? liveCurrent : row.assets,
  };
}

/** Reread adapter/collateral/market `allocation(id)` so cap checks are not stale snapshots. */
export async function refreshCapIdAllocations(
  client: PublicClient,
  vaultAddress: Address,
  capsById: Map<string, CapIdState>
): Promise<{ caps: Map<string, CapIdState>; error: string | null }> {
  const ids = [...capsById.keys()];
  if (ids.length === 0) return { caps: capsById, error: null };

  const results = await client.multicall({
    contracts: ids.map((id) => ({
      address: vaultAddress,
      abi: vaultV2Abi,
      functionName: 'allocation' as const,
      args: [id as Hex],
    })),
    allowFailure: true,
  });

  const next = new Map(capsById);
  for (let i = 0; i < ids.length; i++) {
    const result = results[i];
    if (result?.status !== 'success') {
      return { caps: next, error: ALLOCATION_READ_ERROR };
    }
    const prev = next.get(ids[i]!);
    if (!prev) continue;
    next.set(ids[i]!, { ...prev, allocation: result.result });
  }
  return { caps: next, error: null };
}

/** Refresh strategy row `current` from live `allocation(id)` before building calldata. */
export async function refreshPlanRowsFromChain(
  client: PublicClient,
  vaultAddress: string,
  rows: ReadonlyArray<RebalancePlanRow>
): Promise<{ rows: RebalancePlanRow[]; error: string | null }> {
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
    if (row.target.isVaultIdle) continue;
    if (!row.target.capIdHash) {
      return { rows: rows.map((r) => ({ ...r })), error: MISSING_ALLOCATION_ID_ERROR };
    }
    indices.push(i);
    contracts.push({
      address: vault,
      abi: vaultV2Abi,
      functionName: 'allocation',
      args: [row.target.capIdHash],
    });
  }

  const list = rows.map((r) => ({ ...r, target: { ...r.target } }));
  if (contracts.length > 0) {
    const results = await client.multicall({ contracts, allowFailure: true });
    for (let j = 0; j < indices.length; j++) {
      const result = results[j];
      if (result?.status !== 'success') {
        return { rows: list, error: ALLOCATION_READ_ERROR };
      }
      const rowIdx = indices[j]!;
      list[rowIdx] = snapUnchangedTargetsToLiveCurrent(list[rowIdx]!, result.result);
    }
  }

  const idleIdx = list.findIndex((r) => r.target.isVaultIdle);
  if (idleIdx >= 0) {
    try {
      const asset = await client.readContract({
        address: vault,
        abi: vaultV2Abi,
        functionName: 'asset',
      });
      const idleCash = await client.readContract({
        address: asset,
        abi: erc20ApproveAbi,
        functionName: 'balanceOf',
        args: [vault],
      });
      list[idleIdx] = snapUnchangedTargetsToLiveCurrent(list[idleIdx]!, idleCash);
    } catch {
      return { rows: list, error: IDLE_READ_ERROR };
    }
  }

  return { rows: list, error: null };
}

/** Refresh on-chain currents and validate total + idle funding (shared by preview + submit). */
export async function finalizeRebalancePlan(
  client: PublicClient,
  vaultAddress: string,
  rows: ReadonlyArray<RebalancePlanRow>,
  chainTotalAssets: bigint,
  capsById?: Map<string, CapIdState>
): Promise<{
  rows: RebalancePlanRow[];
  error: string | null;
  clampWarning: string | null;
}> {
  const refreshed = await refreshPlanRowsFromChain(client, vaultAddress, rows);
  if (refreshed.error) {
    return { rows: refreshed.rows, error: refreshed.error, clampWarning: null };
  }
  let plan = refreshed.rows;

  const surplusResult = applySubmitTimeSurplus(plan, chainTotalAssets);
  if (surplusResult.error) {
    return { rows: plan, error: surplusResult.error, clampWarning: null };
  }
  plan = surplusResult.rows;

  const fundingError = validateIdleFunding(plan);
  if (fundingError) {
    return { rows: plan, error: fundingError, clampWarning: null };
  }

  if (capsById && capsById.size > 0) {
    const capRefresh = await refreshCapIdAllocations(
      client,
      vaultAddress as Address,
      capsById
    );
    if (capRefresh.error) {
      return { rows: plan, error: capRefresh.error, clampWarning: null };
    }
    const capError = validateRebalanceCapIds(plan, capRefresh.caps, chainTotalAssets);
    if (capError) {
      return { rows: plan, error: capError, clampWarning: null };
    }
  }

  return {
    rows: plan,
    error: null,
    clampWarning: null,
  };
}

export type RebalanceFundingSummary = {
  deployableIdle: bigint;
  deallocateSum: bigint;
  netAllocate: bigint;
  fundable: bigint;
  shortfall: bigint;
};

/** Net allocate demand vs vault idle plus same-tx deallocations. */
export function summarizeRebalanceFunding(
  rows: ReadonlyArray<RebalancePlanRow>,
  deployableIdleBase?: bigint
): RebalanceFundingSummary {
  const deployableIdle = deployableIdleBase ?? resolveDeployableIdleBase(rows);

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

  const fundable = deployableIdle + deallocateSum;
  const shortfall = netAllocate > fundable ? netAllocate - fundable : BigInt(0);

  return { deployableIdle, deallocateSum, netAllocate, fundable, shortfall };
}

export const INSUFFICIENT_IDLE_FUNDING_ERROR =
  'Insufficient idle to fund allocations — deallocate from other markets first (or Min a row to free capital). Vault idle cash is fully deployed.';

const UINT128_MAX = (1n << 128n) - 1n;

function isUncapped(value: bigint): boolean {
  return value === UINT128_MAX || value >= 10n ** 30n;
}

function parseCapBigInt(value: string | null | undefined): bigint | null {
  if (value == null || value === '') return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

export type CapIdKind = 'adapter' | 'collateral' | 'market';

export type CapIdState = {
  id: string;
  kind: CapIdKind;
  absoluteCap: bigint | null;
  relativeCapWad: bigint | null;
  allocation: bigint;
};

export function capKindForCap(cap: CapInfo): CapIdKind {
  if (isAdapterCap(cap)) return 'adapter';
  if (isCollateralCap(cap)) return 'collateral';
  if (isMarketCap(cap)) return 'market';
  return 'adapter';
}

/** On-chain cap snapshot keyed by keccak256(idData). */
export function buildCapIdStateMap(caps: readonly CapInfo[]): Map<string, CapIdState> {
  const map = new Map<string, CapIdState>();
  for (const cap of caps) {
    const idData = resolveCapIdData(cap, null);
    if (!idData) continue;
    const id = keccak256(idData).toLowerCase();
    map.set(id, {
      id,
      kind: capKindForCap(cap),
      absoluteCap: parseCapBigInt(cap.absoluteCap),
      relativeCapWad: parseCapBigInt(cap.relativeCap),
      allocation: parseCapBigInt(cap.allocation) ?? 0n,
    });
  }
  return map;
}

/**
 * Change the vault applies to every ID the adapter returns.
 * Allocate writes `display + delta` (real assets), not the booked target.
 */
export function expectedAllocationChange(args: {
  booked: bigint;
  display: bigint;
  targetBooked: bigint;
}): bigint {
  const { booked, display, targetBooked } = args;
  if (targetBooked === booked) return 0n;
  if (targetBooked < booked) {
    const delta =
      targetBooked === 0n
        ? booked
        : clampDeallocateAmount(booked - targetBooked, booked);
    const afterDisplay = display > delta ? display - delta : 0n;
    return afterDisplay - booked;
  }
  return display + (targetBooked - booked) - booked;
}

function allocationIdsForRow(row: RebalancePlanRow): string[] {
  const adapterId = keccak256(
    encodeAdapterCapIdData(row.target.adapterAddress)
  ).toLowerCase();
  const ids = new Set<string>([adapterId]);
  const marketId = row.target.capIdHash?.toLowerCase();
  if (marketId) ids.add(marketId);
  const collateral = row.target.collateralAddress;
  if (collateral) {
    ids.add(keccak256(encodeCollateralCapIdData(collateral)).toLowerCase());
  }
  return [...ids];
}

function formatCapForError(
  cap: bigint,
  row: RebalancePlanRow
): string {
  return formatCapDisplayAmount(
    cap,
    row.target.symbol,
    row.target.decimals ?? 18
  );
}

/**
 * Simulate deallocate-then-allocate against every ID Morpho checks on allocate
 * (market + adapter + collateral). Accrued interest is included in the change.
 */
export function validateRebalanceCapIds(
  rows: ReadonlyArray<RebalancePlanRow>,
  capsById: Map<string, CapIdState>,
  chainTotalAssets: bigint
): string | null {
  const running = new Map<string, bigint>();
  for (const [id, cap] of capsById) {
    running.set(id, cap.allocation);
  }
  for (const row of rows) {
    if (row.target.isVaultIdle || !row.target.capIdHash) continue;
    running.set(row.target.capIdHash.toLowerCase(), row.current);
  }

  const deallocs: RebalancePlanRow[] = [];
  const allocs: RebalancePlanRow[] = [];
  for (const row of rows) {
    if (row.target.isVaultIdle || row.assets === row.current) continue;
    if (row.assets < row.current) deallocs.push(row);
    else allocs.push(row);
  }

  const apply = (row: RebalancePlanRow, checkCaps: boolean): string | null => {
    const booked = row.current;
    const display = row.target.displayAssets ?? booked;
    const change = expectedAllocationChange({
      booked,
      display,
      targetBooked: row.assets,
    });
    if (change === 0n && row.assets === row.current) return null;

    for (const id of allocationIdsForRow(row)) {
      const cap = capsById.get(id);
      if (!cap) {
        if (checkCaps) {
          return `${row.target.label}: ${guessIdKind(id, row)} cap unknown — cannot verify allocate (would revert on-chain).`;
        }
        continue;
      }
      const next = (running.get(id) ?? cap.allocation) + change;
      running.set(id, next < 0n ? 0n : next);
      if (!checkCaps) continue;

      if (cap.absoluteCap == null) {
        return `${row.target.label}: ${cap.kind} cap unknown — cannot verify allocate (would revert on-chain).`;
      }
      if (cap.absoluteCap === 0n) {
        return `${row.target.label}: zero ${cap.kind} absolute cap — allocation disabled on-chain.`;
      }
      if (!isUncapped(cap.absoluteCap) && next > cap.absoluteCap) {
        return `${row.target.label}: allocation exceeds ${cap.kind} absolute cap (${formatCapForError(cap.absoluteCap, row)}). Accrued interest counts toward the cap.`;
      }
      if (
        cap.relativeCapWad != null &&
        cap.relativeCapWad < WAD &&
        chainTotalAssets > 0n
      ) {
        const maxAllowed = (chainTotalAssets * cap.relativeCapWad) / WAD;
        if (next > maxAllowed) {
          return `${row.target.label}: allocation exceeds ${cap.kind} relative cap (${(Number(cap.relativeCapWad) / 1e16).toFixed(2)}% of vault).`;
        }
      }
    }
    return null;
  };

  for (const row of deallocs) {
    const error = apply(row, false);
    if (error) return error;
  }
  for (const row of allocs) {
    const error = apply(row, true);
    if (error) return error;
  }
  return null;
}

function guessIdKind(id: string, row: RebalancePlanRow): CapIdKind {
  const adapterId = keccak256(
    encodeAdapterCapIdData(row.target.adapterAddress)
  ).toLowerCase();
  if (id === adapterId) return 'adapter';
  if (row.target.capIdHash && id === row.target.capIdHash.toLowerCase()) {
    return 'market';
  }
  return 'collateral';
}

/** Ensure allocate deltas can be funded from deployable idle after deallocations in the same multicall. */
export function validateIdleFunding(
  rows: ReadonlyArray<RebalancePlanRow>,
  deployableIdleBase?: bigint
): string | null {
  const summary = summarizeRebalanceFunding(rows, deployableIdleBase);
  if (summary.shortfall > BigInt(0)) {
    return INSUFFICIENT_IDLE_FUNDING_ERROR;
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

export function rebalanceCallsFingerprint(rows: ReadonlyArray<RebalancePlanRow>): string {
  const { deallocCalls, allocCalls } = buildRebalanceMulticallData(rows);
  return [...deallocCalls, ...allocCalls].join('|');
}

export async function simulateVaultRebalance(args: {
  client: PublicClient;
  vault: Address;
  account: Address;
  rows: ReadonlyArray<RebalancePlanRow>;
}): Promise<void> {
  const { deallocCalls, allocCalls } = buildRebalanceMulticallData(args.rows);
  const allCalls = [...deallocCalls, ...allocCalls];
  if (allCalls.length === 0) {
    throw new Error('No on-chain allocation changes to submit.');
  }

  if (allCalls.length === 1) {
    const changed = args.rows.find((r) => !r.target.isVaultIdle && r.assets !== r.current);
    if (!changed) {
      throw new Error('No on-chain allocation changes to submit.');
    }
    if (changed.assets > changed.current) {
      await args.client.simulateContract({
        account: args.account,
        address: args.vault,
        abi: vaultV2Abi,
        functionName: 'allocate',
        args: [
          changed.target.adapterAddress as Address,
          changed.target.data,
          changed.assets - changed.current,
        ],
      });
      return;
    }
    const delta = changed.current - changed.assets;
    const safeDelta =
      changed.assets === 0n
        ? changed.current
        : clampDeallocateAmount(delta, changed.current);
    if (safeDelta <= 0n) {
      throw new Error('No on-chain allocation changes to submit.');
    }
    await args.client.simulateContract({
      account: args.account,
      address: args.vault,
      abi: vaultV2Abi,
      functionName: 'deallocate',
      args: [changed.target.adapterAddress as Address, changed.target.data, safeDelta],
    });
    return;
  }

  await args.client.simulateContract({
    account: args.account,
    address: args.vault,
    abi: vaultV2Abi,
    functionName: 'multicall',
    args: [allCalls],
  });
}
