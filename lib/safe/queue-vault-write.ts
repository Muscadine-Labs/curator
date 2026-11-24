'use client';

import { getAddress, type Address, type EIP1193Provider, type Hex } from 'viem';
import type { TxPreview } from '@/lib/morpho/tx-preview';
import {
  ALLOCATION_SAFE_ROLE,
  getSafeByRole,
  type SafeRole,
} from '@/lib/safe/config';
import { buildVaultRebalanceCalldata } from '@/lib/safe/build-vault-calldata';
import {
  createSafeTransactionFromCalldata,
  createSafeTransactionFromCalls,
  initSafeProtocolKit,
} from '@/lib/safe/protocol-kit-client';
import { autoShareQueuedTransaction } from '@/lib/safe/auto-share';
import {
  checkSafeCallBeforeQueue,
  countDistinctQueuedProposals,
} from '@/lib/safe/simulate-safe-call';
import {
  upsertPendingTransaction,
  removePendingTransaction,
  getPendingById,
  getSafePendingSnapshot,
  listPendingForRole,
} from '@/lib/safe/pending-store';
import {
  fetchPendingMultisigTransactions,
  isTransactionServiceConfigured,
} from '@/lib/safe/transaction-service';
import { OperationType } from '@safe-global/types-kit';
import type { RebalancePlanRow } from '@/lib/onchain/v2-rebalance-plan';
import type { SafePendingTransaction, SafeTransactionSource } from '@/lib/safe/types';

function newPendingId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Unexecuted proposals queued for this Safe: local rows and (when configured)
 * Safe Queue Service rows, both filtered to the on-chain nonce so a local row
 * another client already executed does not count. A failed service read uses
 * local rows only; a failed nonce read keeps every row.
 */
async function countQueuedAheadForSafe(role: SafeRole, safeAddress: Address): Promise<number> {
  const local = listPendingForRole(role);
  const onChainNonce = await readOnChainNonce(safeAddress);
  const serviceTxs = isTransactionServiceConfigured()
    ? await fetchPendingMultisigTransactions(safeAddress).catch(() => [])
    : [];
  return countDistinctQueuedProposals(local, serviceTxs, onChainNonce);
}

async function readOnChainNonce(safeAddress: Address): Promise<number | null> {
  try {
    const kit = await initSafeProtocolKit({ safeAddress });
    return Number(await kit.getNonce());
  } catch {
    return null;
  }
}

/** A Safe meta-tx target. `value` is native ETH in wei, defaulting to none. */
export type SafeCalldata = { to: Address; data: Hex; value?: bigint };

export async function queueSafeTransaction(options: {
  safeRole: SafeRole;
  calldata: SafeCalldata;
  description: string;
  preview: TxPreview;
  source: SafeTransactionSource;
  proposer?: Address;
  provider?: EIP1193Provider;
}): Promise<SafePendingTransaction> {
  const safe = getSafeByRole(options.safeRole);

  // Fail before owners sign, not at execution. With proposals queued ahead
  // the result is only a warning: they may change the state this call needs.
  const simulationWarning = await checkSafeCallBeforeQueue({
    safe: getAddress(safe.address),
    to: options.calldata.to,
    data: options.calldata.data,
    value: options.calldata.value,
    countQueuedAhead: () => countQueuedAheadForSafe(options.safeRole, getAddress(safe.address)),
  });

  const { safeTxHash, transactionData } = await createSafeTransactionFromCalldata({
    safeAddress: safe.address,
    to: options.calldata.to,
    data: options.calldata.data,
    value: options.calldata.value,
  });

  const now = new Date().toISOString();
  const tx: SafePendingTransaction = {
    id: newPendingId(),
    safeRole: options.safeRole,
    safeAddress: getAddress(safe.address),
    safeTxHash,
    ...transactionData,
    status: 'awaiting_signatures',
    proposer: options.proposer ? getAddress(options.proposer) : null,
    description: options.description,
    source: options.source,
    preview: options.preview,
    signatures: [],
    createdAt: now,
    updatedAt: now,
    serviceSynced: false,
    serviceSyncError: null,
    simulationWarning,
  };

  upsertPendingTransaction(tx);

  if (options.proposer && isTransactionServiceConfigured()) {
    await autoShareQueuedTransaction({
      txId: tx.id,
      proposer: options.proposer,
      provider: options.provider,
    });
  }

  return getPendingById(tx.id) ?? tx;
}

