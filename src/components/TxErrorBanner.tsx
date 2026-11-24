'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { summarizeWalletError } from '@/lib/utils/wallet-error';
import { cn } from '@/lib/utils';

type TxErrorBannerProps = {
  error: unknown;
  onDismiss?: () => void;
  className?: string;
};

/** Compact tx/wallet error — summary by default, technical dump behind a toggle. */
export function TxErrorBanner({ error, onDismiss, className }: TxErrorBannerProps) {
  const { summary, details, isRejection } = summarizeWalletError(error);
  const [open, setOpen] = useState(false);

  return (
    <div
      className={cn(
        'rounded-md border px-2.5 py-1.5 text-xs',
        isRejection
          ? 'border-amber-500/25 bg-amber-500/10 text-amber-900 dark:text-amber-200'
          : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
        className
      )}
    >
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 font-medium leading-snug">{summary}</p>
        {onDismiss && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto shrink-0 px-1 py-0 text-current hover:bg-transparent"
            onClick={onDismiss}
            aria-label="Dismiss"
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>

      {!isRejection && details ? (
        <div className="mt-1">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[11px] font-medium underline-offset-2 hover:underline"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            {open ? 'Hide' : 'Details'}
          </button>
          {open && (
            <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-black/5 bg-black/5 p-2 font-mono text-[10px] leading-relaxed text-current/90 dark:border-white/10 dark:bg-black/20">
              {details}
            </pre>
          )}
        </div>
      ) : null}
    </div>
  );
}
