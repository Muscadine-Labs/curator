'use client';

import { getAddress, type Address, type Hex } from 'viem';
import type SafeApiKit from '@safe-global/api-kit';
import { OperationType, type SafeTransactionData } from '@safe-global/types-kit';
import { BASE_CHAIN_ID } from '@/lib/constants';
import type { SafePendingTransaction, SafeOwnerSignature } from '@/lib/safe/types';
import { withSafeTxServiceRateLimit } from '@/lib/safe/transaction-service-rate-limit';
import {
  describeSafeTxSource,
  inferSafeTxSource,
} from '@/lib/safe/decode-vault-calldata-preview';

export const SAFE_TX_SERVICE_ORIGIN = 'Curator';

/** Documented Safe API tier limits (manual actions only — no background polling). */
export const SAFE_TX_SERVICE_RATE_LIMITS = {
  requestsPerSecond: 5,
  requestsPerMonth: 50_000,
} as const;

let apiKitPromise: Promise<SafeApiKit> | null = null;

export function isTransactionServiceConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SAFE_API_KEY?.trim());
}

async function loadApiKit(): Promise<SafeApiKit> {
  if (!apiKitPromise) {
    apiKitPromise = (async () => {
      const { default: SafeApiKitCtor } = await import('@safe-global/api-kit');
      const apiKey = process.env.NEXT_PUBLIC_SAFE_API_KEY?.trim();
      if (!apiKey) {
        throw new Error('NEXT_PUBLIC_SAFE_API_KEY is not configured.');
      }
      return new SafeApiKitCtor({
        chainId: BigInt(BASE_CHAIN_ID),
        apiKey,
      });
    })();
  }
  return apiKitPromise;
}

export function pendingToSafeTransactionData(
  tx: Pick<
    SafePendingTransaction,
    | 'to'
    | 'value'
    | 'data'
    | 'operation'
    | 'safeTxGas'
    | 'baseGas'
    | 'gasPrice'
    | 'gasToken'
    | 'refundReceiver'
    | 'nonce'
  >
): SafeTransactionData {
  return {
    to: getAddress(tx.to),
    value: tx.value,
    data: tx.data,
    operation: tx.operation as OperationType,
    safeTxGas: tx.safeTxGas,
    baseGas: tx.baseGas,
    gasPrice: tx.gasPrice,
    gasToken: getAddress(tx.gasToken),
    refundReceiver: getAddress(tx.refundReceiver),
    nonce: Number(tx.nonce),
  };
}

export async function proposePendingToTransactionService(options: {
  tx: SafePendingTransaction;
  senderAddress: Address;
  senderSignature: Hex;
}): Promise<void> {
  const apiKit = await loadApiKit();
  await withSafeTxServiceRateLimit(() =>
    apiKit.proposeTransaction({
      safeAddress: getAddress(options.tx.safeAddress),
      safeTxHash: options.tx.safeTxHash,
      safeTransactionData: pendingToSafeTransactionData(options.tx),
      senderAddress: getAddress(options.senderAddress),
      senderSignature: options.senderSignature,
      origin: SAFE_TX_SERVICE_ORIGIN,
    })
  );
}

export async function confirmPendingOnTransactionService(
  safeTxHash: Hex,
  signature: Hex
): Promise<void> {
  const apiKit = await loadApiKit();
  await withSafeTxServiceRateLimit(() => apiKit.confirmTransaction(safeTxHash, signature));
}

type ServiceConfirmation = {
  owner: string;
  signature: string;
};

export type ServiceMultisigTx = {
  safeTxHash: string;
  to: string;
  value: string;
  data: string | null;
  operation: number;
  safeTxGas: string;
  baseGas: string;
  gasPrice: string;
  gasToken: string;
  refundReceiver: string;
  nonce: string | number;
  confirmations?: ServiceConfirmation[];
  origin?: string | null;
  isExecuted?: boolean;
};

export async function fetchPendingMultisigTransactions(
  safeAddress: Address
): Promise<ServiceMultisigTx[]> {
  const apiKit = await loadApiKit();
  const response = await withSafeTxServiceRateLimit(() =>
    apiKit.getPendingTransactions(getAddress(safeAddress))
  );
  return (response.results ?? []) as ServiceMultisigTx[];
}

export type ServiceHistoryTx = ServiceMultisigTx & {
  executionDate?: string | null;
  isSuccessful?: boolean | null;
  transactionHash?: string | null;
};

/** Executed Safe txs — on-demand only (free tier 5 req/s / 50K month). */
export async function fetchExecutedMultisigTransactions(
  safeAddress: Address
): Promise<ServiceHistoryTx[]> {
  const apiKit = await loadApiKit();
  const response = await withSafeTxServiceRateLimit(() =>
    apiKit.getMultisigTransactions(getAddress(safeAddress), {
      executed: true,
      ordering: '-nonce',
      limit: 40,
    })
  );
  return (response.results ?? []) as ServiceHistoryTx[];
}

export function mapServiceConfirmations(
  confirmations: ServiceConfirmation[] | undefined
): SafeOwnerSignature[] {
  if (!confirmations?.length) return [];
  const now = new Date().toISOString();
  return confirmations.map((c) => ({
    signer: getAddress(c.owner),
    data: c.signature as Hex,
    signedAt: now,
  }));
}

export function serviceTxDescription(tx: ServiceMultisigTx): string {
  const source = inferSafeTxSource(
    getAddress(tx.to),
    (tx.data ?? '0x') as Hex,
    tx.value
  );
  return describeSafeTxSource(source, tx.to);
}
