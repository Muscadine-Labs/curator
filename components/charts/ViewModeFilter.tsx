'use client';

import { useEffect, useRef, useState } from 'react';
import { BarChart3, Check, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type ChartViewMode = 'daily' | 'cumulative';

interface ViewModeFilterProps {
  value: ChartViewMode;
  onChange: (value: ChartViewMode) => void;
}

const OPTIONS: Array<{ value: ChartViewMode; label: string }> = [
  { value: 'cumulative', label: 'Cumulative' },
  { value: 'daily', label: 'Daily' },
];

/**
 * Single-button dropdown to choose between cumulative and daily chart views.
 * Replaces the old pair of Daily / Cumulative buttons so each chart only
 * exposes two controls (time range + view mode) instead of three.
 */
export function ViewModeFilter({ value, onChange }: ViewModeFilterProps) {
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

  const activeLabel = OPTIONS.find((o) => o.value === value)?.label ?? 'Cumulative';

  return (
    <div className="relative" ref={containerRef}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5"
      >
        <BarChart3 className="h-3.5 w-3.5" />
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
