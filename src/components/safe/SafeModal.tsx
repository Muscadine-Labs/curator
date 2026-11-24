'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

type SafeModalProps = {
  open: boolean;
  title: string;
  description?: string | null;
  onOpenChange: (open: boolean) => void;
  /** Blocks Escape/backdrop dismissal while a write is in flight. */
  locked?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
};

export function SafeModal({
  open,
  title,
  description,
  onOpenChange,
  locked = false,
  children,
  footer,
  className,
}: SafeModalProps) {
  const [mounted, setMounted] = useState(false);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !lockedRef.current) onOpenChange(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => {
          if (!locked) onOpenChange(false);
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative z-10 flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl',
          className
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="space-y-0.5">
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            {description ? (
              <p className="text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={locked}
            aria-label="Close"
            className="rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer ? (
          <div className="border-t border-border px-4 py-3">{footer}</div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
