import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAddress, type Hex } from 'viem';
import type { SafePendingTransaction } from '@/lib/safe/types';

const SAFE = getAddress('0x2Ed45BB3542d06d81D117acd8A561e910A17A618');
const ZERO = getAddress('0x0000000000000000000000000000000000000000');
const OWNER_A = getAddress('0x00000000000000000000000000000000000000a1');
const OWNER_B = getAddress('0x00000000000000000000000000000000000000b2');

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

function proposal(signers: string[]): SafePendingTransaction {
  return {
    id: 'local',
    safeRole: 'allocator',
    safeAddress: SAFE,
    safeTxHash: `0x${'ab'.repeat(32)}` as Hex,
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
    status: 'awaiting_signatures',
    proposer: null,
    description: 'local',
    source: { type: 'manual' },
    preview: null,
    signatures: signers.map((signer) => ({
      signer: getAddress(signer),
      data: '0x01' as Hex,
      signedAt: '',
    })),
    createdAt: '',
    updatedAt: '',
  };
}

describe('importPendingBundle', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    stubWindow();
  });

  it('unions signatures with a proposal already held locally', async () => {
    const store = await import('./pending-store');
    store.upsertPendingTransaction(proposal([OWNER_B]));
    const bundle = JSON.stringify({
      transactions: [{ ...proposal([OWNER_A]), id: 'theirs', description: 'theirs' }],
    });
    expect(store.importPendingBundle(bundle)).toEqual({ ok: true, count: 1 });

    const [merged] = store.getSafePendingSnapshot();
    expect(merged?.id).toBe('local');
    expect(merged?.description).toBe('local');
    expect(merged?.signatures.map((s) => s.signer).sort()).toEqual([OWNER_A, OWNER_B].sort());
  });
});
