import { encodeFunctionData, type Address, type Hex } from 'viem';
import { vaultV2Abi } from '@/lib/onchain/abis';

export type CuratorVaultWriteConfig = {
  address: Address;
  abi: typeof vaultV2Abi;
  functionName: string;
  args: readonly unknown[];
};

export function curatorWriteToCalldata(config: CuratorVaultWriteConfig): {
  to: Address;
  data: Hex;
} {
  return {
    to: config.address,
    data: encodeFunctionData({
      abi: vaultV2Abi,
      functionName: config.functionName as never,
      args: config.args as never,
    }),
  };
}
