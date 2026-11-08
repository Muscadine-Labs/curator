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
    expect(store.importPendingBundle(bundle)).toEqual({ ok: true, count: 1, skipped: 0 });

    const [merged] = store.getSafePendingSnapshot();
    expect(merged?.id).toBe('local');
    expect(merged?.description).toBe('local');
    expect(merged?.signatures.map((s) => s.signer).sort()).toEqual([OWNER_A, OWNER_B].sort());
  });
});

describe('sanitizeImportedPending', () => {
  it('drops a simulation warning carried in an imported bundle', async () => {
    const { sanitizeImportedPending } = await import('@/lib/safe/pending-store');
    const tx = { ...proposal([]), simulationWarning: 'Verified safe' };
    expect(sanitizeImportedPending(tx)?.simulationWarning).toBeNull();
  });
});

describe('bundle import validation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    stubWindow();
  });

  it('takes the role from config and resets status, dropping junk signatures', async () => {
    const { sanitizeImportedPending } = await import('@/lib/safe/pending-store');
    const tx = {
      ...proposal([OWNER_A]),
      safeRole: 'treasury' as const,
      status: 'ready' as const,
      signatures: [
        { signer: OWNER_A, data: '0x01' as Hex, signedAt: '' },
        { signer: 'not-an-address', data: '0x02' as Hex, signedAt: '' },
      ],
    } as SafePendingTransaction;
    const cleaned = sanitizeImportedPending(tx);
    expect(cleaned?.safeRole).toBe('allocator');
    expect(cleaned?.status).toBe('awaiting_signatures');
    expect(cleaned?.signatures.map((s) => s.signer)).toEqual([OWNER_A]);
  });

  it('rejects a row for a Safe this app does not manage', async () => {
    const { sanitizeImportedPending } = await import('@/lib/safe/pending-store');
    const tx = { ...proposal([]), safeAddress: OWNER_B };
    expect(sanitizeImportedPending(tx)).toBeNull();
  });

  it('skips a malformed row instead of failing the whole import', async () => {
    const store = await import('./pending-store');
    const good = { ...proposal([]), id: 'good' };
    const bad = { ...proposal([]), id: 'bad', safeTxHash: `0x${'cd'.repeat(32)}`, to: 'nope' };
    const result = store.importPendingBundle(JSON.stringify({ transactions: [good, bad] }));
    expect(result).toEqual({ ok: true, count: 1, skipped: 1 });
    expect(store.getSafePendingSnapshot().map((t) => t.id)).toEqual(['good']);
  });

  it('does not mutate the previous snapshot on upsert', async () => {
    const store = await import('./pending-store');
    store.upsertPendingTransaction(proposal([]));
    const before = store.getSafePendingSnapshot();
    const first = before[0];
    store.upsertPendingTransaction({ ...proposal([OWNER_A]) });
    expect(before[0]).toBe(first);
    expect(store.getSafePendingSnapshot()).not.toBe(before);
  });
});
