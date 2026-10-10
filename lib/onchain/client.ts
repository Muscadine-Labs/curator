import {
  createPublicClient,
  http,
  Address,
  Abi,
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
} from 'viem';
import { base } from '@/lib/onchain/base-chain';
import { getBaseRpcUrl } from '@/lib/onchain/rpc-url';
import { logger } from '@/lib/utils/logger';

const rpcUrl = getBaseRpcUrl();

const baseChain = {
  ...base,
  rpcUrls: {
    default: {
      http: [rpcUrl],
    },
    public: {
      http: [rpcUrl],
    },
  },
};

export const publicClient = createPublicClient({
  chain: baseChain,
  transport: http(),
});

export type SafeContractReadOptions = {
  /**
   * This call is a probe for a function the contract may not implement.
   * A revert or empty return stays quiet. RPC failures still warn.
   */
  probe?: boolean;
};

export type ContractReadOutcome<T> =
  | { status: 'ok'; value: T }
  | { status: 'miss' }
  | { status: 'error' };

/** A revert or empty return means this contract does not expose the function. */
function isExpectedReadMiss(error: unknown): boolean {
  return (
    error instanceof BaseError &&
    error.walk(
      (err) =>
        err instanceof ContractFunctionRevertedError ||
        err instanceof ContractFunctionZeroDataError
    ) != null
  );
}

function readFailureSummary(error: unknown): string {
  if (error instanceof BaseError) return error.shortMessage;
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function readContractOutcome<T>(
  contractAddress: Address,
  abi: Abi,
  functionName: string,
  args: unknown[] = [],
  options?: SafeContractReadOptions
): Promise<ContractReadOutcome<T>> {
  try {
    const result = await publicClient.readContract({
      address: contractAddress,
      abi,
      functionName,
      args,
    });
    return { status: 'ok', value: result as T };
  } catch (error) {
    const miss = isExpectedReadMiss(error);
    // Probes treat a revert as "not on this contract". A real read, including
    // oracle price(), still warns when the call reverts. RPC failures always warn.
    if (!(options?.probe && miss)) {
      logger.warn(`Failed to read ${functionName} from ${contractAddress}`, {
        contractAddress,
        functionName,
        error: readFailureSummary(error),
      });
    }
    return miss ? { status: 'miss' } : { status: 'error' };
  }
}

export const safeContractRead = async <T>(
  contractAddress: Address,
  abi: Abi,
  functionName: string,
  args: unknown[] = [],
  options?: SafeContractReadOptions
): Promise<T | null> => {
  const outcome = await readContractOutcome<T>(
    contractAddress,
    abi,
    functionName,
    args,
    options
  );
  return outcome.status === 'ok' ? outcome.value : null;
};
