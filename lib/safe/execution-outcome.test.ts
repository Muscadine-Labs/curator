import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, getAddress, keccak256, toHex, type Hex, type Log } from 'viem';
import { safeExecutionOutcome } from '@/lib/safe/execution-outcome';

const SAFE = getAddress('0x2Ed45BB3542d06d81D117acd8A561e910A17A618');
const OTHER = getAddress('0x00000000000000000000000000000000000000a1');
const HASH = `0x${'ab'.repeat(32)}` as Hex;

function safeLog(event: 'ExecutionSuccess' | 'ExecutionFailure', address = SAFE, txHash = HASH): Log {
  return {
    address,
    topics: [keccak256(toHex(`${event}(bytes32,uint256)`))],
    data: encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [txHash, 0n]),
    blockHash: null,
    blockNumber: null,
    logIndex: null,
    transactionHash: null,
    transactionIndex: null,
    removed: false,
  } as Log;
}

describe('safeExecutionOutcome', () => {
  it('reads success and failure for this Safe and hash', () => {
    expect(safeExecutionOutcome([safeLog('ExecutionSuccess')], SAFE, HASH)).toBe('success');
    expect(safeExecutionOutcome([safeLog('ExecutionFailure')], SAFE, HASH)).toBe('failure');
  });

  it('ignores events from another contract or for another tx', () => {
    expect(safeExecutionOutcome([safeLog('ExecutionFailure', OTHER)], SAFE, HASH)).toBe('unknown');
    const otherHash = `0x${'cd'.repeat(32)}` as Hex;
    expect(safeExecutionOutcome([safeLog('ExecutionFailure', SAFE, otherHash)], SAFE, HASH)).toBe(
      'unknown'
    );
  });
});
