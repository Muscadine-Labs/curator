import { getAddress, zeroAddress, type Address, type Hex } from 'viem';
import { OperationType, type SafeTransactionData } from '@safe-global/types-kit';
import { BASE_CHAIN_ID, EXTERNAL_API_TIMEOUT_MS } from '@/lib/constants';
import type { SafePendingTransaction, SafeOwnerSignature } from '@/lib/safe/types';
import { withSafeTxServiceRateLimit } from '@/lib/safe/transaction-service-rate-limit';
import {
  describeSafeTxSource,
  inferSafeTxSource,
} from '@/lib/safe/decode-vault-calldata-preview';

export const SAFE_TX_SERVICE_ORIGIN = 'Curator';

/**
 * Safe Transaction Service (api.safe.global, Base). Since the Safe Queue Service
 * migration it only serves on-chain data here: executed multisig history.
 */
const SAFE_TX_SERVICE_BASE = 'https://api.safe.global/tx-service/base/api';

/**
 * Safe Queue Service: the off-chain queue (proposals, signatures, pending list,
 * delegates) moved here from the Transaction Service. One base URL for every chain;
 * the chain goes in the body or query (`chainId`, `safes=address:chainId`). Schema:
 * https://api.safe.global/queue/openapi.json. Migration guide:
 * https://docs.safe.global/core-api/safe-queue-service-migration
 */
export const SAFE_QUEUE_SERVICE_BASE = 'https://api.safe.global/queue/api/v1';

/** Documented Safe API tier limits (manual actions only — no background polling). */
export const SAFE_TX_SERVICE_RATE_LIMITS = {
  requestsPerSecond: 5,
  requestsPerMonth: 50_000,
} as const;

export function isTransactionServiceConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SAFE_API_KEY?.trim());
}

function safeApiKey(): string {
  const apiKey = process.env.NEXT_PUBLIC_SAFE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('NEXT_PUBLIC_SAFE_API_KEY is not configured.');
  }
  return apiKey;
}

/** HTTP error from a Safe API call; `status` lets callers treat 409 (already there) as done. */
export class SafeApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'SafeApiError';
  }
}

/** Queue Service errors are `{ detail: string | ValidationError[] }`. */
function safeApiErrorMessage(text: string, status: number): string {
  try {
    const body = JSON.parse(text) as { detail?: unknown; error_msg?: unknown };
    if (typeof body.detail === 'string') return body.detail;
    if (Array.isArray(body.detail)) {
      return body.detail
        .map((d) => (d && typeof d === 'object' && 'msg' in d ? String((d as { msg: unknown }).msg) : String(d)))
        .join('; ');
    }
    if (typeof body.error_msg === 'string') return body.error_msg;
  } catch {
    // not JSON
  }
  return text.slice(0, 300) || `Safe Queue Service returned ${status}`;
}

