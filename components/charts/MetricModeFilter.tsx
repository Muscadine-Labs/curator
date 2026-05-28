'use client';

import { useEffect, useRef, useState } from 'react';
import { LineChart, Check, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type VaultHistoryMetric = 'supplied' | 'sharePrice' | 'apy';

interface MetricModeFilterProps {
  value: VaultHistoryMetric;
  onChange: (value: VaultHistoryMetric) => void;
}

const OPTIONS: Array<{ value: VaultHistoryMetric; label: string }> = [
  { value: 'supplied', label: 'Tokens supplied' },
  { value: 'sharePrice', label: 'Price per share' },
  { value: 'apy', label: 'APY' },
];

export function MetricModeFilter({ value, onChange }: MetricModeFilterProps) {
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

  const activeLabel = OPTIONS.find((o) => o.value === value)?.label ?? 'Metric';

  return (
    <div className="relative" ref={containerRef}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5"
      >
        <LineChart className="h-3.5 w-3.5" />
        <span>{activeLabel}</span>
        <ChevronDown className="h-3.5 w-3.5 opacity-70" />
      </Button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-44 rounded border bg-popover p-1 text-sm shadow-md">
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
