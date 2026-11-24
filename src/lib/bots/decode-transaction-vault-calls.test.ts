import { describe, expect, it } from 'vitest';
import {
  encodeFunctionData,
  encodePacked,
  getAddress,
  parseAbi,
  parseAbiItem,
  size,
  type Address,
  type Hex,
} from 'viem';
import { vaultV2Abi } from '@/lib/onchain/abis';
import { decodeTransactionVaultCalls } from './decode-vault-calls';

const VAULT = getAddress('0x89712980Cb434eF5aE4AB29349419eb976B0b496');
const OTHER = getAddress('0x00000000000000000000000000000000000000cc');
const MULTI_SEND_CALL_ONLY = getAddress('0x9641d764fc13c8B624c04430C7356C1C7C8102e2');
const ZERO = getAddress('0x0000000000000000000000000000000000000000');

const execTransaction = parseAbiItem(
  'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)'
);

function exec(to: Address, data: Hex, operation: 0 | 1): Hex {
  return encodeFunctionData({
    abi: [execTransaction],
    args: [to, 0n, data, operation, 0n, 0n, 0n, ZERO, ZERO, '0x'],
  });
}

const revoke = encodeFunctionData({ abi: vaultV2Abi, functionName: 'revoke', args: ['0x1234'] });

describe('decodeTransactionVaultCalls', () => {
  it('decodes a direct vault call', () => {
    const result = decodeTransactionVaultCalls(revoke, VAULT);
    expect(result.viaSafe).toBe(false);
    expect(result.summary.hasSentinelAction).toBe(true);
  });

  it('unwraps a Safe execTransaction to the vault', () => {
    const result = decodeTransactionVaultCalls(exec(VAULT, revoke, 0), VAULT);
    expect(result.viaSafe).toBe(true);
    expect(result.summary.roleChanges).toEqual([{ kind: 'revoke', account: null, isAllocator: null }]);
  });

  it('unwraps a MultiSend batch and keeps only calls to the vault', () => {
    const pack = (to: Address, data: Hex) =>
      encodePacked(['uint8', 'address', 'uint256', 'uint256', 'bytes'], [0, to, 0n, BigInt(size(data)), data]);
    const batch = encodeFunctionData({
      abi: parseAbi(['function multiSend(bytes transactions)']),
      args: [`0x${pack(OTHER, revoke).slice(2)}${pack(VAULT, revoke).slice(2)}` as Hex],
    });
    const result = decodeTransactionVaultCalls(exec(MULTI_SEND_CALL_ONLY, batch, 1), VAULT);
    expect(result.viaSafe).toBe(true);
    expect(result.summary.roleChanges).toHaveLength(1);
  });

  it('ignores a Safe call to some other contract', () => {
    const result = decodeTransactionVaultCalls(exec(OTHER, revoke, 0), VAULT);
    expect(result.viaSafe).toBe(true);
    expect(result.summary.hasSentinelAction).toBe(false);
  });
});
