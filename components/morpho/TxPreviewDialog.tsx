'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, CheckCircle2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { TxPreview, TxPreviewChange } from '@/lib/morpho/tx-preview';
import { txPreviewActionLabel } from '@/lib/morpho/tx-preview';
import {
  confirmLabelForDestination,
  loadingLabelForDestination,
  type VaultWriteDestination,
} from '@/lib/safe/vault-write-destination';
import type { SafeRole } from '@/lib/safe/config';
import { VaultWriteDestinationSelect } from '@/components/morpho/VaultWriteDestinationSelect';
import { TxErrorBanner } from '@/components/TxErrorBanner';
import { isBroadcastTxHash } from '@/lib/utils/wallet-error';

export interface VaultWriteDestinationOptions {
  destination: VaultWriteDestination;
  onDestinationChange: (destination: VaultWriteDestination) => void;
  walletReady: boolean;
  walletHint?: string;
  safeRoles?: ReadonlyArray<SafeRole>;
  confirmEnabled?: boolean;
}

interface TxPreviewDialogProps {
  open: boolean;
  preview: TxPreview | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void | Promise<void>;
  isLoading?: boolean;
  error?: unknown;
  destinationOptions?: VaultWriteDestinationOptions | null;
  stepLabel?: string | null;
  isSuccess?: boolean;
  txHash?: string | null;
  txExplorerHref?: string | null;
  onDone?: () => void;
}

function actionBadgeClass(action: TxPreviewChange['action']): string {
  switch (action) {
    case 'allocate':
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300';
    case 'deallocate':
      return 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200';
    case 'decrease_absolute_cap':
    case 'decrease_relative_cap':
      return 'bg-orange-100 text-orange-900 dark:bg-orange-950/50 dark:text-orange-200';
    case 'increase_absolute_cap':
    case 'increase_relative_cap':
    case 'borrow':
      return 'bg-sky-100 text-sky-900 dark:bg-sky-950/50 dark:text-sky-200';
    case 'deposit':
    case 'supply':
    case 'add_collateral':
    case 'repay':
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300';
    case 'withdraw':
    case 'withdraw_collateral':
      return 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200';
    case 'exit':
      return 'bg-orange-100 text-orange-900 dark:bg-orange-950/50 dark:text-orange-200';
    case 'gate':
    case 'batch':
    case 'accept':
    case 'config':
      return 'bg-sky-100 text-sky-900 dark:bg-sky-950/50 dark:text-sky-200';
    case 'revoke':
    case 'call':
      return 'bg-orange-100 text-orange-900 dark:bg-orange-950/50 dark:text-orange-200';
  }
}

function PreviewChangeRow({ change }: { change: TxPreviewChange }) {
  const hasBeforeAfter =
    change.before != null &&
    change.before !== '' &&
    change.after != null &&
    change.after !== '';

  return (
    <div className="rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">{change.label}</p>
          {change.subtitle && (
            <p className="mt-0.5 text-xs text-muted-foreground">{change.subtitle}</p>
          )}
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
            actionBadgeClass(change.action)
          )}
        >
          {txPreviewActionLabel(change.action)}
        </span>
      </div>

      {change.delta && (
        <p className="mt-2 text-sm tabular-nums text-foreground">
          <span className="font-semibold">{change.delta}</span>
        </p>
      )}

      {hasBeforeAfter && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm tabular-nums text-muted-foreground">
          <span>{change.before}</span>
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="font-semibold text-foreground">{change.after}</span>
        </div>
      )}
    </div>
  );
}

