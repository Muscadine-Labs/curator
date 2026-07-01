import { encodeFunctionData, type Address, type Hex } from 'viem';
import type { TimelockInfo } from '@/app/api/vaults/[id]/governance/route';
import { vaultV2Abi } from '@/lib/onchain/abis';
import { v2WriteConfigs } from '@/lib/onchain/vault-writes';
import { isTimelockAbdicated } from '@/lib/morpho/vault-v2-timelocks';

export type CuratorVaultWriteConfig = {
  address: Address;
  abi: typeof vaultV2Abi;
  functionName: string;
  args: readonly unknown[];
};

export function timelockForFunction(
  timelocks: ReadonlyArray<TimelockInfo>,
  functionName: string
): TimelockInfo | undefined {
  return timelocks.find((t) => t.functionName === functionName);
}

/** Route curator governance writes through `submit` when the function has a non-zero timelock. */
export function wrapCuratorWriteWithTimelock(
  vaultAddress: Address,
  inner: CuratorVaultWriteConfig,
  timelocks: ReadonlyArray<TimelockInfo>
): {
  config: CuratorVaultWriteConfig;
  viaSubmit: boolean;
  error: string | null;
} {
  const tl = timelockForFunction(timelocks, inner.functionName);

  if (tl && isTimelockAbdicated(tl.abdicatedAt)) {
    return {
      config: inner,
      viaSubmit: false,
      error: `${inner.functionName} is permanently disabled on this vault.`,
    };
  }

  const duration = tl?.durationSeconds ?? 0;
  if (duration === 0) {
    return { config: inner, viaSubmit: false, error: null };
  }

  const data = encodeFunctionData({
    abi: vaultV2Abi,
    functionName: inner.functionName as never,
    args: inner.args as never,
  }) as Hex;

  return {
    config: v2WriteConfigs.submit(vaultAddress, data),
    viaSubmit: true,
    error: null,
  };
}

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
