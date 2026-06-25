'use client';

import { getAddress, type Address, type Hex } from 'viem';
import { getSafeByRole, type SafeRole } from '@/lib/safe/config';
import { getVaultByAddress } from '@/lib/config/vaults';
import { withDecodedPendingPreview, inferVaultSourceFromCalldata } from '@/lib/safe/decode-vault-calldata-preview';
import {
  fetchPendingMultisigTransactions,
  isTransactionServiceConfigured,
  mapServiceConfirmations,
  proposePendingToTransactionService,
  serviceTxDescription,
} from '@/lib/safe/transaction-service';
import {
  getPendingById,
  getSafePendingSnapshot,
  upsertPendingTransaction,
} from '@/lib/safe/pending-store';
import { pendingStatusAfterSign } from '@/lib/safe/queue-vault-write';
import type { SafePendingTransaction } from '@/lib/safe/types';
import type { ServiceMultisigTx } from '@/lib/safe/transaction-service';

function newPendingId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function mergeSignatures(
  existing: SafePendingTransaction['signatures'],
  incoming: SafePendingTransaction['signatures']
): SafePendingTransaction['signatures'] {
  const merged = [...existing];
  for (const sig of incoming) {
    const lower = getAddress(sig.signer).toLowerCase();
    if (!merged.some((s) => getAddress(s.signer).toLowerCase() === lower)) {
      merged.push(sig);
    }
  }
  return merged;
}

function mergeServiceTx(
  existing: SafePendingTransaction | undefined,
  serviceTx: ServiceMultisigTx,
  role: SafeRole,
  safeAddress: Address,
  threshold: number
): SafePendingTransaction {
  const incomingSignatures = mapServiceConfirmations(serviceTx.confirmations);
  const now = new Date().toISOString();

  if (existing) {
    const signatures = mergeSignatures(existing.signatures, incomingSignatures);
    return withDecodedPendingPreview({
      ...existing,
      signatures,
      status: pendingStatusAfterSign(signatures.length, threshold),
      serviceSynced: true,
      serviceSyncError: null,
      updatedAt: now,
    });
  }

  const vaultAddress = getAddress(serviceTx.to);
  const trackedVault = getVaultByAddress(vaultAddress);

  return withDecodedPendingPreview({
    id: newPendingId(),
    safeRole: role,
    safeAddress: getAddress(safeAddress),
    safeTxHash: serviceTx.safeTxHash as Hex,
    to: vaultAddress,
    value: serviceTx.value,
    data: (serviceTx.data ?? '0x') as Hex,
    operation: serviceTx.operation as 0 | 1,
    safeTxGas: serviceTx.safeTxGas,
    baseGas: serviceTx.baseGas,
    gasPrice: serviceTx.gasPrice,
    gasToken: getAddress(serviceTx.gasToken),
    refundReceiver: getAddress(serviceTx.refundReceiver),
    nonce: String(serviceTx.nonce),
    status: pendingStatusAfterSign(incomingSignatures.length, threshold),
    proposer: incomingSignatures[0]?.signer ?? null,
    description: serviceTxDescription(serviceTx),
    source: trackedVault
      ? inferVaultSourceFromCalldata(vaultAddress, (serviceTx.data ?? '0x') as Hex)
      : { type: 'manual' },
    preview: null,
    signatures: incomingSignatures,
    createdAt: now,
    updatedAt: now,
    serviceSynced: true,
    serviceSyncError: null,
  });
}

export async function syncPendingFromTransactionService(options: {
  role: SafeRole;
  threshold: number;
}): Promise<{ imported: number; updated: number }> {
  if (!isTransactionServiceConfigured()) {
    throw new Error(
      'Safe Transaction Service is not configured. Set NEXT_PUBLIC_SAFE_API_KEY in .env.'
    );
  }

  const safe = getSafeByRole(options.role);
  const serviceTxs = await fetchPendingMultisigTransactions(safe.address);
  const localByHash = new Map(
    getSafePendingSnapshot()
      .filter((t) => t.safeRole === options.role)
      .map((t) => [t.safeTxHash.toLowerCase(), t])
  );

  let imported = 0;
  let updated = 0;

  for (const serviceTx of serviceTxs) {
    const hashKey = serviceTx.safeTxHash.toLowerCase();
    const existing = localByHash.get(hashKey);
    const merged = mergeServiceTx(existing, serviceTx, options.role, safe.address, options.threshold);

    if (existing) updated += 1;
    else imported += 1;

    upsertPendingTransaction(merged);
    localByHash.set(hashKey, merged);
  }

  return { imported, updated };
}

export async function sharePendingWithTransactionService(options: {
  txId: string;
  senderAddress: Address;
  senderSignature: Hex;
}): Promise<SafePendingTransaction> {
  const tx = getPendingById(options.txId);
  if (!tx) throw new Error('Pending transaction not found.');

  await proposePendingToTransactionService({
    tx,
    senderAddress: options.senderAddress,
    senderSignature: options.senderSignature,
  });

  const updated: SafePendingTransaction = {
    ...tx,
    serviceSynced: true,
    serviceSyncError: null,
    updatedAt: new Date().toISOString(),
  };
  upsertPendingTransaction(updated);
  return updated;
}
