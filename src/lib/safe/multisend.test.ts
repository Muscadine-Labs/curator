import { describe, expect, it } from 'vitest';
import {
  encodeFunctionData,
  encodePacked,
  erc20Abi,
  getAddress,
  parseAbi,
  size,
  type Address,
  type Hex,
} from 'viem';
import { decodeMultiSend, isKnownMultiSend, safeTransactionHazards } from './multisend';

const MULTI_SEND_CALL_ONLY_141 = getAddress('0x9641d764fc13c8B624c04430C7356C1C7C8102e2');
const ATTACKER = getAddress('0x00000000000000000000000000000000000000aa');
const VAULT = getAddress('0x00000000000000000000000000000000000000bb');

function packTx(operation: 0 | 1, to: Address, value: bigint, data: Hex): Hex {
  return encodePacked(
    ['uint8', 'address', 'uint256', 'uint256', 'bytes'],
    [operation, to, value, BigInt(size(data)), data]
  );
}

function multiSend(...txs: Hex[]): Hex {
  const packed = `0x${txs.map((t) => t.slice(2)).join('')}` as Hex;
  return encodeFunctionData({
    abi: parseAbi(['function multiSend(bytes transactions)']),
    args: [packed],
  });
}

const transferData = encodeFunctionData({
  abi: erc20Abi,
  functionName: 'transfer',
  args: [ATTACKER, 5n],
});

describe('decodeMultiSend', () => {
  it('decodes packed inner transactions', () => {
    const data = multiSend(packTx(0, VAULT, 0n, transferData), packTx(0, ATTACKER, 7n, '0x'));
    expect(decodeMultiSend(data)).toEqual([
      { operation: 0, to: VAULT, value: 0n, data: transferData },
      { operation: 0, to: ATTACKER, value: 7n, data: '0x' },
    ]);
  });

  it('rejects non-multiSend calldata', () => {
    expect(decodeMultiSend(transferData)).toBeNull();
  });
});

describe('safeTransactionHazards', () => {
  it('passes plain Calls', () => {
    expect(safeTransactionHazards({ to: VAULT, operation: 0, data: transferData })).toEqual({
      messages: [],
      blocking: false,
    });
  });

  it('blocks DelegateCall to an unknown contract even when calldata looks like a transfer', () => {
    const result = safeTransactionHazards({ to: ATTACKER, operation: 1, data: transferData });
    expect(result.blocking).toBe(true);
    expect(result.messages[0]).toMatch(/not a Safe MultiSend/);
  });

  it('allows a MultiSendCallOnly batch of Calls', () => {
    expect(isKnownMultiSend(MULTI_SEND_CALL_ONLY_141.toLowerCase())).toBe(true);
    const data = multiSend(packTx(0, VAULT, 0n, transferData));
    expect(
      safeTransactionHazards({ to: MULTI_SEND_CALL_ONLY_141, operation: 1, data }).blocking
    ).toBe(false);
  });

  it('blocks a nested DelegateCall inside a MultiSend', () => {
    const data = multiSend(packTx(1, ATTACKER, 0n, '0x'));
    const result = safeTransactionHazards({ to: MULTI_SEND_CALL_ONLY_141, operation: 1, data });
    expect(result.blocking).toBe(true);
    expect(result.messages[0]).toMatch(/Nested DelegateCall/);
  });
});
