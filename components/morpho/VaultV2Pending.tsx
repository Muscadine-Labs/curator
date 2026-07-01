'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { getAddress, type Address, type Hex } from 'viem';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useVaultV2Pending } from '@/lib/hooks/useVaultV2Pending';
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import { v2WriteConfigs } from '@/lib/onchain/vault-writes';
import { getScanUrlForChain } from '@/lib/constants';
import { TransactionButton } from '@/components/TransactionButton';
import { TxPreviewDialog } from '@/components/morpho/TxPreviewDialog';
import type { VaultV2PendingResponse, VaultV2PendingItem } from '@/app/api/vaults/[id]/pending/route';
import type { VaultV2GovernanceResponse } from '@/app/api/vaults/[id]/governance/route';
import type { V2VaultRiskResponse } from '@/app/api/vaults/[id]/risk/route';
import { formatExecutableAt } from '@/lib/format/pending-time';
import { formatVaultV2FunctionTitle } from '@/lib/morpho/vault-v2-timelocks';
import {
  buildPendingAcceptPreview,
  buildPendingAcceptCalldata,
  buildPendingAcceptWriteConfig,
  formatPendingCapSummary,
} from '@/lib/morpho/pending-accept';
import {
  canConfirmVaultWriteDestination,
  defaultPendingAcceptDestination,
  VAULT_WRITE_QUEUE_SAFE_ROLES,
  type VaultWriteDestination,
} from '@/lib/safe/vault-write-destination';
import { queueVaultWriteInSafe } from '@/lib/safe/queue-vault-write';
import { useCuratorSafeApps } from '@/lib/safe/safe-apps-context';
import { vaultV2GovernanceQueryKey } from '@/lib/hooks/useVaultV2Governance';
import type { SafeRole } from '@/lib/safe/config';
import type { TxPreview } from '@/lib/morpho/tx-preview';

interface VaultV2PendingProps {
  vaultAddress: string;
  chainId: number;
  preloadedData?: VaultV2PendingResponse | null;
  preloadedGovernance?: VaultV2GovernanceResponse | null;
  preloadedRisk?: V2VaultRiskResponse | null;
  assetSymbol?: string | null;
  assetDecimals?: number | null;
  vaultSymbol?: string | null;
  embedded?: boolean;
  sentinelEmpty?: boolean;
  allowRevoke?: boolean;
  allowAccept?: boolean;
}

type PendingFilter = 'all' | 'ready' | 'waiting';

