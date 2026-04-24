import { Address, createPublicClient, http, getAddress, type Chain } from 'viem';
import { base } from 'viem/chains';
import { EIP7702_CONTRACTS, ERC1967_IMPLEMENTATION_SLOT } from './constants';

/**
 * Check if an address has code deployed (is a contract or upgraded EOA)
 */
async function hasCode(address: Address, chain: Chain = base): Promise<boolean> {
  try {
    const publicClient = createPublicClient({
      chain,
      transport: http(),
    });
    
    const code = await publicClient.getBytecode({ address });
    return code !== undefined && code !== '0x' && code.length > 2;
  } catch {
    return false;
  }
}

/**
 * Check if an EOA is delegated to EIP-7702 proxy
 * Returns the implementation address if delegated, null otherwise
 */
export async function getDelegationStatus(
  eoaAddress: Address,
  chain: Chain = base
): Promise<{ isDelegated: boolean; implementation: Address | null }> {
  try {
    const publicClient = createPublicClient({
      chain,
      transport: http(),
    });

    // Check if address has code (delegated EOA will have code)
    const code = await publicClient.getBytecode({ address: eoaAddress });
    const hasDeployedCode = code !== undefined && code !== '0x' && code.length > 2;

    if (!hasDeployedCode) {
      return { isDelegated: false, implementation: null };
    }

    // Read ERC-1967 implementation slot to get the implementation address
    const implSlot = await publicClient.getStorageAt({
      address: eoaAddress,
      slot: ERC1967_IMPLEMENTATION_SLOT,
    });

    if (!implSlot || implSlot === '0x0000000000000000000000000000000000000000000000000000000000000000') {
      return { isDelegated: false, implementation: null };
    }

    // Extract address from storage slot (last 40 chars = 20 bytes)
    const implementation = getAddress(`0x${implSlot.slice(-40)}`);

    return {
      isDelegated: true,
      implementation,
    };
  } catch {
    return { isDelegated: false, implementation: null };
  }
}

/**
 * Check if an address is an EOA (Externally Owned Account)
 */
export async function isEOA(address: Address, chain: Chain = base): Promise<boolean> {
  const code = await hasCode(address, chain);
  return !code;
}
