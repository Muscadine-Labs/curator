'use client';

import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getAddress, type Address, type Hex } from 'viem';
import { useAccount } from 'wagmi';
import {
  addSignature,
  removePendingTransaction,
  updatePendingTransaction,
} from '@/lib/safe/pending-store';
import {
  executeSafePendingTransaction,
  signSafeTransactionHash,
} from '@/lib/safe/protocol-kit-client';
import { pendingStatusAfterSign, ownerHasSigned } from '@/lib/safe/queue-vault-write';
import {
  confirmPendingOnTransactionService,
  isTransactionServiceConfigured,
} from '@/lib/safe/transaction-service';
import { sharePendingWithTransactionService } from '@/lib/safe/service-sync';
import { refetchVaultDataAfterSafeExecute } from '@/lib/safe/refetch-vault-after-safe-execute';
import type { SafePendingTransaction } from '@/lib/safe/types';

export function useSafeTransactionActions(threshold: number | undefined) {
  const queryClient = useQueryClient();
  const { address: walletAddress } = useAccount();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const signPending = useCallback(
    async (tx: SafePendingTransaction) => {
      if (!walletAddress) {
        throw new Error('Connect your wallet using the button in the top bar.');
      }

      setActiveId(tx.id);
      setError(null);

      try {
        const signature = await signSafeTransactionHash({
          safeAddress: tx.safeAddress,
          signer: getAddress(walletAddress),
          safeTxHash: tx.safeTxHash,
        });

        const updated = addSignature(tx.id, walletAddress, signature);
        const nextCount = updated?.signatures.length ?? tx.signatures.length + 1;
        const effectiveThreshold = threshold ?? 1;

        updatePendingTransaction(tx.id, {
          status: pendingStatusAfterSign(nextCount, effectiveThreshold),
          proposer: tx.proposer ?? getAddress(walletAddress),
        });

        if (tx.serviceSynced && isTransactionServiceConfigured()) {
          try {
            await confirmPendingOnTransactionService(tx.safeTxHash, signature);
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
    [walletAddress, threshold]
  );

  const sharePending = useCallback(
    async (tx: SafePendingTransaction) => {
      if (!walletAddress) {
        throw new Error('Connect your wallet using the button in the top bar.');
      }

      setActiveId(tx.id);
      setError(null);

      try {
        const signature = await signSafeTransactionHash({
          safeAddress: tx.safeAddress,
          signer: getAddress(walletAddress),
          safeTxHash: tx.safeTxHash,
        });

        if (!ownerHasSigned(tx.signatures, walletAddress)) {
          const updated = addSignature(tx.id, walletAddress, signature);
          const nextCount = updated?.signatures.length ?? tx.signatures.length + 1;
          updatePendingTransaction(tx.id, {
            status: pendingStatusAfterSign(nextCount, threshold ?? 1),
          });
        }

        await sharePendingWithTransactionService({
          txId: tx.id,
          senderAddress: getAddress(walletAddress),
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
    [walletAddress, threshold]
  );

  const executePending = useCallback(
    async (tx: SafePendingTransaction) => {
      if (!walletAddress) {
        throw new Error('Connect your wallet using the button in the top bar.');
      }

      const effectiveThreshold = threshold ?? 1;
      if (tx.signatures.length < effectiveThreshold) {
        throw new Error(`Need ${effectiveThreshold} signature(s); have ${tx.signatures.length}.`);
      }

      setActiveId(tx.id);
      setError(null);

      try {
        const { hash } = await executeSafePendingTransaction({
          safeAddress: tx.safeAddress,
          signer: getAddress(walletAddress),
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
        });

        updatePendingTransaction(tx.id, {
          status: 'executed',
          executedTxHash: hash,
        });
        await refetchVaultDataAfterSafeExecute(queryClient, tx);
        return hash;
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Failed to execute transaction.';
        setError(message);
        throw e;
      } finally {
        setActiveId(null);
      }
    },
    [walletAddress, threshold, queryClient]
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
