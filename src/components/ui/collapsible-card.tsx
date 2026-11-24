'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CollapsibleCardProps {
  title: ReactNode;
  headerRight?: ReactNode;
  titleMeta?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
  children: ReactNode;
  onOpenChange?: (open: boolean) => void;
}

export function CollapsibleCard({
  title,
  headerRight,
  titleMeta,
  defaultOpen = false,
  className,
  headerClassName,
  contentClassName,
  children,
  onOpenChange,
}: CollapsibleCardProps) {
  const [open, setOpen] = useState(defaultOpen);

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      onOpenChange?.(next);
      return next;
    });
  };

  return (
    <div className={cn('overflow-hidden rounded-xl border border-border', className)}>
      <div
        className={cn(
          'flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
          headerClassName
        )}
      >
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex min-w-0 items-center gap-2 text-left"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
            {title}
            {titleMeta}
          </span>
        </button>
        {open && headerRight ? (
          <div className="flex flex-wrap items-center gap-2 pl-6 sm:pl-0">{headerRight}</div>
        ) : null}
      </div>
      {open ? (
        <div className={cn('border-t border-border px-4 py-3', contentClassName)}>{children}</div>
      ) : null}
    </div>
  );
}
