'use client';

import { getAddress, type Address, type Hex } from 'viem';
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
} from '@/lib/safe/protocol-kit-client';
import { sendTransactionViaSafeApp } from '@/lib/safe/safe-apps-send';
import { upsertPendingTransaction, updatePendingTransaction } from '@/lib/safe/pending-store';
import type { RebalancePlanRow } from '@/lib/onchain/v2-rebalance-plan';
import type { SafePendingTransaction, SafeTransactionSource } from '@/lib/safe/types';

function newPendingId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function tryPublishViaSafeApp(
  tx: SafePendingTransaction,
  calldata: { to: Address; data: Hex },
  safeAppSdk: SafeAppsSDK
): Promise<SafePendingTransaction> {
  try {
    const appSafeTxHash = await sendTransactionViaSafeApp(safeAppSdk, calldata);
    if (appSafeTxHash.toLowerCase() !== tx.safeTxHash.toLowerCase()) {
      return (
        updatePendingTransaction(tx.id, {
          serviceSynced: true,
          serviceSyncError:
            'Safe App returned a different tx hash — check the Safe interface for the active proposal.',
        }) ?? tx
      );
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

export async function queueVaultWriteInSafe(options: {
  safeRole: SafeRole;
  calldata: { to: Address; data: Hex };
  description: string;
  preview: TxPreview;
  source: SafeTransactionSource;
  proposer?: Address;
  safeAppSdk?: SafeAppsSDK | null;
}): Promise<SafePendingTransaction> {
  const safe = getSafeByRole(options.safeRole);

  const { safeTxHash, transactionData } = await createSafeTransactionFromCalldata({
    safeAddress: safe.address,
    to: options.calldata.to,
    data: options.calldata.data,
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
    return tryPublishViaSafeApp(tx, options.calldata, options.safeAppSdk);
  }

  // Queue locally only — owners sign once on /safe/[role] (no wallet prompt here).
  return tx;
}

export async function queueVaultRebalanceInSafe(options: {
  vaultAddress: Address;
  submitRows: ReadonlyArray<RebalancePlanRow>;
  preview: TxPreview;
  vaultSymbol?: string;
  safeRole?: SafeRole;
  proposer?: Address;
  safeAppSdk?: SafeAppsSDK | null;
}): Promise<SafePendingTransaction> {
  const safeRole = options.safeRole ?? ALLOCATION_SAFE_ROLE;
  const calldata = buildVaultRebalanceCalldata(options.vaultAddress, options.submitRows);
  if (!calldata) {
    throw new Error('No on-chain allocation changes to queue.');
  }

  return queueVaultWriteInSafe({
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
    safeAppSdk: options.safeAppSdk,
  });
}

export function pendingStatusAfterSign(
  signatureCount: number,
  threshold: number
): 'awaiting_signatures' | 'ready' {
  return signatureCount >= threshold ? 'ready' : 'awaiting_signatures';
}

export function ownerHasSigned(
  signatures: ReadonlyArray<{ signer: Address }>,
  owner: Address
): boolean {
  const target = owner.toLowerCase();
  return signatures.some((s) => getAddress(s.signer).toLowerCase() === target);
}
