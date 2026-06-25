'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Cloud, CloudOff, ExternalLink, RefreshCw, Trash2 } from 'lucide-react';
import { getAddress } from 'viem';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useSafePendingForRole } from '@/lib/hooks/useSafePending';
import { useSafeInfo } from '@/lib/hooks/useSafeInfo';
import { useSafeTransactionActions } from '@/lib/hooks/useSafeTransactionActions';
import { getScanUrlForChain, BASE_CHAIN_ID } from '@/lib/constants';
import type { SafeAccountConfig } from '@/lib/safe/config';
import type { SafePendingTransaction } from '@/lib/safe/types';
import { SafeVaultLink } from '@/components/safe/SafeOverviewPanel';
import { txPreviewActionLabel } from '@/lib/morpho/tx-preview';
import { updatePendingTransaction } from '@/lib/safe/pending-store';
import {
  resolveSafePendingPreview,
  resolveVaultAddressFromPending,
} from '@/lib/safe/decode-vault-calldata-preview';
import {
  isTransactionServiceConfigured,
  SAFE_TX_SERVICE_RATE_LIMITS,
} from '@/lib/safe/transaction-service';
import { syncPendingFromTransactionService } from '@/lib/safe/service-sync';

function statusBadge(status: SafePendingTransaction['status']) {
  switch (status) {
    case 'ready':
      return (
        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
          Ready to execute
        </Badge>
      );
    case 'awaiting_signatures':
      return <Badge variant="secondary">Awaiting signatures</Badge>;
    case 'stale':
      return (
        <Badge className="bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
          Stale nonce
        </Badge>
      );
    case 'executed':
      return (
        <Badge className="bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200">
          Executed
        </Badge>
      );
    default:
      return null;
  }
}

function serviceBadge(tx: SafePendingTransaction) {
  if (tx.serviceSynced) {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-blue-200 text-blue-800 dark:border-blue-900/50 dark:text-blue-300"
      >
        <Cloud className="h-3 w-3" />
        Shared
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className="gap-1 border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400"
    >
      <CloudOff className="h-3 w-3" />
      Local only
    </Badge>
  );
}

