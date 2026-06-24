'use client';

import { useCallback } from 'react';
import {
  useAccount,
  useChainId,
  useSwitchChain,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi';
import type { Abi, Address, Chain } from 'viem';
import { chains } from '@/lib/wallet/config';
import { BASE_CHAIN_ID } from '@/lib/constants';

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

function resolveChain(chainId: number): Chain | undefined {
  return chains.find((c) => c.id === chainId);
}

export function useVaultWrite(options?: UseVaultWriteOptions) {
  const requiredChainId = options?.chainId ?? BASE_CHAIN_ID;
  const { address, isConnected } = useAccount();
  const activeChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const {
    writeContractAsync,
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
    chainId: requiredChainId,
  });

  const write = useCallback(
    async (config: WriteContractConfig) => {
      if (!isConnected || !address) {
        throw new Error('Connect your wallet using the button in the top bar.');
      }

      const targetChainId = requiredChainId;
      const chain = resolveChain(targetChainId);
      if (!chain) {
        throw new Error(`Unsupported chain ${targetChainId}.`);
      }

      if (activeChainId !== targetChainId) {
        await switchChainAsync({ chainId: targetChainId });
      }

      return writeContractAsync({
        account: address,
        address: config.address,
        abi: config.abi as Abi,
        functionName: config.functionName,
        args: config.args as unknown[],
        chain,
        chainId: targetChainId,
      });
    },
    [activeChainId, address, isConnected, requiredChainId, switchChainAsync, writeContractAsync]
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
