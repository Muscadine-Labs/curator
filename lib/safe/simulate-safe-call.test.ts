import { describe, expect, it } from 'vitest';
import { BaseError, ExecutionRevertedError, HttpRequestError } from 'viem';
import { isRevertError, safeCallRevertOutcome } from '@/lib/safe/simulate-safe-call';

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