export function VaultV2Pending({
  vaultAddress,
  chainId,
  preloadedData,
  preloadedGovernance,
  preloadedRisk,
  assetSymbol,
  assetDecimals,
  vaultSymbol,
  embedded,
  sentinelEmpty,
  allowRevoke,
  allowAccept = false,
}: VaultV2PendingProps) {
  const { data: fetchedData, isLoading, error } = useVaultV2Pending(vaultAddress);
  const data = preloadedData ?? fetchedData;
  const [filter, setFilter] = useState<PendingFilter>('all');
  const [activeRowId, setActiveRowId] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const revokeWrite = useVaultWrite({ chainId });
  const acceptWrite = useVaultWrite({ chainId });
  const queryClient = useQueryClient();
  const router = useRouter();
  const { isConnected } = useAccount();
  const { connected: safeAppConnected, sdk: safeAppSdk, safeRole: safeAppRole } =
    useCuratorSafeApps();

  const [acceptPreviewOpen, setAcceptPreviewOpen] = useState(false);
  const [acceptPreview, setAcceptPreview] = useState<TxPreview | null>(null);
  const [acceptItem, setAcceptItem] = useState<VaultV2PendingItem | null>(null);
  const [writeDestination, setWriteDestination] = useState<VaultWriteDestination>(
    defaultPendingAcceptDestination()
  );
  const [queueingSafe, setQueueingSafe] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  const pending = useMemo(
    () =>
      (data?.pending ?? []).map((item, index) => ({
        ...item,
        rowId: item.rowId ?? index,
      })),
    [data?.pending]
  );

  const filtered = useMemo(() => {
    if (filter === 'ready') return pending.filter((p) => p.status === 'ready');
    if (filter === 'waiting') return pending.filter((p) => p.status === 'waiting');
    return pending;
  }, [pending, filter]);

  const hasWaiting = pending.some((p) => p.status === 'waiting');

  useEffect(() => {
    if (!hasWaiting) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [hasWaiting]);

  const revokeInFlight = revokeWrite.isLoading && activeRowId !== null;
  const acceptBusy =
    (acceptWrite.isLoading || queueingSafe) && activeRowId !== null;

  const safeAppSdkForRole = useMemo(() => {
    if (!safeAppConnected || !safeAppSdk || writeDestination.kind !== 'safe') return null;
    return safeAppRole === writeDestination.role ? safeAppSdk : null;
  }, [safeAppConnected, safeAppSdk, safeAppRole, writeDestination]);

  useEffect(() => {
    if (!revokeWrite.isSuccess || activeRowId === null) return;
    void queryClient
      .invalidateQueries({ queryKey: ['vault-v2-pending', vaultAddress] })
      .finally(() => setActiveRowId(null));
  }, [revokeWrite.isSuccess, activeRowId, queryClient, vaultAddress]);

  useEffect(() => {
    if (!acceptWrite.isSuccess || activeRowId === null) return;
    void (async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['vault-v2-pending', vaultAddress] }),
        queryClient.refetchQueries({ queryKey: vaultV2GovernanceQueryKey(vaultAddress) }),
        queryClient.refetchQueries({ queryKey: ['vault-v2-risk', vaultAddress] }),
      ]);
      setAcceptPreviewOpen(false);
      setAcceptPreview(null);
      setAcceptItem(null);
      setActiveRowId(null);
      acceptWrite.reset();
    })();
  }, [acceptWrite.isSuccess, activeRowId, queryClient, vaultAddress, acceptWrite]);

  const handleRevoke = (rowId: number, dataHex: string) => {
    revokeWrite.reset();
    setActiveRowId(rowId);
    revokeWrite.write(v2WriteConfigs.revoke(vaultAddress as Address, dataHex as Hex));
  };

  const openAcceptPreview = useCallback(
    (item: VaultV2PendingItem) => {
      setAcceptError(null);
      setAcceptItem(item);
      setWriteDestination(defaultPendingAcceptDestination());
      setAcceptPreview(
        buildPendingAcceptPreview({
          item,
          vaultAddress,
          vaultSymbol,
          assetSymbol,
          assetDecimals,
          governance: preloadedGovernance,
          risk: preloadedRisk,
        })
      );
      setAcceptPreviewOpen(true);
    },
    [assetDecimals, assetSymbol, preloadedGovernance, preloadedRisk, vaultAddress, vaultSymbol]
  );

  const runWalletAccept = useCallback(async () => {
    if (!acceptItem) return;

    setAcceptError(null);
    acceptWrite.reset();

    try {
      const config = buildPendingAcceptWriteConfig(vaultAddress, acceptItem);
      await acceptWrite.write(config);
    } catch (e) {
      setAcceptError(e instanceof Error ? e.message : 'Failed to accept pending change.');
      setActiveRowId(null);
    }
  }, [acceptItem, acceptWrite, vaultAddress]);

  const queueAcceptInSafe = useCallback(
    async (safeRole: SafeRole) => {
      if (!acceptItem || !acceptPreview) return;

      setQueueingSafe(true);
      setAcceptError(null);

      try {
        const calldata = buildPendingAcceptCalldata(getAddress(vaultAddress), acceptItem);
        await queueVaultWriteInSafe({
          safeRole,
          calldata,
          description: `Accept ${formatVaultV2FunctionTitle(acceptItem.functionName)} — ${vaultSymbol ?? vaultAddress}`,
          preview: acceptPreview,
          source: {
            type: 'caps',
            action: 'accept_pending',
            vaultAddress: getAddress(vaultAddress),
            vaultSymbol: vaultSymbol ?? undefined,
          },
          safeAppSdk: safeAppSdkForRole,
        });
        setAcceptPreviewOpen(false);
        setAcceptPreview(null);
        setAcceptItem(null);
        setActiveRowId(null);
        router.push(`/safe/${safeRole}`);
      } catch (e) {
        setAcceptError(e instanceof Error ? e.message : 'Failed to queue Safe transaction.');
      } finally {
        setQueueingSafe(false);
      }
    },
    [acceptItem, acceptPreview, router, safeAppSdkForRole, vaultAddress, vaultSymbol]
  );

  const handleAcceptConfirm = useCallback(async () => {
    if (!acceptItem) return;

    setActiveRowId(acceptItem.rowId);

    if (writeDestination.kind === 'safe') {
      if (!VAULT_WRITE_QUEUE_SAFE_ROLES.includes(writeDestination.role)) {
        setAcceptError('Selected Safe is not available for queuing.');
        setActiveRowId(null);
        return;
      }
      await queueAcceptInSafe(writeDestination.role);
      return;
    }

    if (!isConnected) {
      setAcceptError('Connect your wallet using the button in the top bar.');
      setActiveRowId(null);
      return;
    }

    await runWalletAccept();
  }, [acceptItem, writeDestination, queueAcceptInSafe, runWalletAccept, isConnected]);

  const rowSummary = useCallback(
    (item: VaultV2PendingItem) =>
      formatPendingCapSummary({
        item,
        governance: preloadedGovernance,
        risk: preloadedRisk,
        assetSymbol,
        assetDecimals,
      }),
    [assetDecimals, assetSymbol, preloadedGovernance, preloadedRisk]
  );

  if (!preloadedData && isLoading) {
    const skeleton = (
      <div className="space-y-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
    if (embedded) return skeleton;
    return (
      <Card>
        <CardHeader>
          <CardTitle>Vault Pending Actions</CardTitle>
        </CardHeader>
        <CardContent>{skeleton}</CardContent>
      </Card>
    );
  }

  if (error || !data) {
    const err = (
      <p className="text-sm text-red-600 dark:text-red-400">
        Failed to load pending actions: {error instanceof Error ? error.message : 'Unknown error'}
      </p>
    );
    if (embedded) return err;
    return (
      <Card>
        <CardHeader>
          <CardTitle>Vault Pending Actions</CardTitle>
        </CardHeader>
        <CardContent>{err}</CardContent>
      </Card>
    );
  }

  const body = (
    <>
      {!sentinelEmpty && (
        <div className="flex flex-wrap gap-2">
          {(['all', 'ready', 'waiting'] as PendingFilter[]).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? 'default' : 'outline'}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All' : f === 'ready' ? 'Executable now' : 'Pending'}
            </Button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {sentinelEmpty ? 'No pending actions' : 'No pending timelocked actions.'}
        </p>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => {
            const rowId = item.rowId;
            const isActiveRevoke = activeRowId === rowId && revokeWrite.isLoading;
            const isActiveAccept = activeRowId === rowId && acceptBusy;
            const isOtherRowBusy =
              (revokeInFlight || acceptBusy) && activeRowId !== rowId;
            const summary = rowSummary(item);

            return (
              <div
                key={rowId}
                className="rounded-md border border-slate-200 p-4 dark:border-slate-800"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900 dark:text-slate-100">
                      {formatVaultV2FunctionTitle(item.functionName)}
                    </p>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{summary}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={item.status === 'ready' ? 'default' : 'secondary'}>
                      {item.status === 'ready' ? 'Executable' : 'Pending'}
                    </Badge>
                    {allowAccept && item.status === 'ready' && (
                      <TransactionButton
                        label="Accept"
                        size="sm"
                        suppressConnectPrompt
                        disabled={isOtherRowBusy}
                        onClick={() => openAcceptPreview(item)}
                        isLoading={isActiveAccept}
                        isSuccess={isActiveAccept && acceptWrite.isSuccess}
                        error={isActiveAccept ? acceptWrite.error : null}
                        txHash={isActiveAccept ? acceptWrite.txHash : undefined}
                      />
                    )}
                    {allowRevoke && (
                      <TransactionButton
                        label="Revoke"
                        size="sm"
                        variant="outline"
                        suppressConnectPrompt
                        disabled={isOtherRowBusy}
                        onClick={() => handleRevoke(rowId, item.data)}
                        isLoading={isActiveRevoke}
                        isSuccess={isActiveRevoke && revokeWrite.isSuccess}
                        error={isActiveRevoke ? revokeWrite.error : null}
                        txHash={isActiveRevoke ? revokeWrite.txHash : undefined}
                      />
                    )}
                  </div>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">Executable at</dt>
                    <dd className="font-medium text-slate-800 dark:text-slate-200">
                      {formatExecutableAt(item.validAt, nowMs)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">Submit tx</dt>
                    <dd>
                      {item.txHash ? (
                        <a
                          href={`${getScanUrlForChain(chainId)}/tx/${item.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                        >
                          {item.txHash.slice(0, 10)}…
                        </a>
                      ) : (
                        '—'
                      )}
                    </dd>
                  </div>
                </dl>
              </div>
            );
          })}
        </div>
      )}

      <TxPreviewDialog
        open={acceptPreviewOpen}
        preview={acceptPreview}
        onOpenChange={(open) => {
          if (acceptBusy) return;
          setAcceptPreviewOpen(open);
          if (!open) {
            setAcceptPreview(null);
            setAcceptItem(null);
            setAcceptError(null);
            setActiveRowId(null);
          }
        }}
        destinationOptions={{
          destination: writeDestination,
          onDestinationChange: setWriteDestination,
          walletReady: isConnected,
          walletHint: 'Connect your wallet in the top bar to accept directly with your EOA.',
          safeRoles: VAULT_WRITE_QUEUE_SAFE_ROLES,
          confirmEnabled: canConfirmVaultWriteDestination(writeDestination, {
            walletReady: isConnected,
            eligibleSafeRoles: VAULT_WRITE_QUEUE_SAFE_ROLES,
          }),
        }}
        onConfirm={() => void handleAcceptConfirm()}
        isLoading={writeDestination.kind === 'safe' ? queueingSafe : acceptWrite.isLoading}
        error={
          acceptError
            ? new Error(acceptError)
            : acceptWrite.error && writeDestination.kind === 'wallet'
              ? acceptWrite.error
              : null
        }
      />
    </>
  );

  if (embedded) {
    if (sentinelEmpty && pending.length === 0) {
      return (
        <p className="text-sm text-slate-600 dark:text-slate-400">No pending actions</p>
      );
    }
    return (
      <div className="space-y-4">
        {!sentinelEmpty && (
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Vault Pending Actions ({pending.length})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Pending timelock actions queued on this vault.
            </p>
          </div>
        )}
        {body}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Vault Pending Actions ({pending.length})</CardTitle>
        <CardDescription>
          {allowAccept
            ? 'All executable timelock actions (cap increases, adapter changes, role updates, fees, …). Accept via your connected wallet or queue to a multisig Safe. Revoke cancels before execution.'
            : 'Pending timelock actions queued on this vault. Revoke cancels a queued action before it executes.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">{body}</CardContent>
    </Card>
  );
}
