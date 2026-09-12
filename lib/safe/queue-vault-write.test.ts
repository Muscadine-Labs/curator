import { describe, expect, it } from 'vitest';
import { getAddress, type Hex } from 'viem';
import { prepareSafeBatchSelection } from '@/lib/safe/queue-vault-write';
import type { SafePendingTransaction } from '@/lib/safe/types';

const SAFE = getAddress('0x2Ed45BB3542d06d81D117acd8A561e910A17A618');
const ZERO = getAddress('0x0000000000000000000000000000000000000000');

function queued(partial: Partial<SafePendingTransaction> & { nonce: string }): SafePendingTransaction {
  return {
    id: partial.id ?? `n-${partial.nonce}`,
    safeRole: 'allocator',
    safeAddress: SAFE,
    safeTxHash: `0x${partial.nonce.padStart(64, '0')}` as Hex,
    to: SAFE,
    value: '0',
    data: '0x',
    operation: 0,
    safeTxGas: '0',
    baseGas: '0',
    gasPrice: '0',
    gasToken: ZERO,
    refundReceiver: ZERO,
    status: 'awaiting_signatures',
    proposer: null,
    description: `nonce ${partial.nonce}`,
    source: { type: 'manual' },
    preview: null,
    signatures: [],
    createdAt: '',
    updatedAt: '',
    serviceSynced: false,
    ...partial,
  };
}

describe('prepareSafeBatchSelection', () => {
  it('accepts a contiguous local-only Call range', () => {
    const ordered = prepareSafeBatchSelection([queued({ nonce: '12' }), queued({ nonce: '11' })]);
    expect(ordered.map((tx) => tx.nonce)).toEqual(['11', '12']);
  });

  it('rejects when the earliest nonce is already on Transaction Service', () => {
    expect(() =>
      prepareSafeBatchSelection([
        queued({ nonce: '11', serviceSynced: true }),
        queued({ nonce: '12' }),
      ])
    ).toThrow(/already on Transaction Service/);
  });

  it('rejects when a later nonce is already on Transaction Service', () => {
    expect(() =>
      prepareSafeBatchSelection([
        queued({ nonce: '11' }),
        queued({ nonce: '12', serviceSynced: true }),
      ])
    ).toThrow(/already on Transaction Service/);
  });

  it('rejects DelegateCall rows', () => {
    expect(() =>
      prepareSafeBatchSelection([queued({ nonce: '11' }), queued({ nonce: '12', operation: 1 })])
    ).toThrow(/DelegateCall/);
  });
});