export function TxPreviewDialog({
  open,
  preview,
  onOpenChange,
  onConfirm,
  isLoading = false,
  error = null,
  destinationOptions = null,
  stepLabel = null,
  isSuccess = false,
  txHash = null,
  txExplorerHref = null,
  onDone,
}: TxPreviewDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const lockedRef = useRef(false);
  const isLoadingRef = useRef(isLoading);
  const isSuccessRef = useRef(isSuccess);
  const [mounted, setMounted] = useState(false);
  const [locked, setLocked] = useState(false);
  isLoadingRef.current = isLoading;
  isSuccessRef.current = isSuccess;
  const submitted = isBroadcastTxHash(txHash);
  const waitingForReceipt = submitted && isLoading && error == null && !isSuccess;
  const queueingSafe =
    destinationOptions?.destination.kind === 'safe' &&
    isLoading &&
    error == null &&
    !isSuccess;
  const blocked = waitingForReceipt || Boolean(queueingSafe);

  const dismiss = useCallback(() => {
    if (blocked) return;
    lockedRef.current = false;
    setLocked(false);
    onOpenChange(false);
  }, [blocked, onOpenChange]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      lockedRef.current = false;
      setLocked(false);
    }
  }, [open]);

  const wasLoadingRef = useRef(false);

  useEffect(() => {
    if (error != null) {
      lockedRef.current = false;
      setLocked(false);
    } else if (wasLoadingRef.current && !isLoading && !isSuccess) {
      lockedRef.current = false;
      setLocked(false);
    }
    wasLoadingRef.current = isLoading;
  }, [error, isLoading, isSuccess]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, blocked, dismiss]);

  useEffect(() => {
    if (!open) return;

    const active = document.activeElement;
    if (
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      active instanceof HTMLSelectElement
    ) {
      active.blur();
    }

    const main = document.getElementById('app-main');
    const prevMainOverflow = main?.style.overflow ?? '';
    if (main) main.style.overflow = 'hidden';

    panelRef.current?.focus({ preventScroll: true });

    return () => {
      if (main) main.style.overflow = prevMainOverflow;
    };
  }, [open]);

  if (!mounted || !open || !preview) return null;

  const confirmLabel = destinationOptions
    ? confirmLabelForDestination(destinationOptions.destination)
    : 'Confirm & sign';
  const loadingLabel = submitted
    ? destinationOptions
      ? loadingLabelForDestination(destinationOptions.destination)
      : 'Confirming…'
    : 'Waiting for wallet…';
  const confirmDisabled =
    isLoading ||
    locked ||
    isSuccess ||
    destinationOptions?.confirmEnabled === false;

  const handleConfirmClick = async () => {
    if (lockedRef.current || isLoading || isSuccess) return;
    lockedRef.current = true;
    setLocked(true);
    try {
      await onConfirm();
    } catch {
      lockedRef.current = false;
      setLocked(false);
      return;
    }
    if (!isLoadingRef.current && !isSuccessRef.current) {
      lockedRef.current = false;
      setLocked(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <button
        type="button"
        aria-label="Close preview"
        className="absolute inset-0 bg-black/50"
        disabled={blocked}
        onClick={dismiss}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tx-preview-title"
        tabIndex={-1}
        className="relative z-10 flex max-h-[min(85vh,640px)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 id="tx-preview-title" className="text-base font-semibold text-foreground">
              {isSuccess ? 'Transaction confirmed' : preview.title}
            </h2>
            {preview.description && (
              <p className="mt-1 text-xs text-muted-foreground">{preview.description}</p>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={blocked}
            onClick={dismiss}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
          {preview.changes.map((change, i) => (
            <PreviewChangeRow key={`${change.action}-${change.label}-${i}`} change={change} />
          ))}
          {isSuccess && (
            <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <div className="min-w-0">
                <p>Transaction confirmed.</p>
                {txHash && txExplorerHref ? (
                  <a
                    href={txExplorerHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all text-xs underline underline-offset-2"
                  >
                    View transaction
                  </a>
                ) : null}
              </div>
            </div>
          )}
          {isLoading && stepLabel ? (
            <p className="text-xs text-muted-foreground">{stepLabel}</p>
          ) : null}
        </div>

        {preview.footnote && (
          <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
            {preview.footnote}
          </p>
        )}

        {destinationOptions && (
          <VaultWriteDestinationSelect
            destination={destinationOptions.destination}
            onChange={destinationOptions.onDestinationChange}
            walletReady={destinationOptions.walletReady}
            walletHint={destinationOptions.walletHint}
            safeRoles={destinationOptions.safeRoles}
          />
        )}

        {error != null && (
          <div className="border-t border-border/60 px-4 py-2">
            <TxErrorBanner error={error} />
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 border-t border-border px-4 py-3 sm:flex-row sm:justify-end">
          {!isSuccess ? (
            <Button
              type="button"
              variant="outline"
              disabled={blocked}
              onClick={dismiss}
            >
              Cancel
            </Button>
          ) : null}
          {isSuccess ? (
            <Button
              type="button"
              onClick={() => {
                onDone?.();
                onOpenChange(false);
              }}
            >
              Done
            </Button>
          ) : (
            <Button type="button" disabled={confirmDisabled} onClick={() => void handleConfirmClick()}>
              {isLoading || locked ? loadingLabel : confirmLabel}
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
