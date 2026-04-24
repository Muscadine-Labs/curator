'use client';

import { useEffect, useRef, useState } from 'react';
import { Calendar, ChevronDown, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TIME_RANGE_OPTIONS, type TimeRange } from '@/lib/utils/date-filter';
import { cn } from '@/lib/utils';

interface TimeRangeFilterProps {
  value: TimeRange;
  onChange: (value: TimeRange) => void;
}

/**
 * Single-button dropdown for selecting a chart time range.
 * Replaces the old 3-button row so the chart header stays compact.
 */
export function TimeRangeFilter({ value, onChange }: TimeRangeFilterProps) {
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

  const activeLabel =
    TIME_RANGE_OPTIONS.find((o) => o.value === value)?.label ?? 'All Time';

  return (
    <div className="relative" ref={containerRef}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5"
      >
        <Calendar className="h-3.5 w-3.5" />
        <span>{activeLabel}</span>
        <ChevronDown className="h-3.5 w-3.5 opacity-70" />
      </Button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-40 rounded border bg-popover p-1 text-sm shadow-md">
          {TIME_RANGE_OPTIONS.map((opt) => {
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
