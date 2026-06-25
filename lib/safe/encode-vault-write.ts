import { encodeFunctionData, getAddress, type Address, type Hex } from 'viem';
import { vaultV2Abi } from '@/lib/onchain/abis';

export type VaultWriteCalldataInput = {
  address: Address;
  functionName:
    | 'allocate'
    | 'deallocate'
    | 'multicall'
    | 'decreaseAbsoluteCap'
    | 'decreaseRelativeCap';
  args: readonly unknown[];
};

/** Encode a vault write config into Safe meta-tx calldata (to = vault). */
export function vaultWriteToCalldata(config: VaultWriteCalldataInput): {
  to: Address;
  data: Hex;
} {
  return {
    to: getAddress(config.address),
    data: encodeFunctionData({
      abi: vaultV2Abi,
      functionName: config.functionName,
      args: config.args as never,
    }),
  };
}
