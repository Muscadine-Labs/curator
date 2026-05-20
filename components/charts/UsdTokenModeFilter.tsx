'use client';

import { useEffect, useRef, useState } from 'react';
import { Coins, Check, ChevronDown, DollarSign } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type AmountUnit = 'usd' | 'token';

interface UsdTokenModeFilterProps {
  value: AmountUnit;
  onChange: (value: AmountUnit) => void;
  disabled?: boolean;
}

const OPTIONS: Array<{ value: AmountUnit; label: string; Icon: typeof DollarSign }> = [
  { value: 'usd', label: 'USD', Icon: DollarSign },
  { value: 'token', label: 'Tokens', Icon: Coins },
];

export function UsdTokenModeFilter({ value, onChange, disabled = false }: UsdTokenModeFilterProps) {
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

  const active = OPTIONS.find((o) => o.value === value) ?? OPTIONS[1];

  return (
    <div className="relative" ref={containerRef}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5"
      >
        <active.Icon className="h-3.5 w-3.5" />
        <span>{active.label}</span>
        <ChevronDown className="h-3.5 w-3.5 opacity-70" />
      </Button>

      {open && !disabled && (
        <div className="absolute right-0 z-30 mt-1 w-36 rounded border bg-popover p-1 text-sm shadow-md">
          {OPTIONS.map((opt) => {
            const isActive = opt.value === value;
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
                  isActive && 'bg-muted font-medium'
                )}
              >
                <span className="flex items-center gap-1.5">
                  <opt.Icon className="h-3 w-3" />
                  {opt.label}
                </span>
                {isActive && <Check className="h-3 w-3" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
