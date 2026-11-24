'use client';

import { getAddress, type Address, type EIP1193Provider, type Hex } from 'viem';
import {
  addSignature,
  getPendingById,
  updatePendingTransaction,
} from '@/lib/safe/pending-store';
import {
  signSafeTransactionHash,
  storedSafeTransactionData,
} from '@/lib/safe/protocol-kit-client';
import { readSafeOnChainInfo } from '@/lib/safe/onchain-reads';
import {
  isTransactionServiceConfigured,
  proposePendingToTransactionService,
} from '@/lib/safe/transaction-service';

async function resolveShareThreshold(
  safeAddress: Address,
  provided?: number
): Promise<number> {
  try {
    const { threshold } = await readSafeOnChainInfo(safeAddress);
    if (Number.isFinite(threshold) && threshold >= 1) return threshold;
  } catch {
    // Fall through — never mark ready without a real threshold.
  }
  if (provided != null && Number.isFinite(provided) && provided >= 1) {
    return provided;
  }
  return Number.POSITIVE_INFINITY;
}

/** After a local queue, sign + propose so other owners see the tx without a manual Share. */
export async function autoShareQueuedTransaction(options: {
  txId: string;
  proposer: Address;
  provider?: EIP1193Provider;
  threshold?: number;
}): Promise<void> {
  if (!isTransactionServiceConfigured()) return;
  const tx = getPendingById(options.txId);
  if (!tx) return;

  try {
    const signature = await signSafeTransactionHash({
      safeAddress: tx.safeAddress,
      signer: options.proposer,
      safeTxHash: tx.safeTxHash,
      transactionData: storedSafeTransactionData(tx),
      provider: options.provider,
    });

    const updated = addSignature(tx.id, options.proposer, signature);
    const nextCount = updated?.signatures.length ?? 1;
    const threshold = await resolveShareThreshold(tx.safeAddress, options.threshold);
    updatePendingTransaction(tx.id, {
      status:
        Number.isFinite(threshold) && nextCount >= threshold
          ? 'ready'
          : 'awaiting_signatures',
      proposer: getAddress(options.proposer),
    });

    const signed = getPendingById(tx.id);
    if (!signed) return;

    await proposePendingToTransactionService({
      tx: signed,
      senderAddress: options.proposer,
      senderSignature: signature as Hex,
    });

    updatePendingTransaction(tx.id, {
      serviceSynced: true,
      serviceSyncError: null,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Queued locally; failed to auto-share with owners.';
    updatePendingTransaction(tx.id, { serviceSyncError: message });
  }
}
