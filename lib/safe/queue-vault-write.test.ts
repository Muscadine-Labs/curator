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

  it('rejects a range that would strand a later queued nonce', () => {
    const five = queued({ nonce: '5' });
    const six = queued({ nonce: '6' });
    const seven = queued({ nonce: '7' });
    expect(() => prepareSafeBatchSelection([five, six], [five, six, seven])).toThrow(
      /nonce 7 would be stranded/
    );
  });

  it('accepts the tail of the queue and ignores executed or other-Safe rows', () => {
    const five = queued({ nonce: '5' });
    const six = queued({ nonce: '6' });
    const executed = queued({ nonce: '9', status: 'executed' });
    const otherSafe = queued({
      nonce: '9',
      id: 'other',
      safeAddress: getAddress('0x0000000000000000000000000000000000000001'),
    });
    expect(
      prepareSafeBatchSelection([five, six], [five, six, executed, otherSafe]).map((t) => t.nonce)
    ).toEqual(['5', '6']);
  });
});
