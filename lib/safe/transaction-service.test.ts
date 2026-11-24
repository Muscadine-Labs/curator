import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { zeroAddress, type Hex } from 'viem';
import {
  SAFE_QUEUE_SERVICE_BASE,
  confirmPendingOnTransactionService,
  fetchPendingMultisigTransactions,
  fetchSafeDelegates,
  normalizeQueueMultisigTx,
  proposePendingToTransactionService,
} from '@/lib/safe/transaction-service';
import type { SafePendingTransaction } from '@/lib/safe/types';

const SAFE = '0x2Ed45BB3542d06d81D117acd8A561e910A17A618';
const VAULT = '0x89712980Cb434eF5aE4AB29349419eb976B0b496';
const HASH = '0x1111111111111111111111111111111111111111111111111111111111111111' as Hex;
const SIG = `0x${'ab'.repeat(65)}` as Hex;

const fetchMock = vi.fn();

function reply(status: number, body: unknown) {
  return new Response(body === undefined ? '' : JSON.stringify(body), { status });
}

function pendingTx(): SafePendingTransaction {
  return {
    safeAddress: SAFE,
    safeTxHash: HASH,
    to: VAULT,
    value: '12345678901234567890',
    data: '0xdeadbeef',
    operation: 0,
    safeTxGas: '0',
    baseGas: '0',
    gasPrice: '0',
    gasToken: zeroAddress,
    refundReceiver: zeroAddress,
    nonce: '7',
  } as unknown as SafePendingTransaction;
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SAFE_API_KEY', 'test-key');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Safe Queue Service: propose', () => {
  it('posts the tx to the queue with chainId, safe, decimal-string values and the signature', async () => {
    fetchMock.mockResolvedValueOnce(reply(201, { safeTxHash: HASH }));
    await proposePendingToTransactionService({ tx: pendingTx(), senderAddress: SAFE, senderSignature: SIG });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`${SAFE_QUEUE_SERVICE_BASE}/multisig-transactions`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      chainId: 8453,
      safe: SAFE,
      to: VAULT,
      value: '12345678901234567890',
      data: '0xdeadbeef',
      operation: 0,
      nonce: 7,
      signatures: [SIG],
      originName: 'Curator',
    });
  });

  it('rejects when the service stores a different safeTxHash', async () => {
    fetchMock.mockResolvedValueOnce(reply(201, { safeTxHash: `0x${'22'.repeat(32)}` }));
    await expect(
      proposePendingToTransactionService({ tx: pendingTx(), senderAddress: SAFE, senderSignature: SIG })
    ).rejects.toThrow(/stored this proposal as/);
  });

  it('on 409 (already queued) adds the signer\'s signature to the existing proposal', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(409, { detail: 'Transaction already exists' }))
      .mockResolvedValueOnce(reply(201, []));
    await expect(
      proposePendingToTransactionService({ tx: pendingTx(), senderAddress: SAFE, senderSignature: SIG })
    ).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(String(url)).toBe(`${SAFE_QUEUE_SERVICE_BASE}/multisig-transactions/${HASH}/signatures`);
    expect(JSON.parse(init.body)).toEqual({ signatures: [SIG] });
  });

  it('on 409 then 422 (delegate signer) treats the proposal as shared', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(409, { detail: 'Transaction already exists' }))
      .mockResolvedValueOnce(reply(422, { detail: 'Signer is not an owner' }));
    await expect(
      proposePendingToTransactionService({ tx: pendingTx(), senderAddress: SAFE, senderSignature: SIG })
    ).resolves.toBeUndefined();
  });

  it('on 409 surfaces a failed signature post', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(409, { detail: 'Transaction already exists' }))
      .mockResolvedValueOnce(reply(500, { detail: 'boom' }));
    await expect(
      proposePendingToTransactionService({ tx: pendingTx(), senderAddress: SAFE, senderSignature: SIG })
    ).rejects.toThrow();
  });

  it('surfaces validation errors from the detail list', async () => {
    fetchMock.mockResolvedValueOnce(reply(422, { detail: [{ msg: 'Nonce below current' }, { msg: 'Bad sig' }] }));
    await expect(
      proposePendingToTransactionService({ tx: pendingTx(), senderAddress: SAFE, senderSignature: SIG })
    ).rejects.toThrow('Nonce below current; Bad sig');
  });
});

