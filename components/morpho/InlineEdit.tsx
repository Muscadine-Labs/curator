'use client';

import { useState, type ReactNode } from 'react';
import { Pencil, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Small toggle that flips a tile/row into edit mode.
 * Renders `children` when closed; `form` when open.
 */
interface InlineEditProps {
  label?: string;
  children: ReactNode;
  form: (close: () => void) => ReactNode;
  buttonLabel?: string;
  buttonSize?: 'sm' | 'default' | 'icon';
  disabled?: boolean;
  initiallyOpen?: boolean;
  className?: string;
}

export function InlineEdit({
  label = 'Edit',
  children,
  form,
  buttonLabel,
  buttonSize = 'icon',
  disabled = false,
  initiallyOpen = false,
  className,
}: InlineEditProps) {
  const [open, setOpen] = useState(initiallyOpen);
  const close = () => setOpen(false);

  return (
    <div className={cn('relative', className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">{children}</div>
        <Button
          type="button"
          variant={open ? 'secondary' : 'ghost'}
          size={buttonSize}
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          aria-label={label}
          className="shrink-0"
        >
          {buttonSize === 'icon' ? (
            open ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />
          ) : (
            <span className="flex items-center gap-1">
              {open ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
              {open ? 'Cancel' : buttonLabel ?? label}
            </span>
          )}
        </Button>
      </div>
      {open && (
        <div className="mt-3 rounded-md border border-dashed border-slate-300 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40">
          {form(close)}
        </div>
      )}
    </div>
  );
}