export async function queueVaultRebalanceInSafe(options: {
  vaultAddress: Address;
  submitRows: ReadonlyArray<RebalancePlanRow>;
  preview: TxPreview;
  vaultSymbol?: string;
  safeRole?: SafeRole;
  proposer?: Address;
  provider?: EIP1193Provider;
}): Promise<SafePendingTransaction> {
  const safeRole = options.safeRole ?? ALLOCATION_SAFE_ROLE;
  const calldata = buildVaultRebalanceCalldata(options.vaultAddress, options.submitRows);
  if (!calldata) {
    throw new Error('No on-chain allocation changes to queue.');
  }

  return queueSafeTransaction({
    safeRole,
    calldata,
    description: `Vault rebalance — ${options.vaultSymbol ?? calldata.to}`,
    preview: options.preview,
    source: {
      type: 'allocation',
      vaultAddress: getAddress(options.vaultAddress),
      vaultSymbol: options.vaultSymbol,
    },
    proposer: options.proposer,
    provider: options.provider,
  });
}

/**
 * MultiSend must occupy the earliest selected nonce as a contiguous range.
 * Any selected row already on the Safe Queue Service is refused: wrapping it in a
 * local MultiSend would leave the original service proposal executable at that
 * nonce. DelegateCall rows are refused because this UI cannot safely fold them
 * into a Call MultiSend.
 *
 * The range must also be the tail of the Safe's queue. Folding N proposals into
 * one nonce frees N−1 nonces; a later queued proposal is already signed for its
 * old nonce, so it would sit behind a gap nothing can fill and never execute.
 */
export function prepareSafeBatchSelection(
  txs: ReadonlyArray<SafePendingTransaction>,
  queue: ReadonlyArray<SafePendingTransaction> = []
): SafePendingTransaction[] {
  if (txs.length < 2) {
    throw new Error('Select at least two queued proposals to batch.');
  }

  const first = txs[0]!;
  const safeAddress = first.safeAddress.toLowerCase();
  for (const tx of txs) {
    if (tx.safeAddress.toLowerCase() !== safeAddress || tx.safeRole !== first.safeRole) {
      throw new Error('Batch only proposals from the same Safe.');
    }
    if (tx.status === 'executed' || tx.status === 'stale' || tx.status === 'cancelled') {
      throw new Error('Cannot batch executed, stale, or cancelled proposals.');
    }
  }

  const sorted = [...txs].sort((a, b) => Number(a.nonce) - Number(b.nonce));
  const nonces = sorted.map((tx) => Number(tx.nonce));
  if (nonces.some((n) => !Number.isInteger(n) || n < 0)) {
    throw new Error('Selected proposals have invalid nonces.');
  }
  for (let i = 1; i < nonces.length; i++) {
    if (nonces[i] !== nonces[0]! + i) {
      throw new Error(
        'Batch requires a contiguous nonce range (no gaps or duplicates). Otherwise leftover proposals stay executable after the MultiSend.'
      );
    }
  }

  const selectedIds = new Set(sorted.map((tx) => tx.id));
  const lastNonce = nonces[nonces.length - 1]!;
  const laterQueued = queue.filter(
    (tx) =>
      !selectedIds.has(tx.id) &&
      tx.safeAddress.toLowerCase() === safeAddress &&
      (tx.status === 'awaiting_signatures' || tx.status === 'ready') &&
      Number(tx.nonce) > lastNonce
  );
  if (laterQueued.length > 0) {
    const later = laterQueued
      .map((tx) => Number(tx.nonce))
      .sort((a, b) => a - b)
      .join(', ');
    throw new Error(
      `Batch must include the last queued nonce. Proposals at nonce ${later} would be stranded behind the freed nonces — include them or remove them first.`
    );
  }

  for (const tx of sorted) {
    if (tx.serviceSynced) {
      throw new Error(
        `Cannot batch nonce ${tx.nonce}: it is already on the Safe Queue Service. Cancel or replace that proposal on the service first, or batch only local-only rows.`
      );
    }
    if (tx.operation === 1) {
      throw new Error(
        `Cannot batch nonce ${tx.nonce}: DelegateCall cannot be folded into a MultiSend from this UI.`
      );
    }
  }

  return sorted;
}

/** Throws when the batch's nonce is already used on-chain. */
export function assertBatchNonceNotSpent(batchNonce: number, onChainNonce: number): void {
  if (batchNonce < onChainNonce) {
    throw new Error(
      `Cannot batch from nonce ${batchNonce}: the Safe is already at nonce ${onChainNonce}. Mark the executed rows stale (or Sync from service) and select again.`
    );
  }
}