describe('Safe Queue Service: confirm', () => {
  it('posts the signature to /signatures as an array', async () => {
    fetchMock.mockResolvedValueOnce(reply(201, []));
    await confirmPendingOnTransactionService(HASH, SIG);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`${SAFE_QUEUE_SERVICE_BASE}/multisig-transactions/${HASH}/signatures`);
    expect(JSON.parse(init.body)).toEqual({ signatures: [SIG] });
  });

  it('treats a duplicate signature (409) as done', async () => {
    fetchMock.mockResolvedValueOnce(reply(409, { detail: 'Signature already exists' }));
    await expect(confirmPendingOnTransactionService(HASH, SIG)).resolves.toBeUndefined();
  });
});

describe('Safe Queue Service: pending queue', () => {
  it('reads /multisig-transactions/queue for safe:chainId and normalizes rows', async () => {
    fetchMock.mockResolvedValueOnce(
      reply(200, {
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            safeTxHash: HASH,
            nonce: '7',
            to: VAULT.toLowerCase(),
            value: '0',
            data: null,
            operation: 0,
            safeTxGas: '0',
            baseGas: '0',
            gasPrice: '0',
            gasToken: null,
            refundReceiver: null,
            confirmations: [{ owner: SAFE.toLowerCase(), signature: SIG }],
          },
        ],
      })
    );
    const rows = await fetchPendingMultisigTransactions(SAFE);
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.pathname).toBe('/queue/api/v1/multisig-transactions/queue');
    expect(url.searchParams.get('safes')).toBe(`${SAFE}:8453`);
    expect(url.searchParams.get('nonceOrder')).toBe('asc');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      to: VAULT,
      data: '0x',
      gasToken: zeroAddress,
      refundReceiver: zeroAddress,
      confirmations: [{ owner: SAFE, signature: SIG }],
    });
  });

  it('pages until next is null and dedupes by safeTxHash', async () => {
    const row = (n: number) => ({
      safeTxHash: `0x${n.toString(16).padStart(64, '0')}`,
      nonce: String(n),
      to: VAULT,
      value: '0',
      data: '0x',
      operation: 0,
      safeTxGas: '0',
      baseGas: '0',
      gasPrice: '0',
      gasToken: null,
      refundReceiver: null,
      confirmations: [],
    });
    const page1 = Array.from({ length: 100 }, (_, i) => row(i + 1));
    fetchMock
      .mockResolvedValueOnce(reply(200, { count: 101, next: 'x', previous: null, results: page1 }))
      .mockResolvedValueOnce(reply(200, { count: 101, next: null, previous: 'x', results: [row(100), row(101)] }));
    const rows = await fetchPendingMultisigTransactions(SAFE);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetchMock.mock.calls[1]![0])).searchParams.get('offset')).toBe('100');
    expect(rows).toHaveLength(101);
  });
});

describe('Safe Queue Service: delegates', () => {
  it('filters by safe and Base chainId', async () => {
    fetchMock.mockResolvedValueOnce(
      reply(200, { count: 1, next: null, previous: null, results: [{ delegate: VAULT, delegator: SAFE, label: null }] })
    );
    const delegates = await fetchSafeDelegates(SAFE);
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.pathname).toBe('/queue/api/v1/delegates');
    expect(url.searchParams.get('safe')).toBe(SAFE);
    expect(url.searchParams.get('chainId')).toBe('8453');
    expect(delegates).toHaveLength(1);
  });
});

describe('normalizeQueueMultisigTx', () => {
  it('maps null addresses to the zero address and keeps nonce', () => {
    const out = normalizeQueueMultisigTx({
      safeTxHash: HASH,
      nonce: '3',
      to: null,
      value: '1',
      data: null,
      operation: 1,
      safeTxGas: '0',
      baseGas: '0',
      gasPrice: '0',
      gasToken: null,
      refundReceiver: null,
    });
    expect(out.to).toBe(zeroAddress);
    expect(out.data).toBe('0x');
    expect(out.nonce).toBe('3');
    expect(out.operation).toBe(1);
    expect(out.confirmations).toEqual([]);
  });
});
