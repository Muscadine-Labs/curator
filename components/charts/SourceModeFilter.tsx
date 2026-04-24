'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type ChartSourceMode = 'total' | 'byVault';

interface SourceModeFilterProps {
  value: ChartSourceMode;
  onChange: (value: ChartSourceMode) => void;
}

const OPTIONS: Array<{ value: ChartSourceMode; label: string }> = [
  { value: 'total', label: 'Total' },
  { value: 'byVault', label: 'By Vault' },
];

/**
 * Single-button dropdown for switching a chart between an aggregate Total
 * series and per-vault breakdown lines. Mirrors `TimeRangeFilter` and
 * `ViewModeFilter` so all chart headers share the same filter affordance.
 */
export function SourceModeFilter({ value, onChange }: SourceModeFilterProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const activeLabel = OPTIONS.find((o) => o.value === value)?.label ?? 'Total';

  return (
    <div className="relative" ref={containerRef}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5"
      >
        <Layers className="h-3.5 w-3.5" />
        <span>{activeLabel}</span>
        <ChevronDown className="h-3.5 w-3.5 opacity-70" />
      </Button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-40 rounded border bg-popover p-1 text-sm shadow-md">
          {OPTIONS.map((opt) => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-muted',
                  active && 'bg-muted font-medium'
                )}
              >
                <span>{opt.label}</span>
                {active && <Check className="h-3 w-3" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