function PendingTransactionCard({
  tx,
  owners,
  threshold,
  serviceEnabled,
}: {
  tx: SafePendingTransaction;
  owners: string[];
  threshold: number;
  serviceEnabled: boolean;
}) {
  const {
    walletAddress,
    activeId,
    error,
    signPending,
    sharePending,
    executePending,
    cancelPending,
    ownerHasSigned,
  } = useSafeTransactionActions(threshold);

  const isOwner =
    walletAddress &&
    owners.some((o) => getAddress(o).toLowerCase() === getAddress(walletAddress).toLowerCase());
  const signed = walletAddress ? ownerHasSigned(tx, walletAddress) : false;
  const busy = activeId === tx.id;
  const canExecute = tx.status === 'ready' && tx.signatures.length >= threshold;
  const canShare =
    serviceEnabled &&
    !tx.serviceSynced &&
    isOwner &&
    tx.status !== 'stale' &&
    tx.status !== 'executed';

  const preview = useMemo(() => resolveSafePendingPreview(tx), [tx]);
  const vaultAddress = useMemo(() => resolveVaultAddressFromPending(tx), [tx]);
  const vaultSymbol =
    tx.source.type === 'allocation' || tx.source.type === 'sentinel'
      ? tx.source.vaultSymbol
      : undefined;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-900/40">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="font-medium text-slate-900 dark:text-slate-100">{tx.description}</p>
          <p className="font-mono text-[11px] text-slate-500 break-all dark:text-slate-400">
            {tx.safeTxHash}
          </p>
          {vaultAddress ? (
            <SafeVaultLink vaultAddress={vaultAddress} vaultSymbol={vaultSymbol} />
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {serviceEnabled ? serviceBadge(tx) : null}
          {statusBadge(tx.status)}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-600 dark:text-slate-400">
        <span>
          Signatures:{' '}
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            {tx.signatures.length} / {threshold}
          </span>
        </span>
        <span>Nonce: {tx.nonce}</span>
      </div>

      {tx.serviceSyncError && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{tx.serviceSyncError}</p>
      )}

      {preview.changes.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-slate-200 pt-3 dark:border-slate-700">
          {preview.changes.map((change, i) => (
            <li key={`${change.label}-${i}`} className="text-xs text-slate-600 dark:text-slate-400">
              <span className="font-medium text-slate-800 dark:text-slate-200">
                {txPreviewActionLabel(change.action)}
              </span>
              {' — '}
              {change.label}
              {change.delta ? ` (${change.delta})` : ''}
              {change.after && !change.delta ? ` → ${change.after}` : ''}
            </li>
          ))}
        </ul>
      )}

      {error && activeId === tx.id && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error.slice(0, 300)}</p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {isOwner && !signed && tx.status !== 'stale' && tx.status !== 'executed' && (
          <Button size="sm" disabled={busy} onClick={() => void signPending(tx)}>
            {busy ? 'Signing…' : 'Sign (EIP-712)'}
          </Button>
        )}
        {canShare && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void sharePending(tx)}>
            {busy ? 'Sharing…' : 'Share with owners'}
          </Button>
        )}
        {signed && tx.status !== 'executed' && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            You signed
          </span>
        )}
        {canExecute && (
          <Button size="sm" disabled={busy} onClick={() => void executePending(tx)}>
            {busy ? 'Executing…' : 'Execute on-chain'}
          </Button>
        )}
        {tx.status !== 'executed' && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => cancelPending(tx.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </Button>
        )}
        {tx.status === 'stale' && (
          <Button size="sm" variant="outline" onClick={() => cancelPending(tx.id)}>
            Dismiss
          </Button>
        )}
        {tx.executedTxHash && (
          <a
            href={`${getScanUrlForChain(BASE_CHAIN_ID)}/tx/${tx.executedTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
          >
            View tx
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {!walletAddress && (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Connect a Safe owner wallet in the top bar to sign or execute.
        </p>
      )}
      {walletAddress && !isOwner && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          Connected wallet is not an owner of this Safe.
        </p>
      )}
    </div>
  );
}

export function SafeTransactionQueue({ account }: { account: SafeAccountConfig }) {
  const pending = useSafePendingForRole(account.role);
  const { data: info } = useSafeInfo(account.address);
  const [importError, setImportError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncCooldownUntil, setSyncCooldownUntil] = useState(0);
  const [, setCooldownTick] = useState(0);

  const syncOnCooldown = syncCooldownUntil > Date.now();

  useEffect(() => {
    if (!syncOnCooldown) return;
    const ms = syncCooldownUntil - Date.now();
    const id = window.setTimeout(() => setCooldownTick((n) => n + 1), ms + 50);
    return () => window.clearTimeout(id);
  }, [syncCooldownUntil, syncOnCooldown]);

  const threshold = info?.threshold ?? 1;
  const owners = info?.owners ?? [];
  const serviceEnabled = isTransactionServiceConfigured();

  useEffect(() => {
    if (!info) return;
    for (const tx of pending) {
      if (BigInt(tx.nonce) < info.nonce && tx.status !== 'executed' && tx.status !== 'stale') {
        updatePendingTransaction(tx.id, { status: 'stale' });
      }
    }
  }, [info, pending]);

  const handleSyncFromService = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    setSyncMessage(null);

    try {
      const result = await syncPendingFromTransactionService({
        role: account.role,
        threshold,
      });
      setSyncCooldownUntil(Date.now() + 3_000);
      setSyncMessage(
        result.imported + result.updated > 0
          ? `Synced ${result.imported} new and ${result.updated} updated proposal(s) from Transaction Service.`
          : 'No pending proposals on Transaction Service for this Safe.'
      );
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : 'Failed to sync from Transaction Service.');
    } finally {
      setSyncing(false);
    }
  }, [account.role, threshold]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">Transaction queue</CardTitle>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Proposals are always stored in this browser (localStorage). Export/import JSON for
            offline sharing; use Sync from service manually so other owners&apos; proposals appear
            here (no background polling — respects Safe API rate limits).
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {serviceEnabled && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={syncing || syncOnCooldown}
              onClick={() => void handleSyncFromService()}
            >
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
              {syncOnCooldown ? 'Sync cooldown…' : 'Sync from service'}
            </Button>
          )}
          <QueueImportExport onError={setImportError} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!serviceEnabled && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Set <span className="font-mono">NEXT_PUBLIC_SAFE_API_KEY</span> to enable Transaction
            Service sync and auto-share on queue.
          </p>
        )}
        {serviceEnabled && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Transaction Service: {SAFE_TX_SERVICE_RATE_LIMITS.requestsPerSecond} req/s max (client
            throttled); {SAFE_TX_SERVICE_RATE_LIMITS.requestsPerMonth.toLocaleString()} req/month
            on your API tier.
          </p>
        )}

        {syncMessage && (
          <p className="text-xs text-emerald-700 dark:text-emerald-400">{syncMessage}</p>
        )}

        {(importError || syncError) && (
          <p className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {importError ?? syncError}
          </p>
        )}

        {pending.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center dark:border-slate-700">
            <p className="text-sm text-slate-600 dark:text-slate-400">No pending transactions.</p>
            {account.role === 'allocator' && (
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-500">
                Queue a rebalance from a vault&apos;s Allocation tab.
              </p>
            )}
            {account.role === 'sentinel' && (
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-500">
                Queue cap decreases or deallocations from a vault&apos;s Sentinel tab.
              </p>
            )}
          </div>
        ) : (
          pending.map((tx) => (
            <PendingTransactionCard
              key={tx.id}
              tx={tx}
              owners={owners}
              threshold={threshold}
              serviceEnabled={serviceEnabled}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function QueueImportExport({ onError }: { onError: (msg: string | null) => void }) {
  const handleExport = () => {
    import('@/lib/safe/pending-store').then(({ exportPendingBundle }) => {
      const blob = new Blob([exportPendingBundle()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `curator-safe-pending-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      onError(null);
    });
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      const { importPendingBundle } = await import('@/lib/safe/pending-store');
      const result = importPendingBundle(text);
      if (!result.ok) onError(result.error);
      else {
        onError(null);
      }
    };
    input.click();
  };

  return (
    <div className="flex shrink-0 gap-2">
      <Button type="button" size="sm" variant="outline" onClick={handleExport}>
        Export
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={handleImport}>
        Import
      </Button>
    </div>
  );
}
