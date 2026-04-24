'use client';

import { useCallback } from 'react';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import type { Abi, Address } from 'viem';

interface WriteContractConfig {
  address: Address;
  abi: Abi | readonly unknown[];
  functionName: string;
  args: readonly unknown[];
}

export function useVaultWrite() {
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
    (config: WriteContractConfig) => {
      writeContract({
        address: config.address,
        abi: config.abi as Abi,
        functionName: config.functionName,
        args: config.args as unknown[],
      });
    },
    [writeContract]
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
