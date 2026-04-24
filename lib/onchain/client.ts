import { createPublicClient, http, Address, Abi } from 'viem';
import { base } from 'viem/chains';
import { logger } from '@/lib/utils/logger';

// Determine RPC URL based on available API keys
// Priority: ALCHEMY_API_KEY > COINBASE_CDP_API_KEY > demo fallback
function getRpcUrl(): string {
  // Alchemy (primary)
  if (process.env.ALCHEMY_API_KEY) {
    return `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
  }
  
  // Coinbase CDP fallback (if using CDP RPC service)
  // Format may be: https://base-mainnet.cdp.coinbase.com/v1/[API_KEY]
  // Or: https://base.cdp.coinbase.com/[API_KEY]
  // Check Coinbase CDP docs for exact endpoint format
  if (process.env.COINBASE_CDP_API_KEY) {
    return `https://base-mainnet.cdp.coinbase.com/v1/${process.env.COINBASE_CDP_API_KEY}`;
  }
  
  // Demo fallback (rate limited)
  return 'https://base-mainnet.g.alchemy.com/v2/demo';
}

// Base chain configuration
const baseChain = {
  ...base,
  rpcUrls: {
    default: {
      http: [getRpcUrl()],
    },
    public: {
      http: [getRpcUrl()],
    },
  },
};

// Create viem public client
export const publicClient = createPublicClient({
  chain: baseChain,
  transport: http(),
});

// Minimal ABIs for contract interactions
export const VAULT_ABI = [
  {
    name: 'asset',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'totalAssets',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'totalSupply',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'convertToAssets',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'performanceFeeBps',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint16' }],
  },
  {
    name: 'lastHarvest',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  // Vault role functions (if available on contract)
  {
    name: 'owner',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'curator',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'guardian',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'timelock',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  // Allocator functions (if available)
  {
    name: 'allocators',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address[]' }],
  },
  {
    name: 'getAllocators',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address[]' }],
  },
  // MetaMorpho V1.1 write functions for role management
  {
    name: 'setCurator',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newCurator', type: 'address' }],
    outputs: [],
  },
  {
    name: 'submitGuardian',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newGuardian', type: 'address' }],
    outputs: [],
  },
  {
    name: 'acceptGuardian',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'setIsAllocator',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'allocator', type: 'address' },
      { name: 'newIsAllocator', type: 'bool' },
    ],
    outputs: [],
  },
  {
    name: 'transferOwnership',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newOwner', type: 'address' }],
    outputs: [],
  },
  {
    name: 'renounceOwnership',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  // Check if allocator is enabled (mapping-based)
  {
    name: 'isAllocator',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'allocator', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  // Pending guardian functions
  {
    name: 'pendingGuardian',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  // Reallocate function for MetaMorpho V1 vaults
  // Matches Morpho documentation: https://docs.morpho.org/get-started/resources/contracts/morpho-vaults
  {
    name: 'reallocate',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'allocations',
        type: 'tuple[]',
        components: [
          {
            name: 'marketParams',
            type: 'tuple',
            components: [
              { name: 'loanToken', type: 'address' },
              { name: 'collateralToken', type: 'address' },
              { name: 'oracle', type: 'address' },
              { name: 'irm', type: 'address' },
              { name: 'lltv', type: 'uint256' },
            ],
          },
          { name: 'assets', type: 'uint256' },
        ],
      },
    ],
    outputs: [],
  },
] as const;

// Helper function to safely read contract data
export const safeContractRead = async <T>(
  contractAddress: Address,
  abi: Abi,
  functionName: string,
  args: unknown[] = []
): Promise<T | null> => {
  try {
    const result = await publicClient.readContract({
      address: contractAddress,
      abi,
      functionName,
      args,
    });
    return result as T;
  } catch (error) {
    logger.warn(`Failed to read ${functionName} from ${contractAddress}`, {
      contractAddress,
      functionName,
      error: error instanceof Error ? error : new Error(String(error)),
    });
    return null;
  }
};

// Helper function for multicall
export const multicallRead = async <T>(
  contracts: Array<{
    address: Address;
    abi: Abi;
    functionName: string;
    args?: unknown[];
  }>
): Promise<(T | null)[]> => {
  try {
    const results = await publicClient.multicall({
      contracts: contracts.map(contract => ({
        address: contract.address,
        abi: contract.abi,
        functionName: contract.functionName,
        args: contract.args || [],
      })),
    });
    
    return results.map(result => {
      if (result.status === 'success') {
        return result.result as T;
      }
      return null;
    });
  } catch (error) {
    logger.warn('Multicall failed', {
      contractCount: contracts.length,
      error: error instanceof Error ? error : new Error(String(error)),
    });
    return contracts.map(() => null);
  }
};
