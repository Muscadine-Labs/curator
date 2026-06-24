'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { TxPreview, TxPreviewChange } from '@/lib/morpho/tx-preview';
import { txPreviewActionLabel } from '@/lib/morpho/tx-preview';

interface TxPreviewDialogProps {
  open: boolean;
  preview: TxPreview | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void | Promise<void>;
  isLoading?: boolean;
  error?: Error | null;
  confirmLabel?: string;
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
  }
}

function PreviewChangeRow({ change }: { change: TxPreviewChange }) {
  const hasBeforeAfter =
    change.before != null &&
    change.before !== '' &&
    change.after != null &&
    change.after !== '';

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/40">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-slate-900 dark:text-slate-100">{change.label}</p>
          {change.subtitle && (
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{change.subtitle}</p>
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
        <p className="mt-2 text-sm tabular-nums text-slate-700 dark:text-slate-300">
          <span className="font-semibold">{change.delta}</span>
        </p>
      )}

      {hasBeforeAfter && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm tabular-nums text-slate-700 dark:text-slate-300">
          <span>{change.before}</span>
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
          <span className="font-semibold text-slate-900 dark:text-slate-100">{change.after}</span>
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
  confirmLabel = 'Confirm & sign',
}: TxPreviewDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) onOpenChange(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, isLoading, onOpenChange]);

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

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <button
        type="button"
        aria-label="Close preview"
        className="absolute inset-0 bg-black/50"
        disabled={isLoading}
        onClick={() => !isLoading && onOpenChange(false)}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tx-preview-title"
        tabIndex={-1}
        className="relative z-10 flex max-h-[min(85vh,640px)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-950"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="min-w-0">
            <h2 id="tx-preview-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {preview.title}
            </h2>
            {preview.description && (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{preview.description}</p>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={isLoading}
            onClick={() => onOpenChange(false)}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
          {preview.changes.map((change, i) => (
            <PreviewChangeRow key={`${change.action}-${change.label}-${i}`} change={change} />
          ))}
        </div>

        {preview.footnote && (
          <p className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            {preview.footnote}
          </p>
        )}

        {error && (
          <p className="border-t border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error.message?.slice(0, 400) ?? 'Transaction failed.'}
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-4 py-3 sm:flex-row sm:justify-end dark:border-slate-800">
          <Button
            type="button"
            variant="outline"
            disabled={isLoading}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" disabled={isLoading} onClick={onConfirm}>
            {isLoading ? 'Confirming…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
