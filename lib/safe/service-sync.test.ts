import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAddress, type Hex } from 'viem';
import type { SafePendingTransaction } from '@/lib/safe/types';

const SAFE = getAddress('0x2Ed45BB3542d06d81D117acd8A561e910A17A618');
const ZERO = getAddress('0x0000000000000000000000000000000000000000');
const OWNER = getAddress('0x00000000000000000000000000000000000000a1');
const HASH = `0x${'ab'.repeat(32)}`;

const serviceRow = {
  safeTxHash: HASH,
  to: SAFE,
  value: '0',
  data: '0x',
  operation: 0,
  safeTxGas: '0',
  baseGas: '0',
  gasPrice: '0',
  gasToken: ZERO,
  refundReceiver: ZERO,
  nonce: 5,
  confirmations: [{ owner: OWNER, signature: '0x01' }],
};

vi.mock('@/lib/safe/transaction-service', () => ({
  isTransactionServiceConfigured: () => true,
  fetchPendingMultisigTransactions: async () => [serviceRow],
  mapServiceConfirmations: (c: Array<{ owner: string; signature: string }> = []) =>
    c.map((x) => ({ signer: getAddress(x.owner), data: x.signature as Hex, signedAt: '' })),
  proposePendingToTransactionService: async () => undefined,
}));

function stubWindow() {
  const store = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
    dispatchEvent: () => true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
}

function local(status: SafePendingTransaction['status']): SafePendingTransaction {
  return {
    id: 'local',
    safeRole: 'allocator',
    safeAddress: SAFE,
    safeTxHash: HASH as Hex,
    to: SAFE,
    value: '0',
    data: '0x',
    operation: 0,
    safeTxGas: '0',
    baseGas: '0',
    gasPrice: '0',
    gasToken: ZERO,
    refundReceiver: ZERO,
    nonce: '5',
    status,
    proposer: null,
    description: 'local',
    source: { type: 'manual' },
    preview: null,
    signatures: [],
    createdAt: '',
    updatedAt: '',
  };
}

describe('syncPendingFromTransactionService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    stubWindow();
  });

  it('keeps a row this browser saw execute out of the queue while the service lags', async () => {
    const store = await import('./pending-store');
    const { syncPendingFromTransactionService } = await import('./service-sync');
    store.upsertPendingTransaction(local('executed'));
    await syncPendingFromTransactionService({ role: 'allocator', threshold: 1 });
    expect(store.getPendingById('local')?.status).toBe('executed');
  });

  it('still marks an open row ready once the service has enough signatures', async () => {
    const store = await import('./pending-store');
    const { syncPendingFromTransactionService } = await import('./service-sync');
    store.upsertPendingTransaction(local('awaiting_signatures'));
    await syncPendingFromTransactionService({ role: 'allocator', threshold: 1 });
    expect(store.getPendingById('local')?.status).toBe('ready');
  });
});
