'use client';

import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ChartModeOption<T extends string> {
  value: T;
  label: string;
  /** Second line in the menu, e.g. "1st derivative". */
  hint?: string;
}

interface ChartModeFilterProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<ChartModeOption<T>>;
  icon: ComponentType<{ className?: string }>;
}

/**
 * Single-button dropdown shared by the chart header filters (view mode,
 * source mode). Outline button with an icon, the active label and a chevron,
 * opening a popover of options — see CLAUDE.md §16.3.
 */
export function ChartModeFilter<T extends string>({
  value,
  onChange,
  options,
  icon: Icon,
}: ChartModeFilterProps<T>) {
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

  const activeLabel = options.find((o) => o.value === value)?.label ?? options[0]?.label ?? '';
  const hasHints = options.some((o) => o.hint);

  return (
    <div className="relative" ref={containerRef}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5"
      >
        <Icon className="h-3.5 w-3.5" />
        <span>{activeLabel}</span>
        <ChevronDown className="h-3.5 w-3.5 opacity-70" />
      </Button>

      {open && (
        <div
          role="menu"
          className={cn(
            'absolute right-0 z-30 mt-1 rounded border bg-popover p-1 text-sm shadow-md',
            hasHints ? 'w-52' : 'w-40'
          )}
        >
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted',
                  active && 'bg-muted font-medium'
                )}
              >
                <span className="min-w-0">
                  <span className="block">{opt.label}</span>
                  {opt.hint ? (
                    <span className="block text-[11px] font-normal text-muted-foreground">
                      {opt.hint}
                    </span>
                  ) : null}
                </span>
                {active && <Check className="h-3 w-3 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
