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
  buildPendingRevokeCalldata,
  buildPendingRevokePreview,
  formatPendingCapSummary,
} from '@/lib/morpho/pending-accept';
import {
  canConfirmPendingAcceptDestination,
  canConfirmPendingRevokeDestination,
  coerceVaultWriteDestination,
  defaultPendingAcceptDestination,
  defaultPendingRevokeDestination,
  eligibleRevokeSafeRoles,
  PENDING_ACCEPT_WALLET_HINT,
  PENDING_REVOKE_WALLET_HINT,
  VAULT_WRITE_QUEUE_SAFE_ROLES,
  walletCanRevokePending,
  type VaultWriteDestination,
} from '@/lib/safe/vault-write-destination';
import { queueVaultWriteInSafe } from '@/lib/safe/queue-vault-write';
import { useCuratorSafeApps } from '@/lib/safe/safe-apps-context';
import { vaultV2GovernanceQueryKey } from '@/lib/hooks/useVaultV2Governance';
import type { SafeRole } from '@/lib/safe/config';
import { SENTINEL_SAFE_ROLE } from '@/lib/safe/config';
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
  /** Hide the embedded section heading (e.g. when nested inside Caps). */
  compactEmbedded?: boolean;
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
  compactEmbedded,
  sentinelEmpty,
  allowRevoke,
  allowAccept = false,
}: VaultV2PendingProps) {
  const hasPreloaded = preloadedData !== undefined;
  const { data: fetchedData, isLoading, error } = useVaultV2Pending(
    hasPreloaded ? null : vaultAddress
  );
  const data = hasPreloaded ? preloadedData : fetchedData;
  const [filter, setFilter] = useState<PendingFilter>('all');
  const [activeRowId, setActiveRowId] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const revokeWrite = useVaultWrite({ chainId });
  const acceptWrite = useVaultWrite({ chainId });
  const queryClient = useQueryClient();
  const router = useRouter();
  const { isConnected, address: walletAddress } = useAccount();
  const { connected: safeAppConnected, sdk: safeAppSdk, safeRole: safeAppRole } =
    useCuratorSafeApps();

  const [acceptPreviewOpen, setAcceptPreviewOpen] = useState(false);
  const [acceptPreview, setAcceptPreview] = useState<TxPreview | null>(null);
  const [acceptItem, setAcceptItem] = useState<VaultV2PendingItem | null>(null);
  const [writeDestination, setWriteDestination] = useState<VaultWriteDestination>(() =>
    defaultPendingAcceptDestination(isConnected)
  );
  const [queueingSafe, setQueueingSafe] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  const [revokePreviewOpen, setRevokePreviewOpen] = useState(false);
  const [revokePreview, setRevokePreview] = useState<TxPreview | null>(null);
  const [revokeItem, setRevokeItem] = useState<VaultV2PendingItem | null>(null);
  const [revokeDestination, setRevokeDestination] = useState<VaultWriteDestination>(() =>
    defaultPendingRevokeDestination(
      preloadedGovernance?.curator,
      preloadedGovernance?.sentinels,
      undefined
    )
  );
  const [queueingRevokeSafe, setQueueingRevokeSafe] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const onChainCurator = preloadedGovernance?.curator ?? null;
  const onChainSentinels = useMemo(
    () => preloadedGovernance?.sentinels ?? [],
    [preloadedGovernance?.sentinels]
  );
  const revokeEligibleSafes = useMemo(
    () => eligibleRevokeSafeRoles(onChainCurator, onChainSentinels),
    [onChainCurator, onChainSentinels]
  );
  const revokeWalletReady =
    isConnected && walletCanRevokePending(walletAddress, onChainCurator, onChainSentinels);

  const setRevokeDestinationCoerced = useCallback(
    (destination: VaultWriteDestination) => {
      setRevokeDestination(
        coerceVaultWriteDestination(destination, {
          eligibleSafeRoles: revokeEligibleSafes,
          preferredSafeRole: SENTINEL_SAFE_ROLE,
        })
      );
    },
    [revokeEligibleSafes]
  );

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

  const revokeInFlight =
    (revokeWrite.isLoading || queueingRevokeSafe) && activeRowId !== null;
  const acceptBusy =
    (acceptWrite.isLoading || queueingSafe) && activeRowId !== null;

  const safeAppSdkForRole = useMemo(() => {
    if (!safeAppConnected || !safeAppSdk || writeDestination.kind !== 'safe') return null;
    return safeAppRole === writeDestination.role ? safeAppSdk : null;
  }, [safeAppConnected, safeAppSdk, safeAppRole, writeDestination]);

  const safeAppSdkForRevokeRole = useMemo(() => {
    if (!safeAppConnected || !safeAppSdk || revokeDestination.kind !== 'safe') return null;
    return safeAppRole === revokeDestination.role ? safeAppSdk : null;
  }, [safeAppConnected, safeAppSdk, safeAppRole, revokeDestination]);

  useEffect(() => {
    if (!revokeWrite.isSuccess || activeRowId === null) return;
    void (async () => {
      await queryClient.invalidateQueries({ queryKey: ['vault-v2-pending', vaultAddress] });
      setRevokePreviewOpen(false);
      setRevokePreview(null);
      setRevokeItem(null);
      setActiveRowId(null);
      revokeWrite.reset();
    })();
  }, [revokeWrite.isSuccess, activeRowId, queryClient, vaultAddress, revokeWrite]);

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

  const openRevokePreview = useCallback(
    (item: VaultV2PendingItem) => {
      setRevokeError(null);
      setRevokeItem(item);
      setRevokeDestinationCoerced(
        defaultPendingRevokeDestination(onChainCurator, onChainSentinels, walletAddress)
      );
      setRevokePreview(
        buildPendingRevokePreview({
          item,
          vaultAddress,
          vaultSymbol,
          assetSymbol,
          assetDecimals,
          governance: preloadedGovernance,
          risk: preloadedRisk,
        })
      );
      setRevokePreviewOpen(true);
    },
    [
      assetDecimals,
      assetSymbol,
      onChainCurator,
      onChainSentinels,
      preloadedGovernance,
      preloadedRisk,
      vaultAddress,
      vaultSymbol,
      walletAddress,
      setRevokeDestinationCoerced,
    ]
  );

  const runWalletRevoke = useCallback(async () => {
    if (!revokeItem) return;

    setRevokeError(null);
    revokeWrite.reset();

    try {
      await revokeWrite.write(
        v2WriteConfigs.revoke(vaultAddress as Address, revokeItem.data as Hex)
      );
    } catch (e) {
      setRevokeError(e instanceof Error ? e.message : 'Failed to revoke pending change.');
      setActiveRowId(null);
    }
  }, [revokeItem, revokeWrite, vaultAddress]);

  const queueRevokeInSafe = useCallback(
    async (safeRole: SafeRole) => {
      if (!revokeItem || !revokePreview) return;

      setQueueingRevokeSafe(true);
      setRevokeError(null);

      try {
        const calldata = buildPendingRevokeCalldata(getAddress(vaultAddress), revokeItem);
        await queueVaultWriteInSafe({
          safeRole,
          calldata,
          description: `Revoke ${formatVaultV2FunctionTitle(revokeItem.functionName)} — ${vaultSymbol ?? vaultAddress}`,
          preview: revokePreview,
          source: {
            type: 'sentinel',
            action: 'revoke_pending',
            vaultAddress: getAddress(vaultAddress),
            vaultSymbol: vaultSymbol ?? undefined,
          },
          safeAppSdk: safeAppSdkForRevokeRole,
        });
        setRevokePreviewOpen(false);
        setRevokePreview(null);
        setRevokeItem(null);
        setActiveRowId(null);
        router.push(`/safe/${safeRole}`);
      } catch (e) {
        setRevokeError(e instanceof Error ? e.message : 'Failed to queue Safe transaction.');
        setActiveRowId(null);
      } finally {
        setQueueingRevokeSafe(false);
      }
    },
    [revokeItem, revokePreview, router, safeAppSdkForRevokeRole, vaultAddress, vaultSymbol]
  );

  const handleRevokeConfirm = useCallback(async () => {
    if (!revokeItem) return;

    setActiveRowId(revokeItem.rowId);

    if (revokeDestination.kind === 'safe') {
      if (!revokeEligibleSafes.includes(revokeDestination.role)) {
        setRevokeError('Selected Safe is not the on-chain sentinel or curator for this vault.');
        setActiveRowId(null);
        return;
      }
      await queueRevokeInSafe(revokeDestination.role);
      return;
    }

    if (!isConnected) {
      setRevokeError('Connect your wallet using the button in the top bar.');
      setActiveRowId(null);
      return;
    }

    if (!walletCanRevokePending(walletAddress, onChainCurator, onChainSentinels)) {
      setRevokeError(PENDING_REVOKE_WALLET_HINT);
      setActiveRowId(null);
      return;
    }

    await runWalletRevoke();
  }, [
    revokeItem,
    revokeDestination,
    revokeEligibleSafes,
    queueRevokeInSafe,
    runWalletRevoke,
    isConnected,
    walletAddress,
    onChainCurator,
    onChainSentinels,
  ]);

  const openAcceptPreview = useCallback(
    (item: VaultV2PendingItem) => {
      setAcceptError(null);
      setAcceptItem(item);
      setWriteDestination(defaultPendingAcceptDestination(isConnected));
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
    [assetDecimals, assetSymbol, preloadedGovernance, preloadedRisk, vaultAddress, vaultSymbol, isConnected]
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
        setActiveRowId(null);
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

  if (!hasPreloaded && isLoading) {
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
            const isActiveRevoke =
              activeRowId === rowId && (revokeWrite.isLoading || queueingRevokeSafe);
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
                        onClick={() => openRevokePreview(item)}
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

      {allowAccept ? (
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
          walletHint: PENDING_ACCEPT_WALLET_HINT,
          safeRoles: VAULT_WRITE_QUEUE_SAFE_ROLES,
          confirmEnabled: canConfirmPendingAcceptDestination(writeDestination, isConnected),
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
      ) : null}

      {allowRevoke ? (
      <TxPreviewDialog
        open={revokePreviewOpen}
        preview={revokePreview}
        onOpenChange={(open) => {
          if (revokeInFlight) return;
          setRevokePreviewOpen(open);
          if (!open) {
            setRevokePreview(null);
            setRevokeItem(null);
            setRevokeError(null);
            setActiveRowId(null);
          }
        }}
        destinationOptions={{
          destination: revokeDestination,
          onDestinationChange: setRevokeDestinationCoerced,
          walletReady: revokeWalletReady,
          walletHint: PENDING_REVOKE_WALLET_HINT,
          safeRoles: revokeEligibleSafes,
          confirmEnabled: canConfirmPendingRevokeDestination(revokeDestination, {
            curator: onChainCurator,
            sentinels: onChainSentinels,
            wallet: walletAddress,
            isConnected,
          }),
        }}
        onConfirm={() => void handleRevokeConfirm()}
        isLoading={revokeDestination.kind === 'safe' ? queueingRevokeSafe : revokeWrite.isLoading}
        error={
          revokeError
            ? new Error(revokeError)
            : revokeWrite.error && revokeDestination.kind === 'wallet'
              ? revokeWrite.error
              : null
        }
      />
      ) : null}
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
        {!sentinelEmpty && !compactEmbedded && (
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
            ? 'Executable timelock actions (cap increases, liquidity adapter, roles, fees, …). After the waiting period, anyone may accept — any connected wallet or multisig Safe.'
            : allowRevoke
              ? 'Pending timelock actions. Sentinel or curator may revoke before execution (sentinel wallet/Safe preferred).'
              : 'Pending timelock actions queued on this vault.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">{body}</CardContent>
    </Card>
  );
}
