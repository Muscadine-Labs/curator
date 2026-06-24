'use client';

import { useCallback } from 'react';
import {
  useAccount,
  useChainId,
  useSwitchChain,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi';
import type { Abi, Address } from 'viem';

interface WriteContractConfig {
  address: Address;
  abi: Abi | readonly unknown[];
  functionName: string;
  args: readonly unknown[];
}

type UseVaultWriteOptions = {
  /** Vault chain — switches wallet before signing when mismatched. */
  chainId?: number;
};

export function useVaultWrite(options?: UseVaultWriteOptions) {
  const requiredChainId = options?.chainId;
  const { isConnected } = useAccount();
  const activeChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const {
    writeContract,
    data: txHash,
    isPending: isWriting,
    error: writeError,
    reset,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess,
    error: confirmError,
  } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  const write = useCallback(
    async (config: WriteContractConfig) => {
      if (!isConnected) {
        throw new Error('Connect your wallet using the button in the top bar.');
      }

      const targetChainId = requiredChainId ?? activeChainId;
      if (requiredChainId != null && activeChainId !== requiredChainId) {
        await switchChainAsync({ chainId: requiredChainId });
      }

      writeContract({
        address: config.address,
        abi: config.abi as Abi,
        functionName: config.functionName,
        args: config.args as unknown[],
        chainId: targetChainId,
      });
    },
    [activeChainId, isConnected, requiredChainId, switchChainAsync, writeContract]
  );

  return {
    write,
    txHash,
    isLoading: isWriting || isConfirming,
    isWriting,
    isConfirming,
    isSuccess,
    error: writeError || confirmError,
    reset,
  };
}
