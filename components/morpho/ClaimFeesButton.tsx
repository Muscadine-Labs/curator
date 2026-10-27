'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount, usePublicClient } from 'wagmi';
import { encodeFunctionData, getAddress } from 'viem';
import { Button } from '@/components/ui/button';
import { TxPreviewDialog } from '@/components/morpho/TxPreviewDialog';
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import { vaultV2Abi } from '@/lib/onchain/abis';
import { v2WriteConfigs } from '@/lib/onchain/vault-writes';
import { formatAllocationTableAmount } from '@/lib/format/allocation-display';
import { getScanUrlForChain } from '@/lib/constants';
import type { TxPreview } from '@/lib/morpho/tx-preview';
import { isBroadcastTxHash, isWalletRejection } from '@/lib/utils/wallet-error';
import { getConnectorProvider } from '@/lib/wallet/connector-provider';
import { useCuratorSafeApps } from '@/lib/safe/safe-apps-context';
import { queueSafeTransaction } from '@/lib/safe/queue-vault-write';
import {
  canConfirmPendingAcceptDestination,
  defaultPendingAcceptDestination,
  VAULT_WRITE_QUEUE_SAFE_ROLES,
  type VaultWriteDestination,
} from '@/lib/safe/vault-write-destination';

type FeeQuote = {
  assets: bigint;
  performanceAssets: bigint;
  managementAssets: bigint;
};

export function claimFeesMessage(amountLabel: string, vaultName: string, assets: bigint): string {
  if (assets === 0n) return `There are no fees to claim on ${vaultName}.`;
  return `This will claim ${amountLabel} of fees on ${vaultName}.`;
}

function splitAssets(total: bigint, part: bigint, whole: bigint): bigint {
  if (whole === 0n || part === 0n) return 0n;
  return (total * part) / whole;
}

