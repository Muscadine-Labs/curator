'use client';

import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getAddress, type Address, type EIP1193Provider, type Hex } from 'viem';
import { useAccount, useSwitchChain } from 'wagmi';
import {
  addSignature,
  removePendingTransaction,
  updatePendingTransaction,
} from '@/lib/safe/pending-store';
import {
  executeSafePendingTransaction,
  signSafeTransactionHash,
} from '@/lib/safe/protocol-kit-client';
import {
  pendingStatusAfterSign,
  ownerHasSigned,
  requireSafeThreshold,
} from '@/lib/safe/queue-vault-write';
import {
  confirmPendingOnTransactionService,
  isTransactionServiceConfigured,
} from '@/lib/safe/transaction-service';
import { sharePendingWithTransactionService } from '@/lib/safe/service-sync';
import { refetchVaultDataAfterSafeExecute } from '@/lib/safe/refetch-vault-after-safe-execute';
import { BASE_CHAIN_ID } from '@/lib/constants';
import type { SafePendingTransaction } from '@/lib/safe/types';

export function useSafeTransactionActions(threshold: number | undefined) {
  const queryClient = useQueryClient();
  const { address: walletAddress, connector } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const prepareSigner = useCallback(async (): Promise<{
    signer: Address;
    provider?: EIP1193Provider;
  }> => {
    if (!walletAddress) {
      throw new Error('Connect your wallet using the button in the top bar.');
    }
    await switchChainAsync({ chainId: BASE_CHAIN_ID });
    const provider = (await connector?.getProvider()) as EIP1193Provider | undefined;
    return { signer: getAddress(walletAddress), provider };
  }, [walletAddress, connector, switchChainAsync]);

  const signPending = useCallback(
    async (tx: SafePendingTransaction) => {
      const { signer, provider } = await prepareSigner();

      setActiveId(tx.id);
      setError(null);

      try {
        const signature = await signSafeTransactionHash({
          safeAddress: tx.safeAddress,
          signer,
          safeTxHash: tx.safeTxHash,
          provider,
        });

        const updated = addSignature(tx.id, signer, signature);
        const nextCount = updated?.signatures.length ?? tx.signatures.length + 1;
        const effectiveThreshold = requireSafeThreshold(threshold);

        updatePendingTransaction(tx.id, {
          status: pendingStatusAfterSign(nextCount, effectiveThreshold),
          proposer: tx.proposer ?? signer,
        });

        if (isTransactionServiceConfigured()) {
          try {
            if (!tx.serviceSynced) {
              await sharePendingWithTransactionService({
                txId: tx.id,
                senderAddress: signer,
                senderSignature: signature as Hex,
              });
            } else {
              await confirmPendingOnTransactionService(tx.safeTxHash, signature);
            }
          } catch (serviceError) {
            const message =
              serviceError instanceof Error
                ? serviceError.message
                : 'Signature saved locally but failed to post to Transaction Service.';
            updatePendingTransaction(tx.id, { serviceSyncError: message });
          }
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Failed to sign transaction.';
        setError(message);
        throw e;
      } finally {
        setActiveId(null);
      }
    },
    [prepareSigner, threshold]
  );

  const sharePending = useCallback(
    async (tx: SafePendingTransaction) => {
      const { signer, provider } = await prepareSigner();

      setActiveId(tx.id);
      setError(null);

      try {
        const signature = await signSafeTransactionHash({
          safeAddress: tx.safeAddress,
          signer,
          safeTxHash: tx.safeTxHash,
          provider,
        });

        if (!ownerHasSigned(tx.signatures, signer)) {
          const updated = addSignature(tx.id, signer, signature);
          const nextCount = updated?.signatures.length ?? tx.signatures.length + 1;
          updatePendingTransaction(tx.id, {
            status: pendingStatusAfterSign(nextCount, requireSafeThreshold(threshold)),
          });
        }

        await sharePendingWithTransactionService({
          txId: tx.id,
          senderAddress: signer,
          senderSignature: signature as Hex,
        });
      } catch (e) {
        const message =
          e instanceof Error ? e.message : 'Failed to share with Transaction Service.';
        setError(message);
        updatePendingTransaction(tx.id, { serviceSyncError: message });
        throw e;
      } finally {
        setActiveId(null);
      }
    },
    [prepareSigner, threshold]
  );

  const executePending = useCallback(
    async (tx: SafePendingTransaction) => {
      const { signer, provider } = await prepareSigner();

      const effectiveThreshold = requireSafeThreshold(threshold);
      if (tx.signatures.length < effectiveThreshold) {
        throw new Error(`Need ${effectiveThreshold} signature(s); have ${tx.signatures.length}.`);
      }

      setActiveId(tx.id);
      setError(null);

      try {
        const { hash } = await executeSafePendingTransaction({
          safeAddress: tx.safeAddress,
          signer,
          expectedSafeTxHash: tx.safeTxHash,
          transactionData: {
            to: tx.to,
            value: tx.value,
            data: tx.data,
            operation: tx.operation,
            safeTxGas: tx.safeTxGas,
            baseGas: tx.baseGas,
            gasPrice: tx.gasPrice,
            gasToken: tx.gasToken,
            refundReceiver: tx.refundReceiver,
            nonce: tx.nonce,
          },
          signatures: tx.signatures,
          provider,
        });

        updatePendingTransaction(tx.id, {
          status: 'executed',
          executedTxHash: hash,
        });
        await Promise.allSettled([
          refetchVaultDataAfterSafeExecute(queryClient, tx),
          queryClient.invalidateQueries({ queryKey: ['safe-info', tx.safeAddress] }),
          queryClient.invalidateQueries({ queryKey: ['safe-balances'] }),
        ]);
        return hash;
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Failed to execute transaction.';
        setError(message);
        throw e;
      } finally {
        setActiveId(null);
      }
    },
    [prepareSigner, threshold, queryClient]
  );

  const cancelPending = useCallback((id: string) => {
    removePendingTransaction(id);
  }, []);

  const markStale = useCallback((id: string) => {
    updatePendingTransaction(id, { status: 'stale' });
  }, []);

  return {
    walletAddress: walletAddress as Address | undefined,
    activeId,
    error,
    signPending,
    sharePending,
    executePending,
    cancelPending,
    markStale,
    ownerHasSigned: (tx: SafePendingTransaction, owner?: Address) =>
      owner ? ownerHasSigned(tx.signatures, owner) : false,
  };
}
