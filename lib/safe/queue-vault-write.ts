'use client';

import { getAddress, type Address, type EIP1193Provider, type Hex } from 'viem';
import type SafeAppsSDK from '@safe-global/safe-apps-sdk';
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
} from '@/lib/safe/protocol-kit-client';
import { sendTransactionViaSafeApp } from '@/lib/safe/safe-apps-send';
import { autoShareQueuedTransaction } from '@/lib/safe/auto-share';
import {
  upsertPendingTransaction,
  updatePendingTransaction,
  removePendingTransaction,
  getPendingById,
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

async function tryPublishViaSafeApp(
  tx: SafePendingTransaction,
  calldata: SafeCalldata,
  safeAppSdk: SafeAppsSDK
): Promise<SafePendingTransaction> {
  try {
    const appSafeTxHash = await sendTransactionViaSafeApp(safeAppSdk, {
      ...calldata,
      value: (calldata.value ?? 0n).toString(),
    });
    if (appSafeTxHash.toLowerCase() !== tx.safeTxHash.toLowerCase()) {
      const patch: Partial<SafePendingTransaction> = {
        safeTxHash: appSafeTxHash,
        serviceSynced: true,
        serviceSyncError: null,
      };
      if (isTransactionServiceConfigured()) {
        try {
          const pending = await fetchPendingMultisigTransactions(tx.safeAddress);
          const match = pending.find(
            (row) => row.safeTxHash.toLowerCase() === appSafeTxHash.toLowerCase()
          );
          if (match) {
            patch.nonce = String(match.nonce);
            patch.to = getAddress(match.to);
            patch.value = match.value;
            patch.data = (match.data ?? '0x') as Hex;
            patch.operation = match.operation as 0 | 1;
          }
        } catch {
          // Hash is still the Safe App proposal; nonce fill is best-effort.
        }
      }
      return updatePendingTransaction(tx.id, patch) ?? { ...tx, ...patch };
    }

    return (
      updatePendingTransaction(tx.id, {
        serviceSynced: true,
        serviceSyncError: null,
      }) ?? { ...tx, serviceSynced: true, serviceSyncError: null }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to send through Safe App.';
    return (
      updatePendingTransaction(tx.id, {
        serviceSynced: false,
        serviceSyncError: message,
      }) ?? { ...tx, serviceSynced: false, serviceSyncError: message }
    );
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
  safeAppSdk?: SafeAppsSDK | null;
}): Promise<SafePendingTransaction> {
  const safe = getSafeByRole(options.safeRole);

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
  };

  upsertPendingTransaction(tx);

  if (options.safeAppSdk) {
    const published = await tryPublishViaSafeApp(tx, options.calldata, options.safeAppSdk);
    if (!published.serviceSynced) {
      throw new Error(
        published.serviceSyncError ??
          'Safe App did not accept the transaction. It is saved locally — open the Safe queue to retry.'
      );
    }
    return published;
  }

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
  safeAppSdk?: SafeAppsSDK | null;
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
    safeAppSdk: options.safeAppSdk,
  });
}

/**
 * MultiSend must occupy the earliest selected nonce as a contiguous range.
 * Any selected row already on Transaction Service is refused: wrapping it in a
 * local MultiSend would leave the original service proposal executable at that
 * nonce. DelegateCall rows are refused because this UI cannot safely fold them
 * into a Call MultiSend.
 */
export function prepareSafeBatchSelection(
  txs: ReadonlyArray<SafePendingTransaction>
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

  for (const tx of sorted) {
    if (tx.serviceSynced) {
      throw new Error(
        `Cannot batch nonce ${tx.nonce}: it is already on Transaction Service. Cancel or replace that proposal on the service first, or batch only local-only rows.`
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

export async function queueSafeBatch(options: {
  safeRole: SafeRole;
  txs: ReadonlyArray<SafePendingTransaction>;
  proposer?: Address;
  provider?: EIP1193Provider;
  threshold?: number;
}): Promise<SafePendingTransaction> {
  const ordered = prepareSafeBatchSelection(options.txs);
  const nonce = Number(ordered[0]!.nonce);
  const { safeTxHash, transactionData } = await createSafeTransactionFromCalls({
    safeAddress: getSafeByRole(options.safeRole).address,
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
    safeAddress: getAddress(getSafeByRole(options.safeRole).address),
    safeTxHash,
    ...transactionData,
    status: 'awaiting_signatures',
    proposer: options.proposer ? getAddress(options.proposer) : null,
    description: `MultiSend batch (${ordered.length} calls)`,
    source: { type: 'manual' },
    preview: {
      title: `Batch ${ordered.length} proposals`,
      description:
        'Wrapped as one Safe MultiSend at the earliest selected nonce. Rows already on Transaction Service, or DelegateCall rows, are refused so leftover proposals cannot stay executable after the batch.',
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

export function ownerHasSigned(
  signatures: ReadonlyArray<{ signer: Address }>,
  owner: Address
): boolean {
  const target = owner.toLowerCase();
  return signatures.some((s) => getAddress(s.signer).toLowerCase() === target);
}