export function ClaimFeesButton({
  vaultAddress,
  vaultName,
  chainId,
  assetSymbol,
  assetDecimals,
}: {
  vaultAddress: string;
  vaultName: string;
  chainId: number;
  assetSymbol: string;
  assetDecimals: number | null | undefined;
}) {
  const router = useRouter();
  const publicClient = usePublicClient({ chainId });
  const write = useVaultWrite({ chainId });
  const { isConnected, address: walletAddress, connector } = useAccount();
  const { connected: safeAppConnected, sdk: safeAppSdk, safeRole: safeAppRole } =
    useCuratorSafeApps();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<TxPreview | null>(null);
  const [assets, setAssets] = useState(0n);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [queueingSafe, setQueueingSafe] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [destination, setDestination] = useState<VaultWriteDestination>(() =>
    defaultPendingAcceptDestination(false)
  );

  const vault = getAddress(vaultAddress);
  const decimals = assetDecimals ?? 18;

  const safeAppSdkForRole = useMemo(() => {
    if (!safeAppConnected || !safeAppSdk || destination.kind !== 'safe') return null;
    return safeAppRole === destination.role ? safeAppSdk : null;
  }, [safeAppConnected, safeAppSdk, safeAppRole, destination]);

  const readQuote = useCallback(async (): Promise<FeeQuote> => {
    if (!publicClient) throw new Error('Vault network client is not ready.');
    const [, performanceShares, managementShares] = await publicClient.readContract({
      address: vault,
      abi: vaultV2Abi,
      functionName: 'accrueInterestView',
    });
    const feeShares = performanceShares + managementShares;
    const claimed =
      feeShares === 0n
        ? 0n
        : await publicClient.readContract({
            address: vault,
            abi: vaultV2Abi,
            functionName: 'previewRedeem',
            args: [feeShares],
          });
    return {
      assets: claimed,
      performanceAssets: splitAssets(claimed, performanceShares, feeShares),
      managementAssets: splitAssets(claimed, managementShares, feeShares),
    };
  }, [publicClient, vault]);

  const resetWrite = write.reset;

  const openPreview = useCallback(async () => {
    setQuoteError(null);
    setSubmitError(null);
    // A previous claim's confirmed state would otherwise reopen as "Transaction confirmed".
    resetWrite();
    setQuoting(true);
    try {
      const quote = await readQuote();
      const amountLabel = formatAllocationTableAmount(quote.assets, assetSymbol, decimals);
      const lines: string[] = [];
      if (quote.performanceAssets > 0n) {
        lines.push(
          `Performance ${formatAllocationTableAmount(quote.performanceAssets, assetSymbol, decimals)}`
        );
      }
      if (quote.managementAssets > 0n) {
        lines.push(
          `Management ${formatAllocationTableAmount(quote.managementAssets, assetSymbol, decimals)}`
        );
      }
      setAssets(quote.assets);
      setDestination(defaultPendingAcceptDestination(isConnected));
      setPreview({
        title: 'Claim fees',
        description: claimFeesMessage(amountLabel, vaultName, quote.assets),
        changes: [
          {
            action: 'claim',
            label: vaultName,
            subtitle: lines.length > 0 ? lines.join(' · ') : 'Accrued vault fees',
            delta: amountLabel,
          },
        ],
        footnote:
          'accrueInterest mints these fees as vault shares to the performance and management fee recipients.',
      });
      setOpen(true);
    } catch (error) {
      setQuoteError(error instanceof Error ? error.message : 'Failed to read claimable fees.');
    } finally {
      setQuoting(false);
    }
  }, [assetSymbol, decimals, isConnected, readQuote, resetWrite, vaultName]);

  const queueInSafe = useCallback(
    async (safeRole: VaultWriteDestination & { kind: 'safe' }) => {
      if (!preview) return;
      setQueueingSafe(true);
      setSubmitError(null);
      try {
        await queueSafeTransaction({
          safeRole: safeRole.role,
          calldata: {
            to: vault,
            data: encodeFunctionData({ abi: vaultV2Abi, functionName: 'accrueInterest' }),
          },
          description: `Claim fees — ${vaultName}`,
          preview,
          source: { type: 'manual' },
          proposer: walletAddress ? getAddress(walletAddress) : undefined,
          provider: await getConnectorProvider(connector),
          safeAppSdk: safeAppSdkForRole,
        });
        setOpen(false);
        router.push(`/safe/${safeRole.role}/transactions`);
      } catch (error) {
        setSubmitError(error instanceof Error ? error.message : 'Failed to queue Safe transaction.');
      } finally {
        setQueueingSafe(false);
      }
    },
    [connector, preview, router, safeAppSdkForRole, vault, vaultName, walletAddress]
  );

  const confirm = useCallback(async () => {
    if (assets === 0n) return;
    if (destination.kind === 'safe') {
      await queueInSafe(destination);
      return;
    }
    if (!isConnected) {
      setSubmitError('Connect your wallet using the button in the top bar.');
      return;
    }
    setSubmitError(null);
    try {
      await write.write(v2WriteConfigs.accrueInterest(vault));
    } catch (error) {
      // useVaultWrite resets its own error before rethrowing, so keep the reason here.
      if (!isWalletRejection(error)) {
        setSubmitError(error instanceof Error ? error.message : 'Failed to submit transaction.');
      }
    }
  }, [assets, destination, isConnected, queueInSafe, vault, write]);

  const txHash = write.txHash;
  const explorerHref =
    txHash && isBroadcastTxHash(txHash)
      ? `${getScanUrlForChain(chainId)}/tx/${txHash}`
      : null;

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void openPreview()}
        disabled={quoting}
      >
        {quoting ? 'Checking fees…' : 'Claim fees'}
      </Button>
      {quoteError ? <p className="max-w-xs text-xs text-red-600 dark:text-red-400">{quoteError}</p> : null}
      <TxPreviewDialog
        open={open}
        preview={preview}
        onOpenChange={(next) => {
          if (!next && ((write.isLoading && isBroadcastTxHash(write.txHash)) || queueingSafe)) {
            return;
          }
          setOpen(next);
          if (!next) {
            setSubmitError(null);
            if (!isBroadcastTxHash(write.txHash)) write.reset();
          }
        }}
        onConfirm={() => confirm()}
        isLoading={destination.kind === 'safe' ? queueingSafe : write.isLoading}
        isSuccess={destination.kind === 'wallet' && write.isSuccess}
        txHash={destination.kind === 'wallet' ? txHash : null}
        txExplorerHref={explorerHref}
        error={
          submitError
            ? new Error(submitError)
            : write.error && destination.kind === 'wallet'
              ? write.error
              : null
        }
        destinationOptions={{
          destination,
          onDestinationChange: setDestination,
          walletReady: isConnected,
          walletHint: 'Connect a wallet in the top bar. Anyone can accrue fees.',
          safeRoles: VAULT_WRITE_QUEUE_SAFE_ROLES,
          confirmEnabled:
            assets > 0n && canConfirmPendingAcceptDestination(destination, isConnected),
        }}
      />
    </div>
  );
}
