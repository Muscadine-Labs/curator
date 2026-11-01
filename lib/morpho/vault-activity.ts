import { decodeFunctionData, type Hex } from 'viem';
import { vaultV2Abi } from '@/lib/onchain/abis';
import { decodeMultiSend, isKnownMultiSend } from '@/lib/safe/multisend';

/**
 * Vault activity feed (Morpho Curator style): allocations and governance in
 * one list. Pure helpers — shared by the server loader and tests.
 */

export type VaultActivityType = 'allocation' | 'governance';

export type VaultActivityRow = {
  id: string;
  /** Unix seconds; pending submissions use their submit time when known, else validAt. */
  timestamp: number;
  type: VaultActivityType;
  /** e.g. `allocate`, `deallocate`, `Submit increaseAbsoluteCap`, `setIsAllocator`. */
  action: string;
  /** Address that sent the call (allocator EOA / Safe), when known. */
  actor: string | null;
  /** Signed raw asset change for allocations (+ allocate, − deallocate). */
  amount: string | null;
  adapter: string | null;
  /** Allocation ids touched (adapter / collateral / market cap ids). */
  ids: string[];
  txHash: string | null;
  /** Governance submissions still inside their timelock. */
  pending?: { validAt: number } | null;
};

const VAULT_WRITE_SKIP = new Set(['allocate', 'deallocate', 'multicall']);

/** Human name for one Vault V2 call; `submit(data)` names the inner call. */
export function describeVaultCall(data: string | null | undefined): string | null {
  if (!data || data === '0x') return null;
  try {
    const decoded = decodeFunctionData({ abi: vaultV2Abi, data: data as Hex });
    if (decoded.functionName === 'submit' || decoded.functionName === 'revoke') {
      const inner = describeVaultCall(String(decoded.args?.[0] ?? ''));
      const verb = decoded.functionName === 'submit' ? 'Submit' : 'Revoke';
      return inner ? `${verb} ${inner}` : verb;
    }
    return decoded.functionName;
  } catch {
    return null;
  }
}

export type GovernanceCall = {
  /** e.g. `Submit increaseAbsoluteCap`, `setIsAllocator`. */
  action: string;
  /**
   * For `submit(data)`: the submitted calldata — the identity Morpho's
   * `pendingConfigs[].data` carries, so a batch of submits with different
   * timelocks reconciles call by call. Null for any other call.
   */
  submittedData: string | null;
};

function governanceCall(data: Hex): GovernanceCall | null {
  const action = describeVaultCall(data);
  if (!action || VAULT_WRITE_SKIP.has(action)) return null;
  let submittedData: string | null = null;
  try {
    const decoded = decodeFunctionData({ abi: vaultV2Abi, data });
    if (decoded.functionName === 'submit') submittedData = String(decoded.args?.[0] ?? '');
  } catch {
    /* describeVaultCall already named it */
  }
  return { action, submittedData: submittedData ? submittedData.toLowerCase() : null };
}

/**
 * Governance calls a Safe tx made on `vault`: a direct call, a vault
 * `multicall`, or calls inside a canonical MultiSend batch. Allocations are
 * left out — Morpho indexes those with amounts.
 */
export function governanceCallsFromSafeTx(
  tx: { to: string; data: string | null },
  vault: string
): GovernanceCall[] {
  const target = vault.toLowerCase();
  const calls: Hex[] = [];
  if (tx.to.toLowerCase() === target && tx.data) {
    calls.push(tx.data as Hex);
  } else if (isKnownMultiSend(tx.to) && tx.data) {
    for (const inner of decodeMultiSend(tx.data as Hex) ?? []) {
      if (inner.to.toLowerCase() === target) calls.push(inner.data);
    }
  }

  const out: GovernanceCall[] = [];
  for (const data of calls) {
    let functionName: string;
    let args: readonly unknown[] | undefined;
    try {
      ({ functionName, args } = decodeFunctionData({ abi: vaultV2Abi, data }));
    } catch {
      out.push({ action: 'Unknown call', submittedData: null });
      continue;
    }
    const inner = functionName === 'multicall' ? ((args?.[0] as readonly Hex[]) ?? []) : [data];
    for (const call of inner) {
      const g = governanceCall(call);
      if (g) out.push(g);
    }
  }
  return out;
}

/**
 * Index of the pending config one executed governance call created: a
 * `submit` whose submitted calldata is still pending, from the same tx, not
 * already claimed by an earlier identical call in that batch. −1 = none.
 */
export function matchPendingConfig(
  call: { txHash: string | null; submittedData: string | null },
  pending: ReadonlyArray<{ txHash: string | null; data: string | null }>,
  taken: ReadonlySet<number>
): number {
  if (!call.txHash || !call.submittedData) return -1;
  const hash = call.txHash.toLowerCase();
  return pending.findIndex(
    (p, i) =>
      !taken.has(i) &&
      p.txHash?.toLowerCase() === hash &&
      p.data?.toLowerCase() === call.submittedData
  );
}

/** A pending config is executable only with a known, elapsed unlock time. */
export function pendingStatus(
  validAt: number | null | undefined,
  nowSeconds: number
): 'executable' | 'timelocked' | 'unknown' {
  if (validAt == null || !Number.isFinite(validAt) || validAt <= 0) return 'unknown';
  return validAt <= nowSeconds ? 'executable' : 'timelocked';
}

/** Signed allocation change: `change` when indexed, else ± assets by type. */
export function signedAllocationAmount(input: {
  type?: string | null;
  assets?: string | number | null;
  change?: string | number | null;
}): string | null {
  const toInt = (v: string | number | null | undefined): bigint | null => {
    if (v == null || v === '') return null;
    try {
      return typeof v === 'number' ? BigInt(Math.round(v)) : BigInt(v.split('.')[0]);
    } catch {
      return null;
    }
  };
  const change = toInt(input.change);
  if (change != null && change !== 0n) return change.toString();
  const assets = toInt(input.assets);
  if (assets == null) return null;
  const isDeallocate = /dealloc/i.test(input.type ?? '');
  return (isDeallocate ? -assets : assets).toString();
}

/**
 * Pending submissions with no executed Safe row first (their only time is the
 * future unlock), then newest first; stable on ties by id.
 */
export function sortActivity(rows: VaultActivityRow[]): VaultActivityRow[] {
  const pendingOnly = (r: VaultActivityRow) => (r.pending && !r.actor ? 1 : 0);
  return [...rows].sort(
    (a, b) =>
      pendingOnly(b) - pendingOnly(a) || b.timestamp - a.timestamp || a.id.localeCompare(b.id)
  );
}

export type VaultActivityRole = 'Owner' | 'Curator' | 'Allocator' | 'Sentinel' | 'Public Allocator';

/** Every vault role `actor` holds (an address can be allocator and sentinel). */
export function activityRoles(
  actor: string | null,
  roles: {
    owner?: string | null;
    curator?: string | null;
    allocators?: ReadonlyArray<string>;
    sentinels?: ReadonlyArray<string>;
    publicAllocator?: string | null;
  }
): VaultActivityRole[] {
  if (!actor) return [];
  const a = actor.toLowerCase();
  const eq = (x: string | null | undefined) => Boolean(x) && x!.toLowerCase() === a;
  const out: VaultActivityRole[] = [];
  if (eq(roles.publicAllocator)) return ['Public Allocator'];
  if (eq(roles.owner)) out.push('Owner');
  if (eq(roles.curator)) out.push('Curator');
  if (roles.allocators?.some(eq)) out.push('Allocator');
  if (roles.sentinels?.some(eq)) out.push('Sentinel');
  return out;
}
