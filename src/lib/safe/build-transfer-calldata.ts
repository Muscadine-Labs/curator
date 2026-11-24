import { encodeFunctionData, erc20Abi, getAddress, type Address, type Hex } from 'viem';
import { isNativeToken, type SafeTokenAddress } from '@/lib/safe/tokens';

export type SafeTransferCalldata = { to: Address; data: Hex; value: bigint };

/**
 * Calldata for moving an asset out of a Safe.
 *
 * Native ETH leaves as a plain value transfer to the recipient; an ERC-20 is a
 * `transfer` call on the token contract with the Safe as `msg.sender`. Both are
 * ordinary `Call` operations — never `DelegateCall`, which would run the
 * target's code against the Safe's own storage.
 */
export function buildSafeTransferCalldata(options: {
  token: SafeTokenAddress;
  recipient: Address;
  amount: bigint;
}): SafeTransferCalldata {
  const recipient = getAddress(options.recipient);
  if (options.amount <= 0n) {
    throw new Error('Transfer amount must be greater than zero.');
  }

  if (isNativeToken(options.token)) {
    return { to: recipient, data: '0x', value: options.amount };
  }

  return {
    to: getAddress(options.token),
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [recipient, options.amount],
    }),
    value: 0n,
  };
}
