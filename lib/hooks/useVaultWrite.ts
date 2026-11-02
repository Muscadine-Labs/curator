'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useAppKitEvents } from '@reown/appkit/react';
import {
  useAccount,
  useSwitchChain,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi';
import type { Abi, Address, Chain } from 'viem';
import { chains } from '@/lib/wallet/config';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { isBroadcastTxHash } from '@/lib/utils/wallet-error';

interface WriteContractConfig {
  address: Address;
  abi: Abi | readonly unknown[];
  functionName: string;
  args: readonly unknown[];
  /** Native value (wei). Used for payable factory calls when the Safe payload sets `value`. */
  value?: bigint;
}

type UseVaultWriteOptions = {
  /** Vault chain — switches wallet before signing when mismatched. */
  chainId?: number;
};

function resolveChain(chainId: number): Chain | undefined {
  const network = chains.find((c) => Number(c.id) === chainId);
  return network as Chain | undefined;
}

export function useVaultWrite(options?: UseVaultWriteOptions) {
  const requiredChainId = options?.chainId ?? BASE_CHAIN_ID;
  // The wallet's real chain. useChainId() only reports configured chains, so
  // with Base-only config it reads 8453 while the wallet sits on Ethereum and
  // the switch below would be skipped (viem then rejects the chain mismatch).
  const { address, isConnected, chainId: activeChainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const {
    writeContractAsync,
    data: txHash,
    isPending: isWriting,
    error: writeError,
    reset,
  } = useWriteContract();

  const {
    data: receipt,
    isLoading: isConfirming,
    isSuccess,
    error: confirmError,
  } = useWaitForTransactionReceipt({
    hash: txHash,
    chainId: requiredChainId,
  });

  const appKitEvent = useAppKitEvents();
  const pendingWriteRef = useRef({ isWriting, txHash, reset });
  pendingWriteRef.current = { isWriting, txHash, reset };

  useEffect(() => {
    if (appKitEvent.data?.event !== 'USER_REJECTED') return;
    const pending = pendingWriteRef.current;
    if (!pending.isWriting || isBroadcastTxHash(pending.txHash)) return;
    pending.reset();
  }, [appKitEvent.timestamp, appKitEvent.data?.event]);

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

      try {
        return await writeContractAsync({
          account: address,
          address: config.address,
          abi: config.abi as Abi,
          functionName: config.functionName,
          args: config.args as unknown[],
          ...(config.value != null && config.value > 0n ? { value: config.value } : {}),
          chain,
          chainId: targetChainId,
        });
      } catch (error) {
        reset();
        throw error;
      }
    },
    [
      activeChainId,
      address,
      isConnected,
      requiredChainId,
      reset,
      switchChainAsync,
      writeContractAsync,
    ]
  );

  return {
    write,
    txHash,
    receipt,
    isLoading: isWriting || isConfirming,
    isWriting,
    isConfirming,
    isSuccess,
    error: writeError || confirmError,
    reset,
  };
}
