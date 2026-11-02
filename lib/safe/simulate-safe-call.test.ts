import { describe, expect, it } from 'vitest';
import { BaseError, ExecutionRevertedError, HttpRequestError } from 'viem';
import {
  countDistinctQueuedProposals,
  isRevertError,
  safeCallRevertOutcome,
} from '@/lib/safe/simulate-safe-call';

describe('isRevertError', () => {
  it('treats an execution revert as a revert', () => {
    const err = new BaseError('call failed', { cause: new ExecutionRevertedError({}) });
    expect(isRevertError(err)).toBe(true);
  });
  it('does not treat an RPC transport failure as a revert', () => {
    const err = new HttpRequestError({ url: 'https://rpc.example', status: 503 });
    expect(isRevertError(err)).toBe(false);
    expect(isRevertError(new Error('network down'))).toBe(false);
  });
});

describe('safeCallRevertOutcome', () => {
  it('blocks a reverting call when nothing is queued ahead', () => {
    const outcome = safeCallRevertOutcome('AbsoluteCapExceeded', 0);
    expect(outcome.block).toBe(true);
    if (outcome.block) expect(outcome.message).toContain('AbsoluteCapExceeded');
  });

  it('only warns when earlier proposals may change the state it needs', () => {
    const outcome = safeCallRevertOutcome('ERC20: transfer amount exceeds balance', 2);
    expect(outcome.block).toBe(false);
    if (!outcome.block) {
      expect(outcome.warning).toContain('2 earlier queued proposals');
      expect(outcome.warning).toContain('exceeds balance');
    }
  });
});

describe('countDistinctQueuedProposals', () => {
  it('counts a proposal that exists only on the Transaction Service', () => {
    expect(countDistinctQueuedProposals([], [{ safeTxHash: '0xAA', nonce: 7 }], 7)).toBe(1);
  });

  it('counts a proposal held both locally and on the service once', () => {
    expect(
      countDistinctQueuedProposals(['0xaa'], [{ safeTxHash: '0xAA', nonce: '7' }], 7)
    ).toBe(1);
  });

  it('ignores service rows below the on-chain nonce', () => {
    expect(
      countDistinctQueuedProposals(
        [],
        [
          { safeTxHash: '0x01', nonce: 5 },
          { safeTxHash: '0x02', nonce: 8 },
        ],
        7
      )
    ).toBe(1);
  });
});
