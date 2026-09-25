'use client';

import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getAddress, type Address, type EIP1193Provider, type Hex } from 'viem';
import { useAccount, usePublicClient, useSendTransaction, useSwitchChain } from 'wagmi';
import {
  addSignature,
  removePendingTransaction,
  updatePendingTransaction,
} from '@/lib/safe/pending-store';
import {
  executeSafePendingTransaction,
  signSafeTransactionHash,
  storedSafeTransactionData,
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
import {
  refetchSafeAfterExecute,
  refetchVaultDataAfterSafeExecute,
} from '@/lib/safe/refetch-vault-after-safe-execute';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { safePendingWarnings } from '@/lib/safe/decode-vault-calldata-preview';
import type { SafePendingTransaction } from '@/lib/safe/types';

function errorMessage(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'shortMessage' in e) {
    const short = (e as { shortMessage?: unknown }).shortMessage;
    if (typeof short === 'string' && short) return short;
  }
  return e instanceof Error && e.message ? e.message : fallback;
}

export function useSafeTransactionActions(threshold: number | undefined) {
  const queryClient = useQueryClient();
  const { address: walletAddress, connector } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const publicClient = usePublicClient({ chainId: BASE_CHAIN_ID });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Synchronous guard: `activeId` state lags a render, so a double-click during
  // the chain-switch prompt would otherwise start two executions.
  const inFlightRef = useRef(false);

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

  /**
   * Run one wallet action for a queue row. Errors land in `error` for that row
   * and are not rethrown — callers fire these from click handlers with `void`.
   */
  const runAction = useCallback(
    async <T,>(
      tx: SafePendingTransaction,
      fallbackMessage: string,
      action: () => Promise<T>,
      onError?: (message: string) => void
    ): Promise<T | undefined> => {
      if (inFlightRef.current) return undefined;
      inFlightRef.current = true;
      setActiveId(tx.id);
      setError(null);
      try {
        const hazards = safePendingWarnings(tx);
        if (hazards.blocking) throw new Error(hazards.messages[0] ?? 'Unsafe Safe transaction.');
        return await action();
      } catch (e) {
        const message = errorMessage(e, fallbackMessage);
        setError(message);
        onError?.(message);
        return undefined;
      } finally {
        inFlightRef.current = false;
        setActiveId(null);
      }
    },
    []
  );

  const signPending = useCallback(
    (tx: SafePendingTransaction) =>
      runAction(tx, 'Failed to sign transaction.', async () => {
        const { signer, provider } = await prepareSigner();
        const signature = await signSafeTransactionHash({
          safeAddress: tx.safeAddress,
          signer,
          safeTxHash: tx.safeTxHash,
          transactionData: storedSafeTransactionData(tx),
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
            const message = errorMessage(
              serviceError,
              'Signature saved locally but failed to post to Transaction Service.'
            );
            updatePendingTransaction(tx.id, { serviceSyncError: message });
          }
        }
      }),
    [runAction, prepareSigner, threshold]
  );

  const sharePending = useCallback(
    (tx: SafePendingTransaction) =>
      runAction(
        tx,
        'Failed to share with Transaction Service.',
        async () => {
          const { signer, provider } = await prepareSigner();
          const signature = await signSafeTransactionHash({
            safeAddress: tx.safeAddress,
            signer,
            safeTxHash: tx.safeTxHash,
            transactionData: storedSafeTransactionData(tx),
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
        },
        (message) => updatePendingTransaction(tx.id, { serviceSyncError: message })
      ),
    [runAction, prepareSigner, threshold]
  );

  const executePending = useCallback(
    (tx: SafePendingTransaction) =>
      runAction(tx, 'Failed to execute transaction.', async () => {
        const effectiveThreshold = requireSafeThreshold(threshold);
        if (tx.signatures.length < effectiveThreshold) {
          throw new Error(
            `Need ${effectiveThreshold} signature(s); have ${tx.signatures.length}.`
          );
        }
        if (!publicClient) {
          throw new Error('Base RPC client is unavailable. Reload and try again.');
        }

        const { signer, provider } = await prepareSigner();
        const prepared = await executeSafePendingTransaction({
          safeAddress: tx.safeAddress,
          signer,
          expectedSafeTxHash: tx.safeTxHash,
          transactionData: storedSafeTransactionData(tx),
          signatures: tx.signatures,
          provider,
        });
        const hash = await sendTransactionAsync({
          account: signer,
          to: prepared.to,
          data: prepared.data,
          value: prepared.value,
          chainId: BASE_CHAIN_ID,
        });
        // Keep the hash visible while mining, but only mark executed once the
        // receipt confirms — a reverted execTransaction must stay in the queue
        // and keep reserving its nonce.
        updatePendingTransaction(tx.id, { executedTxHash: hash });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== 'success') {
          throw new Error(
            `execTransaction reverted on-chain (${hash}). The proposal is still queued.`
          );
        }

        updatePendingTransaction(tx.id, { status: 'executed' });
        await Promise.allSettled([
          refetchVaultDataAfterSafeExecute(queryClient, tx),
          refetchSafeAfterExecute(queryClient, tx.safeAddress),
        ]);
        return hash;
      }),
    [runAction, prepareSigner, threshold, publicClient, queryClient, sendTransactionAsync]
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
