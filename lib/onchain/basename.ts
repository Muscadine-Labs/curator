import { parseAbi, type Address, type Hex } from 'viem';
import { publicClient } from '@/lib/onchain/client';

/** Basename contracts on Base (https://github.com/base/basenames). */
const BASENAME_REVERSE_REGISTRAR =
  '0x79ea96012eea67a83431f1701b3dff7e37f9e282' as Address;
const BASENAME_L2_RESOLVER =
  '0xC6d566A56A1aFf6508b41f6c90ff131615583BCD' as Address;

const reverseRegistrarAbi = parseAbi([
  'function node(address addr) view returns (bytes32)',
]);

const l2ResolverAbi = parseAbi([
  'function name(bytes32 node) view returns (string)',
]);

/**
 * Reverse Basenames for these addresses. Missing or failed lookups are omitted.
 * A failed batch returns an empty map so the caller can fall back to the address.
 */
export async function resolveBasenames(
  addresses: readonly Address[]
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (addresses.length === 0) return names;
  try {
    const nodes = await publicClient.multicall({
      allowFailure: true,
      contracts: addresses.map((address) => ({
        address: BASENAME_REVERSE_REGISTRAR,
        abi: reverseRegistrarAbi,
        functionName: 'node' as const,
        args: [address] as const,
      })),
    });
    const resolved: Array<{ address: Address; node: Hex }> = [];
    nodes.forEach((result, index) => {
      const address = addresses[index];
      if (result.status === 'success' && address) {
        resolved.push({ address, node: result.result });
      }
    });
    if (resolved.length === 0) return names;
    const labels = await publicClient.multicall({
      allowFailure: true,
      contracts: resolved.map((row) => ({
        address: BASENAME_L2_RESOLVER,
        abi: l2ResolverAbi,
        functionName: 'name' as const,
        args: [row.node] as const,
      })),
    });
    labels.forEach((result, index) => {
      const address = resolved[index]?.address;
      const name = result.status === 'success' ? result.result.trim() : '';
      if (address && name) names.set(address.toLowerCase(), name);
    });
  } catch {
    return new Map();
  }
  return names;
}
