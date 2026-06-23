import { createPublicClient, http, Address, Abi } from 'viem';
import { base } from '@/lib/onchain/base-chain';
import { logger } from '@/lib/utils/logger';

function getRpcUrl(): string {
  if (process.env.ALCHEMY_API_KEY) {
    return `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
  }

  if (process.env.COINBASE_CDP_API_KEY) {
    return `https://base-mainnet.cdp.coinbase.com/v1/${process.env.COINBASE_CDP_API_KEY}`;
  }

  return 'https://base-mainnet.g.alchemy.com/v2/demo';
}

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

export const publicClient = createPublicClient({
  chain: baseChain,
  transport: http(),
});

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