async function queueRequest<T>(
  path: string,
  init?: { method?: 'GET' | 'POST'; body?: unknown; query?: Record<string, string | number> }
): Promise<T> {
  const url = new URL(`${SAFE_QUEUE_SERVICE_BASE}${path}`);
  for (const [key, value] of Object.entries(init?.query ?? {})) {
    url.searchParams.set(key, String(value));
  }
  const response = await withSafeTxServiceRateLimit(() =>
    fetch(url, {
      method: init?.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${safeApiKey()}`,
        ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(EXTERNAL_API_TIMEOUT_MS),
    })
  );
  const text = await response.text();
  if (!response.ok) {
    throw new SafeApiError(safeApiErrorMessage(text, response.status), response.status);
  }
  return (text ? JSON.parse(text) : null) as T;
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

/**
 * Propose a Safe tx on the Queue Service. The service computes the safeTxHash itself
 * from the fields, so the response hash is checked against ours: a mismatch means the
 * service holds a different transaction than the one we signed and stored. A 409 means
 * it is already queued there (e.g. copied over from the Transaction Service).
 */
export async function proposePendingToTransactionService(options: {
  tx: SafePendingTransaction;
  senderAddress: Address;
  senderSignature: Hex;
}): Promise<void> {
  const data = pendingToSafeTransactionData(options.tx);
  try {
    const created = await queueRequest<{ safeTxHash: string }>('/multisig-transactions', {
      method: 'POST',
      body: {
        chainId: BASE_CHAIN_ID,
        safe: getAddress(options.tx.safeAddress),
        to: data.to,
        // Wei and gas values can exceed 2^53: send them as decimal strings (the API accepts both).
        value: String(data.value),
        data: data.data,
        operation: Number(data.operation),
        safeTxGas: String(data.safeTxGas),
        baseGas: String(data.baseGas),
        gasPrice: String(data.gasPrice),
        gasToken: data.gasToken,
        refundReceiver: data.refundReceiver,
        nonce: data.nonce,
        // The first signature decides the proposer (owner or delegate).
        signatures: [options.senderSignature],
        originName: SAFE_TX_SERVICE_ORIGIN,
      },
    });
    if (created?.safeTxHash?.toLowerCase() !== options.tx.safeTxHash.toLowerCase()) {
      throw new Error(
        `Safe Queue Service stored this proposal as ${created?.safeTxHash ?? 'an unknown hash'}, not ${options.tx.safeTxHash}.`
      );
    }
  } catch (error) {
    if (!(error instanceof SafeApiError && error.status === 409)) throw error;
    // Already queued (another owner shared it, or it was copied over from the Transaction
    // Service). The proposal exists but may not hold this signer's signature yet: add it.
    try {
      await confirmPendingOnTransactionService(options.tx.safeTxHash, options.senderSignature);
    } catch (confirmError) {
      // 422: the signer is a proposer (delegate), not an owner, so the service refuses the
      // signature. The proposal is already there, which is all a delegate can add.
      if (confirmError instanceof SafeApiError && confirmError.status === 422) return;
      throw confirmError;
    }
  }
}

/** Add an owner signature on the Queue Service. A 409 means it is already recorded. */
export async function confirmPendingOnTransactionService(
  safeTxHash: Hex,
  signature: Hex
): Promise<void> {
  try {
    await queueRequest(`/multisig-transactions/${safeTxHash}/signatures`, {
      method: 'POST',
      body: { signatures: [signature] },
    });
  } catch (error) {
    if (error instanceof SafeApiError && error.status === 409) return;
    throw error;
  }
}

type ServiceConfirmation = {
  owner: string;
  signature: string;
};

/**
 * A queued proposal, normalized from the Queue Service response to the shape the rest
 * of Curator uses: checksummed `to` / `gasToken` / `refundReceiver` (the service sends
 * null for an unset or zero address), `data` `0x` when empty, owners checksummed (the
 * service returns lowercase addresses).
 */
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
};

/** Queue Service `MultisigTransactionResponse` (fields Curator reads). */
type QueueMultisigTx = {
  safeTxHash: string;
  nonce: string;
  to: string | null;
  value: string;
  data: string | null;
  operation: number;
  safeTxGas: string;
  baseGas: string;
  gasPrice: string;
  gasToken: string | null;
  refundReceiver: string | null;
  confirmations?: Array<{ owner: string; signature: string }>;
};

type QueuePage<T> = { count: number; next: string | null; previous: string | null; results: T[] };

export function normalizeQueueMultisigTx(row: QueueMultisigTx): ServiceMultisigTx {
  const address = (value: string | null) => getAddress(value ?? zeroAddress);
  return {
    safeTxHash: row.safeTxHash,
    to: address(row.to),
    value: String(row.value ?? '0'),
    data: row.data ?? '0x',
    operation: Number(row.operation),
    safeTxGas: String(row.safeTxGas ?? '0'),
    baseGas: String(row.baseGas ?? '0'),
    gasPrice: String(row.gasPrice ?? '0'),
    gasToken: address(row.gasToken),
    refundReceiver: address(row.refundReceiver),
    nonce: row.nonce,
    confirmations: (row.confirmations ?? []).map((c) => ({
      owner: getAddress(c.owner),
      signature: c.signature,
    })),
  };
}

const PENDING_PAGE_SIZE = 100;
const PENDING_MAX_PAGES = 10;

/**
 * Every unexecuted proposal at or above the Safe's current nonce, all pages, from the
 * Queue Service `/multisig-transactions/queue` (it applies the nonce filter itself, so
 * no nonce needs to be passed).
 */
export async function fetchPendingMultisigTransactions(
  safeAddress: Address
): Promise<ServiceMultisigTx[]> {
  const address = getAddress(safeAddress);
  // Keyed by safeTxHash: a proposal added between page reads shifts the offset
  // and can return the same row on two pages.
  const byHash = new Map<string, ServiceMultisigTx>();
  for (let page = 0; page < PENDING_MAX_PAGES; page++) {
    const response = await queueRequest<QueuePage<QueueMultisigTx>>('/multisig-transactions/queue', {
      query: {
        safes: `${address}:${BASE_CHAIN_ID}`,
        nonceOrder: 'asc',
        limit: PENDING_PAGE_SIZE,
        offset: page * PENDING_PAGE_SIZE,
      },
    });
    const results = response?.results ?? [];
    for (const row of results) {
      const normalized = normalizeQueueMultisigTx(row);
      byHash.set(normalized.safeTxHash.toLowerCase(), normalized);
    }
    if (!response?.next || results.length < PENDING_PAGE_SIZE) break;
  }
  return [...byHash.values()];
}

type QueueDelegate = { delegate: string; delegator: string; label: string | null };

/** Delegates (proposers) of a Safe on Base, from the Queue Service, all pages. */
export async function fetchSafeDelegates(safeAddress: Address): Promise<QueueDelegate[]> {
  const address = getAddress(safeAddress);
  const delegates: QueueDelegate[] = [];
  for (let page = 0; page < PENDING_MAX_PAGES; page++) {
    const response = await queueRequest<QueuePage<QueueDelegate>>('/delegates', {
      query: { safe: address, chainId: BASE_CHAIN_ID, limit: 100, offset: page * 100 },
    });
    const results = response?.results ?? [];
    delegates.push(...results);
    if (!response?.next || results.length < 100) break;
  }
  return delegates;
}

export type ServiceHistoryTx = ServiceMultisigTx & {
  executionDate?: string | null;
  isSuccessful?: boolean | null;
  transactionHash?: string | null;
};

const HISTORY_LIMIT = 40;

/**
 * Executed Safe txs — on-demand only (free tier 5 req/s / 50K month).
 * Stays on the Transaction Service: on-chain history did not move to the Queue
 * Service (which only knows transactions that were proposed off-chain).
 * Uses the Transaction Service v2 multisig list directly. The api-kit GET
 * helper attaches a JSON body, which some server fetches turn into an empty list.
 */
export async function fetchExecutedMultisigTransactions(
  safeAddress: Address,
  options?: { limit?: number }
): Promise<ServiceHistoryTx[]> {
  const apiKey = safeApiKey();
  const address = getAddress(safeAddress);
  const url = new URL(
    `${SAFE_TX_SERVICE_BASE}/v2/safes/${address}/multisig-transactions/`
  );
  url.searchParams.set('executed', 'true');
  url.searchParams.set('ordering', '-nonce');
  url.searchParams.set('limit', String(options?.limit ?? HISTORY_LIMIT));

  const response = await withSafeTxServiceRateLimit(() =>
    fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(EXTERNAL_API_TIMEOUT_MS),
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