export async function queueSafeBatch(options: {
  safeRole: SafeRole;
  txs: ReadonlyArray<SafePendingTransaction>;
  proposer?: Address;
  provider?: EIP1193Provider;
  threshold?: number;
}): Promise<SafePendingTransaction> {
  const ordered = prepareSafeBatchSelection(options.txs, getSafePendingSnapshot());
  const nonce = Number(ordered[0]!.nonce);
  const safeAddress = getAddress(getSafeByRole(options.safeRole).address);
  // A row executed or replaced from another browser holds a spent nonce: the
  // batch would take that nonce and the originals would already be gone.
  const onChainNonce = await readOnChainNonce(safeAddress);
  if (onChainNonce == null) {
    throw new Error('Could not read the Safe nonce. Refresh and try again.');
  }
  assertBatchNonceNotSpent(nonce, onChainNonce);
  // A proposal made in another browser lives only on the Safe Queue Service until a sync.
  // If it sits above the batch, folding the range would strand it behind the freed nonces.
  if (isTransactionServiceConfigured()) {
    const lastNonce = Number(ordered[ordered.length - 1]!.nonce);
    const selected = new Set(ordered.map((tx) => tx.safeTxHash.toLowerCase()));
    const serviceTxs = await fetchPendingMultisigTransactions(safeAddress).catch(() => null);
    if (serviceTxs == null) {
      throw new Error('Could not read Safe Queue Service proposals. Try again before batching.');
    }
    const later = [
      ...new Set(
        serviceTxs
          .filter((tx) => !selected.has(tx.safeTxHash.toLowerCase()) && Number(tx.nonce) > lastNonce)
          .map((tx) => Number(tx.nonce))
      ),
    ].sort((x, y) => x - y);
    if (later.length > 0) {
      throw new Error(
        `Batch must include the last queued nonce. Safe Queue Service proposals at nonce ${later.join(', ')} would be stranded behind the freed nonces — sync and include them, or remove them first.`
      );
    }
  }
  const { safeTxHash, transactionData } = await createSafeTransactionFromCalls({
    safeAddress,
    calls: ordered.map((tx) => ({
      to: tx.to,
      data: tx.data,
      value: BigInt(tx.value || '0'),
      operation: tx.operation as OperationType,
    })),
    nonce,
  });

  for (const tx of ordered) {
    removePendingTransaction(tx.id);
  }

  const now = new Date().toISOString();
  const tx: SafePendingTransaction = {
    id: newPendingId(),
    safeRole: options.safeRole,
    safeAddress,
    safeTxHash,
    ...transactionData,
    status: 'awaiting_signatures',
    proposer: options.proposer ? getAddress(options.proposer) : null,
    description: `MultiSend batch (${ordered.length} calls)`,
    source: { type: 'manual' },
    preview: {
      title: `Batch ${ordered.length} proposals`,
      description:
        'Wrapped as one Safe MultiSend at the earliest selected nonce. Rows already on the Safe Queue Service, or DelegateCall rows, are refused so leftover proposals cannot stay executable after the batch.',
      changes: ordered.map((row) => ({
        action: 'batch' as const,
        label: row.description,
      })),
    },
    signatures: [],
    createdAt: now,
    updatedAt: now,
    serviceSynced: false,
    serviceSyncError: null,
  };
  upsertPendingTransaction(tx);
  if (options.proposer && isTransactionServiceConfigured()) {
    await autoShareQueuedTransaction({
      txId: tx.id,
      proposer: options.proposer,
      provider: options.provider,
      threshold: options.threshold,
    });
  }
  return getPendingById(tx.id) ?? tx;
}

export function requireSafeThreshold(threshold: number | undefined): number {
  if (threshold == null || !Number.isFinite(threshold) || threshold < 1) {
    throw new Error('Safe signature threshold is unavailable. Refresh and try again.');
  }
  return threshold;
}

export function pendingStatusAfterSign(
  signatureCount: number,
  threshold: number
): 'awaiting_signatures' | 'ready' {
  if (!Number.isFinite(threshold) || threshold < 1) return 'awaiting_signatures';
  return signatureCount >= threshold ? 'ready' : 'awaiting_signatures';
}

/** Signatures from current Safe owners, one per owner. */
export function countOwnerSignatures(
  signatures: ReadonlyArray<{ signer: Address }>,
  owners: ReadonlyArray<string>
): number {
  const ownerSet = new Set(owners.map((o) => o.toLowerCase()));
  const counted = new Set<string>();
  for (const s of signatures) {
    const key = s.signer.toLowerCase();
    if (ownerSet.has(key)) counted.add(key);
  }
  return counted.size;
}

export function ownerHasSigned(
  signatures: ReadonlyArray<{ signer: Address }>,
  owner: Address
): boolean {
  const target = owner.toLowerCase();
  return signatures.some((s) => getAddress(s.signer).toLowerCase() === target);
}
