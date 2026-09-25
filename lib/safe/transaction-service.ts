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

/** Safe Transaction Service v2 (api.safe.global). Chain path is Base. */
const SAFE_TX_SERVICE_BASE = 'https://api.safe.global/tx-service/base/api';

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

const HISTORY_LIMIT = 40;

/**
 * Executed Safe txs — on-demand only (free tier 5 req/s / 50K month).
 * Uses the Transaction Service v2 multisig list directly. The api-kit GET
 * helper attaches a JSON body, which some server fetches turn into an empty list.
 */
export async function fetchExecutedMultisigTransactions(
  safeAddress: Address
): Promise<ServiceHistoryTx[]> {
  const apiKey = process.env.NEXT_PUBLIC_SAFE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('NEXT_PUBLIC_SAFE_API_KEY is not configured.');
  }
  const address = getAddress(safeAddress);
  const url = new URL(
    `${SAFE_TX_SERVICE_BASE}/v2/safes/${address}/multisig-transactions/`
  );
  url.searchParams.set('executed', 'true');
  url.searchParams.set('ordering', '-nonce');
  url.searchParams.set('limit', String(HISTORY_LIMIT));

  const response = await withSafeTxServiceRateLimit(() =>
    fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      cache: 'no-store',
    })
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text.slice(0, 300) || `Transaction Service returned ${response.status}`);
  }
  const body = JSON.parse(text) as { results?: ServiceHistoryTx[] };
  return body.results ?? [];
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
