import { getAddress, type Address } from 'viem';
import { publicClient } from '@/lib/onchain/client';
import { safeAbi } from '@/lib/safe/abis';
import type { SafeOnChainInfo } from '@/lib/safe/types';

export async function readSafeOnChainInfo(safeAddress: Address): Promise<SafeOnChainInfo> {
  const address = getAddress(safeAddress);

  const [owners, threshold, nonce, version, ethBalance] = await Promise.all([
    publicClient.readContract({
      address,
      abi: safeAbi,
      functionName: 'getOwners',
    }) as Promise<Address[]>,
    publicClient.readContract({
      address,
      abi: safeAbi,
      functionName: 'getThreshold',
    }) as Promise<bigint>,
    publicClient.readContract({
      address,
      abi: safeAbi,
      functionName: 'nonce',
    }) as Promise<bigint>,
    publicClient.readContract({
      address,
      abi: safeAbi,
      functionName: 'VERSION',
    }) as Promise<string>,
    publicClient.getBalance({ address }),
  ]);

  return {
    address,
    owners: owners.map((o) => getAddress(o)),
    threshold: Number(threshold),
    nonce,
    version,
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
