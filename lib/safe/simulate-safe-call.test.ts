import { describe, expect, it } from 'vitest';
import { BaseError, ExecutionRevertedError, HttpRequestError } from 'viem';
import { isRevertError } from '@/lib/safe/simulate-safe-call';

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
