import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, encodeFunctionData, keccak256, toFunctionSelector } from 'viem';
import { vaultV2Abi } from '@/lib/onchain/abis';
import { capTypeFromIdData, decodePendingCall } from '@/lib/morpho/vault-v2-pending-decode';

const ADDR = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf';
const collateralIdData = encodeAbiParameters(
  [{ type: 'string' }, { type: 'address' }],
  ['collateralToken', ADDR]
);
const adapterIdData = encodeAbiParameters([{ type: 'string' }, { type: 'address' }], ['this', ADDR]);

describe('capTypeFromIdData', () => {
  it('reads the cap kind from the idData tag', () => {
    expect(capTypeFromIdData(collateralIdData)).toBe('Collateral');
    expect(capTypeFromIdData(adapterIdData)).toBe('Adapter');
    expect(capTypeFromIdData('0x1234')).toBe('Unknown');
  });
});

describe('decodePendingCall', () => {
  it('decodes a cap increase with its amount, idData and cap id', () => {
    const data = encodeFunctionData({
      abi: vaultV2Abi,
      functionName: 'increaseAbsoluteCap',
      args: [collateralIdData, 50_000_000_000n],
    });
    expect(decodePendingCall(data)).toEqual({
      functionName: 'increaseAbsoluteCap',
      decoded: {
        type: 'IncreaseCap',
        cap: '50000000000',
        capType: 'Collateral',
        capId: keccak256(collateralIdData),
        idData: collateralIdData,
      },
    });
  });

  it('names the function a timelock change targets', () => {
    const selector = toFunctionSelector('setPerformanceFee(uint256)');
    const data = encodeFunctionData({
      abi: vaultV2Abi,
      functionName: 'increaseTimelock',
      args: [selector, 86_400n],
    });
    expect(decodePendingCall(data)?.decoded).toEqual({
      type: 'Timelock',
      selector,
      functionName: 'setPerformanceFee',
      timelock: '86400',
    });
  });

  it('decodes allocator grants', () => {
    const data = encodeFunctionData({ abi: vaultV2Abi, functionName: 'setIsAllocator', args: [ADDR, true] });
    expect(decodePendingCall(data)?.decoded).toEqual({ type: 'SetIsAllocator', account: ADDR, isAllocator: true });
  });

  it('returns null for calldata the vault ABI cannot decode', () => {
    expect(decodePendingCall('0xdeadbeef')).toBeNull();
  });
});
