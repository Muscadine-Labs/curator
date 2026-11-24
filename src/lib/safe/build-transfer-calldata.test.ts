import { describe, expect, it } from 'vitest';
import { decodeFunctionData, erc20Abi, getAddress } from 'viem';
import { buildSafeTransferCalldata } from '@/lib/safe/build-transfer-calldata';
import { NATIVE_TOKEN_ADDRESS } from '@/lib/safe/tokens';

const RECIPIENT = getAddress('0x000000000000000000000000000000000000dEaD');
const USDC = getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');

describe('buildSafeTransferCalldata', () => {
  it('sends native ETH as a value transfer with no calldata', () => {
    const call = buildSafeTransferCalldata({
      token: NATIVE_TOKEN_ADDRESS,
      recipient: RECIPIENT,
      amount: 1_000_000_000_000_000n,
    });
    expect(call).toEqual({ to: RECIPIENT, data: '0x', value: 1_000_000_000_000_000n });
  });

  it('sends an ERC-20 as transfer() on the token with zero value', () => {
    const call = buildSafeTransferCalldata({
      token: USDC,
      recipient: RECIPIENT,
      amount: 2_500_000n,
    });
    expect(call.to).toBe(USDC);
    expect(call.value).toBe(0n);

    const decoded = decodeFunctionData({ abi: erc20Abi, data: call.data });
    expect(decoded.functionName).toBe('transfer');
    expect(decoded.args).toEqual([RECIPIENT, 2_500_000n]);
  });

  it('never targets the recipient directly for an ERC-20', () => {
    // Targeting the recipient with transfer calldata would be a silent no-op.
    const call = buildSafeTransferCalldata({ token: USDC, recipient: RECIPIENT, amount: 1n });
    expect(call.to).not.toBe(RECIPIENT);
  });

  it('rejects a zero or negative amount', () => {
    expect(() =>
      buildSafeTransferCalldata({ token: USDC, recipient: RECIPIENT, amount: 0n })
    ).toThrow(/greater than zero/i);
    expect(() =>
      buildSafeTransferCalldata({ token: USDC, recipient: RECIPIENT, amount: -1n })
    ).toThrow(/greater than zero/i);
  });

  it('checksums a lowercase recipient', () => {
    const call = buildSafeTransferCalldata({
      token: NATIVE_TOKEN_ADDRESS,
      recipient: RECIPIENT.toLowerCase() as `0x${string}`,
      amount: 1n,
    });
    expect(call.to).toBe(RECIPIENT);
  });
});
