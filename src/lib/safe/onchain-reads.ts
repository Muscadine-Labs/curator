import { getAddress, type Address, zeroAddress } from 'viem';
import { publicClient } from '@/lib/onchain/client';
import { safeAbi } from '@/lib/safe/abis';
import type { SafeOnChainInfo } from '@/lib/safe/types';

const MODULES_SENTINEL = '0x0000000000000000000000000000000000000001' as Address;

export type SafeOnChainSettings = {
  modules: Address[];
  guard: Address | null;
};

export async function readSafeOnChainSettings(
  safeAddress: Address
): Promise<SafeOnChainSettings> {
  const address = getAddress(safeAddress);
  const [modulesResult, guardResult] = await publicClient.multicall({
    allowFailure: true,
    contracts: [
      {
        address,
        abi: safeAbi,
        functionName: 'getModulesPaginated',
        args: [MODULES_SENTINEL, 20n],
      },
      { address, abi: safeAbi, functionName: 'getGuard' },
    ],
  });

  const modules =
    modulesResult?.status === 'success'
      ? (modulesResult.result[0] as Address[]).map((m) => getAddress(m))
      : [];
  const guardRaw =
    guardResult?.status === 'success' ? getAddress(guardResult.result as Address) : null;
  const guard = guardRaw && guardRaw !== zeroAddress ? guardRaw : null;
  return { modules, guard };
}

export async function readSafeOnChainInfo(safeAddress: Address): Promise<SafeOnChainInfo> {
  const address = getAddress(safeAddress);

  // One multicall instead of four separate eth_calls — this route is hit on
  // every Safe page load and each round trip counts against the RPC quota.
  const [[owners, threshold, nonce, version], ethBalance] = await Promise.all([
    publicClient.multicall({
      contracts: [
        { address, abi: safeAbi, functionName: 'getOwners' },
        { address, abi: safeAbi, functionName: 'getThreshold' },
        { address, abi: safeAbi, functionName: 'nonce' },
        { address, abi: safeAbi, functionName: 'VERSION' },
      ],
      allowFailure: false,
    }),
    publicClient.getBalance({ address }),
  ]);

  return {
    address,
    owners: (owners as Address[]).map((o) => getAddress(o)),
    threshold: Number(threshold),
    nonce: nonce as bigint,
    version: version as string,
    ethBalance,
  };
}

export async function reconcilePendingNonce(
  safeAddress: Address,
  proposalNonce: bigint
): Promise<'valid' | 'stale'> {
  const { nonce } = await readSafeOnChainInfo(safeAddress);
  return proposalNonce < nonce ? 'stale' : 'valid';
}
