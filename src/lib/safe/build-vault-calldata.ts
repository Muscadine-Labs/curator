import {
  encodeFunctionData,
  getAddress,
  type Address,
  type Hex,
} from 'viem';
import { vaultV2Abi } from '@/lib/onchain/abis';
import {
  buildRebalanceMulticallData,
  type RebalancePlanRow,
} from '@/lib/onchain/v2-rebalance-plan';

/** Build vault calldata matching VaultV2Allocations handleRebalance semantics. */
export function buildVaultRebalanceCalldata(
  vaultAddress: Address,
  submitRows: ReadonlyArray<RebalancePlanRow>
): { to: Address; data: Hex } | null {
  const { deallocCalls, allocCalls } = buildRebalanceMulticallData(submitRows);
  const allCalls = [...deallocCalls, ...allocCalls];
  if (allCalls.length === 0) return null;

  const to = getAddress(vaultAddress);
  if (allCalls.length === 1) {
    return { to, data: allCalls[0] };
  }

  return {
    to,
    data: encodeFunctionData({
      abi: vaultV2Abi,
      functionName: 'multicall',
      args: [allCalls],
    }),
  };
}
