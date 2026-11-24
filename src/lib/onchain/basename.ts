import { namehash, parseAbi, zeroAddress, type Address, type Hex } from 'viem';
import { publicClient } from '@/lib/onchain/client';

/** Basename contracts on Base (https://github.com/base/basenames). */
const BASENAME_REVERSE_REGISTRAR =
  '0x79ea96012eea67a83431f1701b3dff7e37f9e282' as Address;
const BASENAME_L2_RESOLVER =
  '0xC6d566A56A1aFf6508b41f6c90ff131615583BCD' as Address;
const BASENAME_REGISTRY =
  '0xb94704422c2a1e396835a571837aa5ae53285a95' as Address;

const reverseRegistrarAbi = parseAbi([
  'function node(address addr) view returns (bytes32)',
]);

const l2ResolverAbi = parseAbi([
  'function name(bytes32 node) view returns (string)',
]);

const registryAbi = parseAbi([
  'function resolver(bytes32 node) view returns (address)',
]);

const addrResolverAbi = parseAbi([
  'function addr(bytes32 node) view returns (address)',
]);

/**
 * Reverse Basenames for these addresses. Missing or failed lookups are omitted.
 * A failed batch returns an empty map so the caller can fall back to the address.
 *
 * Anyone can set their reverse record to any name, so a name is kept only when
 * it resolves forward to the same address. The forward read uses the name's own
 * resolver from the registry: newer names live on a different resolver than
 * the one that holds reverse records.
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
    const claimed: Array<{ address: Address; name: string; node: Hex }> = [];
    labels.forEach((result, index) => {
      const address = resolved[index]?.address;
      const name = result.status === 'success' ? result.result.trim() : '';
      if (!address || !name) return;
      try {
        claimed.push({ address, name, node: namehash(name) });
      } catch {
        // Not a normalizable name: never shown.
      }
    });
    if (claimed.length === 0) return names;
    const resolvers = await publicClient.multicall({
      allowFailure: true,
      contracts: claimed.map((row) => ({
        address: BASENAME_REGISTRY,
        abi: registryAbi,
        functionName: 'resolver' as const,
        args: [row.node] as const,
      })),
    });
    const withResolver: Array<{ address: Address; name: string; node: Hex; resolver: Address }> = [];
    resolvers.forEach((result, index) => {
      const row = claimed[index];
      if (row && result.status === 'success' && result.result !== zeroAddress) {
        withResolver.push({ ...row, resolver: result.result });
      }
    });
    if (withResolver.length === 0) return names;
    const forward = await publicClient.multicall({
      allowFailure: true,
      contracts: withResolver.map((row) => ({
        address: row.resolver,
        abi: addrResolverAbi,
        functionName: 'addr' as const,
        args: [row.node] as const,
      })),
    });
    forward.forEach((result, index) => {
      const row = withResolver[index];
      if (
        row &&
        result.status === 'success' &&
        result.result.toLowerCase() === row.address.toLowerCase()
      ) {
        names.set(row.address.toLowerCase(), row.name);
      }
    });
  } catch {
    return new Map();
  }
  return names;
}
