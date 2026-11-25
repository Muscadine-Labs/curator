import { getAddress, isAddress, parseAbi, zeroAddress, type Address } from 'viem';
import { isExpectedReadMiss, publicClient } from '@/lib/onchain/client';
import { logger } from '@/lib/utils/logger';

/** Every Morpho Vault V2 adapter exposes the vault it allocates for. */
const parentVaultAbi = parseAbi(['function parentVault() view returns (address)']);

/**
 * Whether an address is a Vault V2 adapter. A contract's answer never changes, so
 * reads that settled are kept for the process. RPC failures are not kept.
 */
const adapterByAddress = new Map<string, boolean>();
const MAX_CACHED = 20_000;

/**
 * Holders that are Morpho Vault V2 adapters (another vault allocating into this
 * one), read on-chain: `parentVault()` returns a non-zero vault. Wallets and other
 * contracts revert or return nothing. Used to keep adapters out of user counts
 * without listing them in config. An RPC failure leaves those addresses in.
 */
export async function findVaultAdapterHolders(
  addresses: Iterable<string>
): Promise<Set<string>> {
  const adapters = new Set<string>();
  const toRead: Address[] = [];
  const seen = new Set<string>();
  for (const raw of addresses) {
    const key = raw.toLowerCase();
    if (seen.has(key) || !isAddress(key)) continue;
    seen.add(key);
    const cached = adapterByAddress.get(key);
    if (cached === true) adapters.add(key);
    else if (cached === undefined) toRead.push(getAddress(key));
  }
  if (toRead.length === 0) return adapters;

  try {
    const results = await publicClient.multicall({
      allowFailure: true,
      contracts: toRead.map((address) => ({
        address,
        abi: parentVaultAbi,
        functionName: 'parentVault' as const,
      })),
    });
    if (adapterByAddress.size + toRead.length > MAX_CACHED) adapterByAddress.clear();
    results.forEach((result, i) => {
      const key = toRead[i]!.toLowerCase();
      if (result.status === 'success') {
        const isAdapter = result.result.toLowerCase() !== zeroAddress;
        adapterByAddress.set(key, isAdapter);
        if (isAdapter) adapters.add(key);
      } else if (isExpectedReadMiss(result.error)) {
        adapterByAddress.set(key, false);
      }
    });
  } catch (error) {
    logger.warn('Failed to check holders for Vault V2 adapters', {
      count: toRead.length,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return adapters;
}
